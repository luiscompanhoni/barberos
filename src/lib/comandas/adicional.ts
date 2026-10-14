/**
 * Servico adicional na comanda (ex.: o cliente veio cortar e quer fazer a sobrancelha tambem).
 * Vira um atendimento ligado ao principal (comissao do barbeiro, uso do plano e relatorios contam normal),
 * mas nao ocupa a agenda: acontece junto do atendimento que ja esta acontecendo.
 */
import { auditar } from "@/lib/auditoria";
import { exigirGestaoBarbeiro, type Sessao } from "@/lib/auth/sessao";
import { precificar } from "@/lib/assinaturas/agenda";
import { configuracao, servicoDoBarbeiro } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { descricaoServico } from "./regras";

const MIN = 60_000;

export async function adicionarServico(s: Sessao, comandaId: string, servicoId: string, barbeiroId: string) {
  exigirGestaoBarbeiro(s, barbeiroId);
  const cfg = await configuracao();
  const [barbeiro, sb] = await Promise.all([db.barbeiro.findUnique({ where: { id: barbeiroId } }), servicoDoBarbeiro(barbeiroId, servicoId)]);
  if (!barbeiro || !barbeiro.ativo) throw naoEncontrado("Barbeiro");
  if (!sb) throw new ErroNegocio(`${barbeiro.nome} não faz esse serviço.`, 422, "servico_barbeiro");

  const r = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${comandaId} FOR UPDATE`;
    const c = await tx.comanda.findUnique({ where: { id: comandaId }, include: { itens: { include: { agendamento: true } } } });
    if (!c) throw naoEncontrado("Comanda");
    if (c.status !== "ABERTA") throw new ErroNegocio("Essa comanda já foi fechada.");
    if (!c.clienteId) throw new ErroNegocio("Comanda sem cliente cadastrado: lance o serviço como item avulso.", 422, "sem_cliente");

    // Principal: o ultimo atendimento (nao adicional) da comanda; o adicional fica logo depois dele.
    const principal = c.itens.map((i) => i.agendamento).filter((a) => a && !a.adicionalDeId && a.status !== "CANCELADO").at(-1) ?? null;
    if (!principal) throw new ErroNegocio("Abra a comanda pelo atendimento da agenda para lançar um serviço junto.", 422, "sem_atendimento");
    const inicio = principal.fim.getTime();
    // Assinante: o plano cobre se a regra deixar; senao sai avulso (com o desconto de assinante), sem travar o balcao.
    const preco = await precificar({
      clienteId: c.clienteId, servicoId, barbeiroId, inicio, precoBase: sb.precoCentavos, fuso: cfg.fuso, forcarAvulso: true, c: tx,
    });
    const ag = await tx.agendamento.create({
      data: {
        barbeiroId, clienteId: c.clienteId, servicoId, inicio: new Date(inicio), fim: new Date(inicio + sb.duracaoMin * MIN),
        status: principal.status, origem: "RECEPCAO", precoCentavos: preco.precoCentavos, assinaturaId: preco.assinaturaId,
        adicionalDeId: principal.id, observacao: "Adicional lançado na comanda", criadoPorId: s.usuarioId,
      },
    });
    await tx.itemComanda.create({
      data: {
        comandaId, agendamentoId: ag.id, descricao: descricaoServico(sb.servico.nome, barbeiro.nome, !!preco.assinaturaId),
        quantidade: 1, precoUnitCentavos: preco.precoCentavos, barbeiroId,
      },
    });
    await auditar(tx, s.usuarioId, "servico_adicional", "comanda", comandaId, {
      comanda: c.numero, servico: sb.servico.nome, barbeiro: barbeiro.nome, precoCentavos: preco.precoCentavos, peloPlano: !!preco.assinaturaId, agendamentoId: ag.id,
    });
    return ag;
  });
  publicar({ tipo: "comanda", comandaId });
  publicar({ tipo: "agenda", barbeiroIds: [barbeiroId], datas: [dataLocal(r.inicio, cfg.fuso)] });
  return r;
}

/** Item adicional tirado da comanda: o atendimento adicional e cancelado junto (dentro da transacao da remocao). */
export async function cancelarAdicionalDoItem(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], agendamentoId: string | null) {
  if (!agendamentoId) return;
  await tx.agendamento.updateMany({ where: { id: agendamentoId, adicionalDeId: { not: null } }, data: { status: "CANCELADO" } });
}
