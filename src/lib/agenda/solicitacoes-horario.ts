import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { exigirConfigBarbeiro, GESTAO, type Sessao } from "@/lib/auth/sessao";
import { exigirPermissao } from "@/lib/auth/permissoes";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { configuracao, excecaoParaDia } from "./carregar";
import { contido, janelasDeTrabalho } from "./disponibilidade";
import { dataLocal, dataParaColuna } from "./tempo";
import { travarBarbeiro } from "./agendamentos";
import { validarIntervalos } from "./expediente";
import { conflitosPeriodo, limitesPeriodo, periodoHorario } from "./solicitacoes-periodo";
import { conferirSemEntrevista } from "./entrevistas-conflitos";

const linha = z.object({ diaSemana: z.number().int().min(0).max(6), inicioMin: z.number().int().min(0).max(1440), fimMin: z.number().int().min(0).max(1440) });
export const semanaHorario = z.array(linha).max(28);
type Linha = z.infer<typeof linha>;
type Tx = Prisma.TransactionClient;
const normalizar = (itens: Linha[]) => [...itens].sort((a, b) => a.diaSemana - b.diaSemana || a.inicioMin - b.inicioMin || a.fimMin - b.fimMin);
const iguais = (a: Linha[], b: Linha[]) => JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));
const semanaAtual = async (tx: Tx, barbeiroId: string) => tx.expedientePadrao.findMany({ where: { barbeiroId }, select: { diaSemana: true, inicioMin: true, fimMin: true } });

