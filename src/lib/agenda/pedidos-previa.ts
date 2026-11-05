import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { precificar } from "@/lib/assinaturas/agenda";
import { configuracao, servicoDoBarbeiro } from "./carregar";
import { erroDuracao } from "./encaixes-regras";

/** Mesmas regras de preço/ordem da reserva, sem criar agendamento nem consumir plano. */
export async function previaPedido(id: string, barbeiroId: string, inicio: Date) {
  const pedido = await db.pedidoAgendamento.findUnique({ where: { id }, include: { cliente: { select: { excluidoEm: true } } } });
  if (!pedido || pedido.cliente.excluidoEm) throw naoEncontrado("Pedido");
  if (pedido.status !== "PENDENTE") throw new ErroNegocio("Este pedido já foi decidido. Atualize a lista.", 409, "pedido_decidido");
  if (pedido.barbeiroId && pedido.barbeiroId !== barbeiroId) throw new ErroNegocio("Confira o profissional solicitado pelo cliente.", 409, "pedido_alterado");
  const profissional = await db.barbeiro.findFirst({ where: { id: barbeiroId, ativo: true }, select: { nome: true } });
  if (!profissional) throw naoEncontrado("Profissional ativo");
  const cfg = await configuracao();
  if (+inicio < Date.now() + cfg.antecedenciaMinimaMin * 60_000 || +inicio > Date.now() + cfg.janelaAgendamentoDias * 86_400_000) {
    throw new ErroNegocio("Escolha um horário futuro dentro do período disponível.", 422, "preferencia_invalida");
  }
  const ids = pedido.servicoIds as string[];
  const servicos = await Promise.all(ids.map(servicoId => servicoDoBarbeiro(barbeiroId, servicoId)));
  if (servicos.some(s => !s)) throw new ErroNegocio("O profissional não realiza todos os serviços atuais do pedido.", 409, "catalogo_alterado");
  const duracaoMin = servicos.reduce((s, item) => s + item!.duracaoMin, 0);
  const erro = erroDuracao(duracaoMin, servicos[0]!.minimoDuracaoMin);
  if (erro) throw new ErroNegocio(erro);
  const usosExtras: { id: string; servicoId: string; inicio: number; futuro: boolean }[] = [];
  const itens: { id: string; nome: string; duracaoMin: number; precoCentavos: number; peloPlano: boolean; regraPlano: string | null }[] = [];
  let posicao = +inicio;
  for (let i = 0; i < ids.length; i++) {
    const servico = servicos[i]!;
    let precoCentavos: number, peloPlano = false, regraPlano: string | null = null;
    try {
      const preco = await precificar({ clienteId: pedido.clienteId, servicoId: ids[i], barbeiroId, inicio: posicao,
        precoBase: servico.precoCentavos, fuso: cfg.fuso, usosExtras });
      precoCentavos = preco.precoCentavos; peloPlano = Boolean(preco.assinaturaId);
      if (peloPlano) usosExtras.push({ id: `pedido-${ids[i]}`, servicoId: ids[i], inicio: posicao, futuro: posicao > Date.now() });
    } catch (e) {
      if (!(e instanceof ErroNegocio) || e.codigo !== "regra_plano") throw e;
      regraPlano = e.message;
      precoCentavos = (e.detalhes as { precoAvulso: number }).precoAvulso;
    }
    itens.push({ id: ids[i], nome: servico.servico.nome, duracaoMin: servico.duracaoMin, precoCentavos, peloPlano, regraPlano });
    posicao += servico.duracaoMin * 60_000;
  }
  return { pedidoId: pedido.id, barbeiroId, profissional: profissional.nome, inicio: inicio.toISOString(), fim: new Date(posicao).toISOString(),
    duracaoMin, precoCentavos: itens.reduce((s, item) => s + item.precoCentavos, 0), requerAvulso: itens.some(item => item.regraPlano), itens };
}

export type PreviaPedido = Awaited<ReturnType<typeof previaPedido>>;
