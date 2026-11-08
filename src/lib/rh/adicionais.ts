/**
 * Comissao diferenciada: pontos a mais (ou a menos) por barbeiro, em assinaturas ou avulsos, com motivo, quem
 * autorizou e vigencia. Nunca apaga historico que ja valeu: encerra com a data de fim. Nao mexe em mes com a
 * folha fechada (o dono reabre a folha antes, e isso fica registrado).
 */
import type { ModalidadeComissao, Prisma } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, somarDias } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { competenciaFechadaNoPeriodo, periodosSeCruzam, type Adicional } from "./regras";
import { tocarPessoasDaFolha } from "./trava-regras-folha";

const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const data = (s: string) => new Date(`${s}T00:00:00Z`);
const mesBr = (comp: string) => comp.split("-").reverse().join("/");
const NOME: Record<ModalidadeComissao, string> = { ASSINATURA: "assinaturas", AVULSO: "avulsos" };

/** Adicionais no formato do calculo. */
export async function adicionaisDoCalculo(c: Prisma.TransactionClient = db): Promise<Adicional[]> {
  const l = await c.adicionalComissao.findMany();
  return l.map((a) => ({ barbeiroId: a.barbeiroId, modalidade: a.modalidade, pontosBps: a.pontosBps, inicio: dia(a.inicio)!, fim: dia(a.fim) }));
}

/** Competencias com alguma folha fechada ou paga. */
async function competenciasFechadas(c: Prisma.TransactionClient = db) {
  const l = await c.folhaPagamento.findMany({ where: { ativa: true }, distinct: ["competencia"], select: { competencia: true } });
  return l.map((f) => f.competencia);
}