/** Prévia considera exceções de data, sem alterar os atendimentos. */
export async function conflitosSemana(tx: Tx, barbeiroId: string, proposto: Linha[]) {
  const { fuso } = await configuracao(tx);
  const agora = new Date();
  const futuros = await tx.agendamento.findMany({
    where: { barbeiroId, status: { in: ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO"] }, fim: { gt: agora } },
    select: { id: true, inicio: true, fim: true, cliente: { select: { nome: true } }, servico: { select: { nome: true } } },
    orderBy: { inicio: "asc" },
  });
  const dias = [...new Set(futuros.map(a => dataLocal(a.inicio, fuso)))];
  const excecoes = await tx.excecaoAgenda.findMany({ where: { barbeiroId, data: { in: dias.map(dataParaColuna) } } });
  return futuros.filter(a => {
    const data = dataLocal(a.inicio, fuso), excecao = excecoes.find(e => +e.data === +dataParaColuna(data));
    return !contido({ inicio: +a.inicio, fim: +a.fim }, janelasDeTrabalho(data, proposto, excecaoParaDia(excecao ?? null), fuso));
  });
}

export async function listarSolicitacoes(barbeiroId: string, ator: Sessao) {
  exigirConfigBarbeiro(ator, barbeiroId);
  const pedidos = await db.solicitacaoHorario.findMany({ where: { barbeiroId }, orderBy: { criadoEm: "desc" }, take: 20 });
  return Promise.all(pedidos.map(async p => ({ ...p, conflitos: p.status !== "PENDENTE" ? [] : p.tipo === "SEMANA" ? await conflitosSemana(db, barbeiroId, semanaHorario.parse(p.proposto)) : await conflitosPeriodo(db, barbeiroId, periodoHorario.parse(p.proposto)) })));
}

export async function solicitarSemana(barbeiroId: string, proposto: Linha[], ator: Sessao) {
  if (ator.papel !== "BARBEIRO" || ator.barbeiroId !== barbeiroId) throw proibido();
  validarIntervalos(proposto);
  return db.$transaction(async tx => {
    await travarBarbeiro(tx, barbeiroId);
    const original = await semanaAtual(tx, barbeiroId);
    if (iguais(original, proposto)) throw new ErroNegocio("A semana proposta é igual à atual.");
    if (await tx.solicitacaoHorario.findFirst({ where: { barbeiroId, status: "PENDENTE" } })) throw new ErroNegocio("Já existe uma solicitação pendente para este profissional.", 409);
    const pedido = await tx.solicitacaoHorario.create({ data: { barbeiroId, solicitadoPorId: ator.usuarioId, original, proposto } });
    await auditar(tx, ator.usuarioId, "solicitar_horario", "solicitacao_horario", pedido.id, { barbeiroId, original, proposto });
    return { ...pedido, conflitos: await conflitosSemana(tx, barbeiroId, proposto) };
  });
}

export async function decidirSemana(barbeiroId: string, pedidoId: string, decisao: "aprovar" | "recusar", motivo: string | undefined, ator: Sessao) {
  if (!GESTAO.includes(ator.papel)) throw proibido();
  await exigirPermissao(ator, "bloquear_agenda");
  const resultado = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM solicitacoes_horario WHERE id = ${pedidoId} FOR UPDATE`;
    const pedido = await tx.solicitacaoHorario.findUnique({ where: { id: pedidoId } });
    if (!pedido || pedido.barbeiroId !== barbeiroId) throw naoEncontrado("Solicitação");
    if (pedido.status !== "PENDENTE") throw new ErroNegocio("Esta solicitação já foi decidida.", 409);
    await travarBarbeiro(tx, barbeiroId);
    if (decisao === "aprovar") {
      if (pedido.tipo === "SEMANA") {
        const proposto = semanaHorario.parse(pedido.proposto);
        validarIntervalos(proposto);
        if (!iguais(await semanaAtual(tx, barbeiroId), semanaHorario.parse(pedido.original))) throw new ErroNegocio("A semana atual mudou. Solicite uma nova alteração.", 409);
        const conflitos = await conflitosSemana(tx, barbeiroId, proposto);
        if (conflitos.length) throw new ErroNegocio("Existem atendimentos afetados. Resolva-os antes de aprovar; nenhum foi cancelado.", 409, "conflitos_pendentes", { ids: conflitos.map(a => a.id) });
        await tx.expedientePadrao.deleteMany({ where: { barbeiroId } });
        await tx.expedientePadrao.createMany({ data: proposto.map(i => ({ ...i, barbeiroId })) });
      } else {
        const proposto = periodoHorario.parse(pedido.proposto);
        const { inicio, fim } = await limitesPeriodo(tx, proposto);
        if (inicio <= new Date()) throw new ErroNegocio("O período solicitado já começou; recuse e solicite novamente.", 409);
        await conferirSemEntrevista(tx, barbeiroId, { inicio: +inicio, fim: +fim });
        const conflitos = await conflitosPeriodo(tx, barbeiroId, proposto);
        if (conflitos.length) throw new ErroNegocio("Existem atendimentos afetados. Resolva-os antes de aprovar; nenhum foi cancelado.", 409, "conflitos_pendentes", { ids: conflitos.map(a => a.id) });
        await tx.bloqueio.create({ data: { barbeiroId, inicio, fim, motivo: proposto.motivo || (pedido.tipo === "FOLGA" ? "Folga aprovada" : "Bloqueio aprovado"), criadoPorId: ator.usuarioId } });
      }
    }
    const salvo = await tx.solicitacaoHorario.update({ where: { id: pedidoId }, data: { status: decisao === "aprovar" ? "APROVADA" : "RECUSADA", decididoPorId: ator.usuarioId, decididoEm: new Date(), motivoDecisao: motivo || null } });
    await auditar(tx, ator.usuarioId, decisao === "aprovar" ? "aprovar_horario" : "recusar_horario", "solicitacao_horario", pedidoId, { barbeiroId, tipo: pedido.tipo, motivo: motivo ?? null, proposto: pedido.proposto as Prisma.InputJsonValue });
    return salvo;
  });
  if (decisao === "aprovar") publicar({ tipo: "agenda", barbeiroIds: [barbeiroId], datas: [] });
  return resultado;
}
