import { randomUUID } from "node:crypto";
import type { FormaPagamento } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { cpfValido } from "@/lib/assinaturas/regras";
import { cancelamentoSemRecebimento } from "@/lib/assinaturas/operacao-inicial";
import { linkAbsoluto } from "@/lib/assinaturas/cobrancas";
import { pixVencido, validadePixSeg } from "@/lib/pagamentos/checkout-regras";
import { gateway } from "@/lib/pagamentos/gateway";
import { caminhoCheckoutHorario, marcarPago, respostaAntecipado, sincronizarAntecipado, aoCancelarHorario } from "./antecipado";
import { grupoParaAntecipar } from "./antecipado-grupo";
import { travarBarbeiro } from "./agendamentos";
import { configuracao } from "./carregar";
import { dataLocal } from "./tempo";
import { travarClienteAgenda } from "./cliente-identidade";

const revisao = () => new ErroNegocio("O pagamento anterior está em conferência. Consulte o status ou fale com a barbearia antes de tentar novamente.", 409, "antecipado_conferencia");
type Entrada = { clienteId: string; agendamentoId: string; forma: FormaPagamento; cpf?: string; email?: string; usuarioId?: string | null; sessaoVersao?: number; cartaoToken?: string };

export async function emitirAntecipado(p: Entrada) {
  const g = await gateway();
  if (!g.criarCobrancaAvulsa) throw new ErroNegocio("O pagamento antecipado ainda não está disponível. Pague no balcão.", 409, "indisponivel");
  if (p.forma === "BOLETO") throw new ErroNegocio("Para pagar antes, use Pix ou cartão.", 422);
  const referencia = await db.agendamento.findFirst({ where: { id: p.agendamentoId, clienteId: p.clienteId, adicionalDeId: null }, select: { barbeiroId: true, antecipado: { select: { id: true } } } });
  if (!referencia) throw naoEncontrado("Horário");
  if (referencia.antecipado) await sincronizarAntecipado(referencia.antecipado.id);
  const cliente = await db.cliente.findFirst({ where: { id: p.clienteId, excluidoEm: null } });
  if (!cliente) throw naoEncontrado("Cliente");
  const email = (p.email ?? cliente.email ?? "").trim().toLowerCase();
  if (g.exigeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ErroNegocio("Para pagar online precisamos do seu e-mail.", 422, "email");
  const cpf = (p.cpf ?? cliente.cpf ?? "").replace(/\D/g, "");
  if (!cpfValido(cpf)) throw new ErroNegocio("Para pagar online precisamos de um CPF válido.", 422, "cpf");
  const cfg = await configuracao();
  const reserva = await db.$transaction(async tx => {
    await travarClienteAgenda(tx, p.clienteId, p.usuarioId ? { usuarioId: p.usuarioId, sessaoVersao: p.sessaoVersao ?? 0 } : undefined);
    await travarBarbeiro(tx, referencia.barbeiroId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${p.clienteId}`}))`;
    const { ag, grupo, valorCentavos } = await grupoParaAntecipar(tx, p.clienteId, p.agendamentoId);
    if (ag.barbeiroId !== referencia.barbeiroId) throw revisao();
    const atual = ag.antecipado;
    if (atual?.emissaoChave) throw revisao();
    if (atual && ["PAGO", "CREDITADO"].includes(atual.status)) throw new ErroNegocio("Esse horário já está pago.", 409, "ja_pago");
    if (atual?.status === "ESTORNADO") throw new ErroNegocio("O pagamento desse horário foi estornado: pague no balcão.", 409, "estornado");
    if (atual?.status === "PENDENTE") {
      const reutilizavel = atual.forma === p.forma && atual.valorCentavos === valorCentavos && !!atual.link && !p.cartaoToken && !(p.forma === "PIX" && pixVencido(atual.pixExpiraEm));
      if (reutilizavel) return { tipo: "existente" as const, pagamento: respostaAntecipado(atual) };
      // Uma consulta/timeout não comprova cancelamento. Nunca emite uma substituta aqui.
      throw revisao();
    }
    if (p.forma === "CARTAO" && g.cartao === "token" && !p.cartaoToken) return { tipo: "existente" as const, pagamento: { id: atual?.id ?? "", status: "PENDENTE" as const, forma: "CARTAO" as const, valorCentavos, link: linkAbsoluto(caminhoCheckoutHorario(ag.id)), pixCopiaECola: null, pixQrUrl: null, pixExpiraEm: null, pagoEm: null } };
    const chave = randomUUID();
    const dados = { clienteId: p.clienteId, valorCentavos, forma: p.forma, status: "PENDENTE" as const, emissaoChave: chave, gatewayId: null, link: null, pixCopiaECola: null, pixQrUrl: null, pixExpiraEm: null, pagoEm: null };
    const salvo = await tx.pagamentoAntecipado.upsert({ where: { agendamentoId: ag.id }, create: { agendamentoId: ag.id, ...dados }, update: dados });
    await auditar(tx, p.usuarioId ?? null, "reservar_pagamento_antecipado", "agendamento", ag.id, { chave, valorCentavos, servicos: grupo.map(a => a.id), forma: p.forma });
    await tx.cliente.update({ where: { id: cliente.id }, data: { cpf, ...(email ? { email } : {}) } });
    return { tipo: "nova" as const, salvo, ag, chave, valorCentavos, descricao: grupo.map(a => a.servico.nome).join(" + ") };
  });
  if (reserva.tipo === "existente") return reserva.pagamento;
  let cob;
  try {
    const clienteGatewayId = await g.criarCliente({ nome: cliente.nome, cpf, telefone: cliente.telefone, email: email || null, referencia: cliente.id });
    cob = await g.criarCobrancaAvulsa({ clienteGatewayId, valorCentavos: reserva.valorCentavos, forma: p.forma, vencimento: dataLocal(reserva.ag.inicio, cfg.fuso),
      descricao: `${reserva.descricao} - ${cfg.nomeBarbearia}`, referencia: `ag-${reserva.ag.id}-${reserva.chave}`,
      ...(p.forma === "CARTAO" && p.cartaoToken ? { cartaoToken: p.cartaoToken, parcelas: 1 } : {}),
      ...(p.forma === "PIX" ? { pixValidadeSeg: validadePixSeg(reserva.ag.inicio) } : {}),
    });
  } catch {
    // O claim fica persistido, inclusive se o processo cair depois de o gateway cobrar.
    throw revisao();
  }
  if (cob.valorCentavos !== reserva.valorCentavos || cob.moeda !== "BRL") throw revisao();
  const recusado = cancelamentoSemRecebimento(cob, cob.id, reserva.valorCentavos) ||
    (p.forma === "CARTAO" && cob.status === "ATRASADA" && cob.recusaComprovada === true && cob.liquidadoCentavos === 0 && !cob.pagaEm);
  await db.$transaction(async tx => {
    const r = await tx.pagamentoAntecipado.updateMany({ where: { id: reserva.salvo.id, emissaoChave: reserva.chave }, data: {
      gatewayId: cob.id, emissaoChave: null, status: recusado ? "CANCELADO" : "PENDENTE", link: cob.link ?? (g.cartao === "token" ? caminhoCheckoutHorario(reserva.ag.id) : null),
      pixCopiaECola: cob.pixCopiaECola ?? null, pixQrUrl: cob.pixQrUrl ?? null, pixExpiraEm: cob.expiraEm ? new Date(cob.expiraEm) : null,
    } });
    if (r.count !== 1) throw revisao();
    await auditar(tx, p.usuarioId ?? null, "gerar_pagamento_antecipado", "agendamento", reserva.ag.id, { valorCentavos: reserva.valorCentavos, forma: p.forma, recusado, gatewayId: cob.id, chave: reserva.chave });
  });
  if (cob.status === "PAGA" && cob.liquidadoCentavos === reserva.valorCentavos && cob.pagaEm && Number.isFinite(Date.parse(cob.pagaEm))) await marcarPago(reserva.salvo.id, cob.pagaEm, { gatewayId: cob.id, valorCentavos: reserva.valorCentavos });
  if ((await db.agendamento.findUniqueOrThrow({ where: { id: reserva.ag.id } })).status === "CANCELADO") await aoCancelarHorario(reserva.ag.id);
  if (recusado) throw new ErroNegocio(cob.erro ?? "Pagamento recusado. Confira os dados antes de tentar novamente.", 422, "cartao_recusado");
  return respostaAntecipado(await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: reserva.salvo.id } }));
}