/** Tela: todos os adicionais (vigentes, futuros e encerrados) com o nome de quem autorizou. */
export async function listarAdicionais() {
  const [lista, fechadas, hoje] = await Promise.all([
    db.adicionalComissao.findMany({ orderBy: [{ inicio: "desc" }], include: { barbeiro: { select: { nome: true } } } }),
    competenciasFechadas(),
    configuracao().then((c) => dataLocal(Date.now(), c.fuso)),
  ]);
  const ids = [...new Set(lista.map((a) => a.autorizadoPorId).filter(Boolean))] as string[];
  const nomes = new Map((await db.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
  return {
    hoje,
    fechadas,
    adicionais: lista.map((a) => {
      const inicio = dia(a.inicio)!, fim = dia(a.fim);
      return {
        id: a.id, barbeiroId: a.barbeiroId, barbeiro: a.barbeiro.nome, modalidade: a.modalidade, pontosBps: a.pontosBps, motivo: a.motivo,
        inicio, fim, autorizadoPor: a.autorizadoPorId ? (nomes.get(a.autorizadoPorId) ?? "—") : "—", criadoEm: a.criadoEm,
        situacao: inicio > hoje ? ("FUTURO" as const) : fim !== null && fim < hoje ? ("ENCERRADO" as const) : ("VIGENTE" as const),
      };
    }),
  };
}

function checarFechada(fechadas: string[], periodo: { inicio: string; fim: string | null }) {
  const comp = competenciaFechadaNoPeriodo(fechadas, periodo);
  if (comp) throw new ErroNegocio(`A folha de ${mesBr(comp)} já foi fechada. Para mudar a comissão desse mês, reabra a folha antes.`, 409, "folha_fechada");
}

async function travarAlteracoes(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('rh:adicionais'))`;
  // A trava das pessoas cobre também vigências sem fim e respeita a ordem do fechamento.
  await tocarPessoasDaFolha(tx);
}

async function checarSobreposicao(tx: Prisma.TransactionClient, d: { barbeiroId: string; modalidade: ModalidadeComissao; inicio: string; fim: string | null }, excetoId?: string) {
  const mesmos = await tx.adicionalComissao.findMany({ where: { barbeiroId: d.barbeiroId, modalidade: d.modalidade, ...(excetoId ? { id: { not: excetoId } } : {}) } });
  const choque = mesmos.find(a => periodosSeCruzam({ inicio: dia(a.inicio)!, fim: dia(a.fim) }, d));
  if (choque) throw new ErroNegocio(`Já existe adicional de ${NOME[d.modalidade]} nesse período (desde ${dia(choque.inicio)!.split("-").reverse().join("/")}). Encerre o anterior antes.`, 409, "sobreposto");
}

export async function criarAdicional(s: Sessao, d: { barbeiroId: string; modalidade: ModalidadeComissao; pontosBps: number; motivo: string; inicio: string; fim: string | null }) {
  const motivo = d.motivo.trim();
  if (motivo.length < 3) throw new ErroNegocio("Escreva o motivo do adicional.");
  if (!d.pontosBps) throw new ErroNegocio("Informe quantos pontos a mais (ex.: 5).");
  if (d.fim !== null && d.fim < d.inicio) throw new ErroNegocio("A data de fim é antes do início.");
  return db.$transaction(async (tx) => {
    await travarAlteracoes(tx);
    const barbeiro = await tx.barbeiro.findUnique({ where: { id: d.barbeiroId }, select: { nome: true } });
    if (!barbeiro) throw naoEncontrado("Barbeiro");
    checarFechada(await competenciasFechadas(tx), d);
    await checarSobreposicao(tx, d);
    const novo = await tx.adicionalComissao.create({
      data: { barbeiroId: d.barbeiroId, modalidade: d.modalidade, pontosBps: d.pontosBps, motivo, inicio: data(d.inicio), fim: d.fim ? data(d.fim) : null, autorizadoPorId: s.usuarioId },
    });
    await auditar(tx, s.usuarioId, "rh_adicional_criar", "adicional_comissao", novo.id, { depois: { barbeiro: barbeiro.nome, ...d, motivo } });
    return novo;
  }, { isolationLevel: "ReadCommitted" });
}

/** Encerra (ou muda o fim de) um adicional. Nao altera dias de meses com a folha fechada. */
export async function encerrarAdicional(s: Sessao, id: string, fim: string) {
  return db.$transaction(async (tx) => {
    await travarAlteracoes(tx);
    const a = await tx.adicionalComissao.findUnique({ where: { id } });
    if (!a) throw naoEncontrado("Adicional");
    const inicio = dia(a.inicio)!, fimAntes = dia(a.fim);
    if (fim < inicio) throw new ErroNegocio("A data de fim é antes do início.");
    if (fim === fimAntes) return a;
    // Só os dias cuja vigência muda precisam estar em competências abertas.
    const [de, ate] = fimAntes === null || fim < fimAntes ? [somarDias(fim, 1), fimAntes] : [somarDias(fimAntes, 1), fim];
    checarFechada(await competenciasFechadas(tx), { inicio: de, fim: ate });
    await checarSobreposicao(tx, { barbeiroId: a.barbeiroId, modalidade: a.modalidade, inicio, fim }, id);
    const r = await tx.adicionalComissao.update({ where: { id }, data: { fim: data(fim) } });
    await auditar(tx, s.usuarioId, "rh_adicional_encerrar", "adicional_comissao", id, { antes: { fim: fimAntes }, depois: { fim } });
    return r;
  }, { isolationLevel: "ReadCommitted" });
}

/** So apaga o que ainda nao comecou a valer; o que ja valeu fica no historico (encerre). */
export async function excluirAdicional(s: Sessao, id: string) {
  await db.$transaction(async (tx) => {
    await travarAlteracoes(tx);
    const a = await tx.adicionalComissao.findUnique({ where: { id } });
    if (!a) throw naoEncontrado("Adicional");
    const hoje = dataLocal(Date.now(), (await configuracao(tx)).fuso);
    if (dia(a.inicio)! <= hoje) throw new ErroNegocio("Esse adicional já começou a valer: encerre com uma data de fim (o histórico fica guardado).", 409, "ja_vale");
    checarFechada(await competenciasFechadas(tx), { inicio: dia(a.inicio)!, fim: dia(a.fim) });
    await tx.adicionalComissao.delete({ where: { id } });
    await auditar(tx, s.usuarioId, "rh_adicional_excluir", "adicional_comissao", id, {
      antes: { barbeiroId: a.barbeiroId, modalidade: a.modalidade, pontosBps: a.pontosBps, motivo: a.motivo, inicio: dia(a.inicio), fim: dia(a.fim) },
    });
  }, { isolationLevel: "ReadCommitted" });
}
