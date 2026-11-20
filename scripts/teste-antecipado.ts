// Teste de integracao do pagamento antecipado de horario avulso, contra o banco de DESENVOLVIMENTO
// com o gateway simulado. Cria e apaga os proprios dados. Rodar: npm run teste:antecipado
process.env.PAGAMENTOS_PROVIDER = "simulado";
process.env.WHATSAPP_PROVIDER = "simulador";

import type { Sessao } from "@/lib/auth/sessao";
import { antecipadoDoHorario, checkoutDoHorario, aoCancelarHorario, pagarAntecipado, sincronizarAntecipado } from "@/lib/agenda/antecipado";
import { cancelarPeloCliente } from "@/lib/agenda/cliente";
import { cancelarPagamento } from "@/lib/comandas/maquininha";
import { abrirComanda, detalheComanda, fecharComanda } from "@/lib/comandas/servico";
import { atualizarPremios, reservarPremio } from "@/lib/jogos/premios";
import { db } from "@/lib/db";
import { pagarSimulada } from "@/lib/pagamentos/simulado";
import { horarioLivre } from "./util-teste";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string }; } };

const TEL = "5511933337002";
async function limpar() {
  const c = await db.cliente.findUnique({ where: { telefone: TEL } });
  if (!c) return;
  const ags = await db.agendamento.findMany({ where: { clienteId: c.id }, select: { id: true } });
  const cs = await db.comanda.findMany({ where: { clienteId: c.id }, select: { id: true } });
  await db.pagamentoComanda.deleteMany({ where: { comandaId: { in: cs.map((x) => x.id) } } });
  await db.itemComanda.deleteMany({ where: { comandaId: { in: cs.map((x) => x.id) } } });
  await db.comanda.deleteMany({ where: { id: { in: cs.map((x) => x.id) } } });
  const cobrancas = await db.pagamentoAntecipado.findMany({ where: { clienteId: c.id }, select: { gatewayId: true } });
  await db.cobrancaSimulada.deleteMany({ where: { id: { in: cobrancas.flatMap(a => a.gatewayId ? [a.gatewayId] : []) } } });
  await db.pagamentoAntecipado.deleteMany({ where: { clienteId: c.id } });
  await db.cobrancaSimulada.deleteMany({ where: { assinaturaGatewayId: { in: ags.map((a) => `avulsa:ag-${a.id}`) } } });
  await db.cobrancaSimulada.deleteMany({ where: { assinaturaGatewayId: { startsWith: "avulsa:ag-" }, valorCentavos: 4321 } });
  await db.beneficio.deleteMany({ where: { clienteId: c.id } });
  await db.agendamento.deleteMany({ where: { clienteId: c.id } });
  const conv = await db.conversa.findUnique({ where: { telefone: TEL } });
  if (conv) { await db.mensagem.deleteMany({ where: { conversaId: conv.id } }); await db.conversa.delete({ where: { id: conv.id } }); }
  await db.cliente.delete({ where: { id: c.id } });
  await db.jogo.deleteMany({ where: { id: `antecipado-${c.id}` } });
}

async function main() {
  await limpar();
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, barbeiroId: null, clienteId: null };
  const barbeiro = await db.barbeiro.findFirstOrThrow({ where: { ativo: true } });
  const servico = await db.servico.findFirstOrThrow({ where: { ativo: true } });
  const cliente = await db.cliente.create({ data: { telefone: TEL, nome: "Teste Antecipado", cpf: "40563771038", email: "teste@example.com" } });
  let minuto = 0;
  const marcar = async (extra: { assinaturaId?: string; inicio?: Date } = {}) => {
    const inicio = extra.inicio ?? await horarioLivre(barbeiro.id, new Date(Date.now() + (3 * 86_400_000) + (minuto += 120) * 60_000));
    return db.agendamento.create({
      data: { barbeiroId: barbeiro.id, clienteId: cliente.id, servicoId: servico.id, inicio, fim: new Date(inicio.getTime() + 30 * 60_000), precoCentavos: 4321, origem: "SITE", status: "MARCADO" },
    });
  };
  const pagar = async (agendamentoId: string) => {
    const a = await db.pagamentoAntecipado.findUniqueOrThrow({ where: { agendamentoId } });
    await pagarSimulada(a.gatewayId!);
    return sincronizarAntecipado(a.id);
  };

  const agPremio = await marcar();
  await db.agendamento.update({ where: { id: agPremio.id }, data: { precoCentavos: 5000 } });
  const jogo = await db.jogo.create({ data: { id: `antecipado-${cliente.id}`, tipo: "ROLETA", nome: "Teste de prêmio" } });
  const jogada = await db.jogada.create({ data: { chave: jogo.id, clienteId: cliente.id, jogoId: jogo.id, tipo: "ROLETA", origem: "MANUAL", vitoria: true, resultado: {} } });
  const premio = await db.premioGanho.create({ data: { codigo: jogo.id, jogadaId: jogada.id, jogoId: jogo.id, clienteId: cliente.id, tipo: "DESCONTO", percentual: 20,
    rotulo: "Desconto de R$ 10 no corte de R$ 50", raridade: "COMUM", icone: "desconto", status: "DISPONIVEL", expiraEm: new Date(Date.now() - 1000) } });
  const reservar = (titular: string) => db.$transaction(tx => reservarPremio(tx, titular, premio.id, agPremio));
  ok((await falha(() => reservar(cliente.id)))?.codigo === "premio_validade", "bloqueia prêmio vencido");
  await atualizarPremios({ clienteId: cliente.id });
  ok((await db.premioGanho.findUniqueOrThrow({ where: { id: premio.id } })).status === "EXPIRADO", "expiração registrada");
  await db.premioGanho.update({ where: { id: premio.id }, data: { status: "DISPONIVEL", expiraEm: null } });
  ok(!!await falha(() => reservar("outro-titular")), "somente o titular pode reservar o prêmio");
  await reservar(cliente.id);
  const emitir = () => pagarAntecipado({ clienteId: cliente.id, agendamentoId: agPremio.id, forma: "PIX" });
  ok((await falha(emitir))?.codigo === "premio_balcao", "desconto de R$ 10 impede gerar Pix de R$ 50");
  ok((await falha(() => checkoutDoHorario(cliente.id, agPremio.id)))?.message.includes("Pague no balcão") === true, "GET orienta balcão somente sem pagamento ativo");
  ok(!await db.pagamentoAntecipado.count({ where: { agendamentoId: agPremio.id } }), "nenhuma cobrança criada");
  await db.premioGanho.update({ where: { id: premio.id }, data: { tipo: "BRINDE" } });
  ok((await emitir()).valorCentavos === 5000, "brinde permite antecipar os R$ 50");
  await db.premioGanho.update({ where: { id: premio.id }, data: { tipo: "SERVICO" } });
  const novaTentativa = await falha(emitir);
  ok(novaTentativa?.codigo === "antecipado_conferencia" && novaTentativa.message.includes("Aguarde"), "POST orienta aguardar o Pix pendente com prêmio");
  const checkout = await checkoutDoHorario(cliente.id, agPremio.id, false);
  ok(checkout.processando === true && checkout.pix === null && checkout.link === null && !!checkout.mensagem?.includes("Aguarde"), "GET rápido informa conferência sem Pix ou link");
  const leitura = await antecipadoDoHorario(cliente.id, agPremio.id);
  ok(leitura?.status === "PENDENTE" && leitura.link === null && leitura.pixCopiaECola === null && leitura.pixQrUrl === null && "mensagem" in leitura && leitura.mensagem.includes("Aguarde"), "GET sincronizado informa conferência sem link ou QR");
  await db.premioGanho.delete({ where: { id: premio.id } });
  ok((await emitir()).valorCentavos === 5000, "prêmio excluído permite pagamento normal");
  await db.premioGanho.create({ data: { codigo: jogo.id, jogadaId: jogada.id, jogoId: jogo.id, clienteId: cliente.id, agendamentoId: agPremio.id,
    tipo: "DESCONTO", percentual: 20, rotulo: "Desconto reservado", raridade: "COMUM", icone: "desconto", status: "RESERVADO" } });
  const pix = await db.pagamentoAntecipado.findUniqueOrThrow({ where: { agendamentoId: agPremio.id } });
  await pagarSimulada(pix.gatewayId!);
  ok((await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: pix.id } })).status === "PENDENTE", "Pix recebido ainda aguarda webhook no BarberOS");
  const jaPago = await falha(emitir);
  ok(jaPago?.codigo === "ja_pago" && jaPago.message.includes("já está pago"), "POST sincroniza Pix recebido e prioriza já pago");
  ok((await checkoutDoHorario(cliente.id, agPremio.id)).status === "PAGO", "consulta ao gateway reconhece pagamento antes da orientação do prêmio");
  const recebido = await antecipadoDoHorario(cliente.id, agPremio.id);
  ok(recebido?.status === "PAGO" && recebido.link === null && recebido.pixCopiaECola === null, "GET sincronizado informa pagamento recebido sem reapresentar a cobrança");
  await db.pagamentoAntecipado.update({ where: { id: pix.id }, data: { status: "CREDITADO" } });
  ok((await falha(emitir))?.codigo === "ja_pago" && (await checkoutDoHorario(cliente.id, agPremio.id)).status === "PAGO", "POST e GET reconhecem o valor creditado");
  await db.jogada.delete({ where: { id: jogada.id } });
  await db.jogo.delete({ where: { id: jogo.id } });

  // ---- 1) paga antes e a comanda ja nasce paga
  const ag1 = await marcar();
  const p1 = await pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag1.id, forma: "PIX" });
  ok(p1.status === "PENDENTE" && !!p1.link && p1.valorCentavos === 4321, "gera o link de pagamento com o valor do horário");
  const p1b = await pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag1.id, forma: "PIX" });
  ok(p1b.id === p1.id && p1b.link === p1.link, "pedir de novo reaproveita o mesmo link");
  const pago = await pagar(ag1.id);
  ok(pago?.status === "PAGO" && !!pago.pagoEm, "pagamento confirmado no gateway marca como pago");
  ok((await falha(() => pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag1.id, forma: "PIX" })))?.codigo === "ja_pago", "não deixa pagar duas vezes");
  const { id: com1 } = await abrirComanda(s, { agendamentoId: ag1.id });
  let d = await detalheComanda(com1);
  const pgAnt = d.pagamentos.find((p) => p.antecipadoId);
  ok(!!pgAnt && pgAnt.status === "PAGO" && pgAnt.valorCentavos === 4321 && pgAnt.forma === "PIX", "comanda do atendimento já entra com o pagamento online");
  ok(d.resumo.falta === 0, "comanda não cobra de novo o que foi pago");
  ok((await falha(() => cancelarPagamento(s, pgAnt!.id)))?.codigo === "antecipado", "pagamento online não pode ser desfeito na comanda");
  await fecharComanda(s, com1);
  ok((await db.comanda.findUniqueOrThrow({ where: { id: com1 } })).status === "FECHADA", "fecha a comanda sem receber nada no balcão");

  // ---- 2) pagou e cancelou o horario: vira saldo (uma vez so)
  const ag2 = await marcar();
  await pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag2.id, forma: "CARTAO" });
  await pagar(ag2.id);
  await cancelarPeloCliente(cliente.id, ag2.id);
  await aoCancelarHorario(ag2.id); // de novo, junto com o disparo do cancelamento: nao pode creditar 2x
  await new Promise((r) => setTimeout(r, 300));
  const a2 = await db.pagamentoAntecipado.findUniqueOrThrow({ where: { agendamentoId: ag2.id } });
  const creditos = await db.beneficio.findMany({ where: { clienteId: cliente.id } });
  ok(a2.status === "CREDITADO", "horário pago e cancelado: pagamento vira crédito");
  ok(creditos.length === 1 && creditos[0].valorCentavos === 4321 && creditos[0].status === "DISPONIVEL", "crédito aparece uma vez só no saldo do cliente");

  // ---- 3) gerou o link mas cancelou antes de pagar: link cancelado
  const ag3 = await marcar();
  const p3 = await pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag3.id, forma: "PIX" });
  await cancelarPeloCliente(cliente.id, ag3.id);
  await aoCancelarHorario(ag3.id);
  const a3 = await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: p3.id } });
  const cob3 = await db.cobrancaSimulada.findUniqueOrThrow({ where: { id: a3.gatewayId! } });
  ok(a3.status === "CANCELADO" && cob3.status === "CANCELADA", "cancelou antes de pagar: link é cancelado no gateway");

  // ---- 4) pagou depois de a comanda ja estar aberta
  const ag4 = await marcar();
  await pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag4.id, forma: "PIX" });
  const { id: com4 } = await abrirComanda(s, { agendamentoId: ag4.id });
  ok((await detalheComanda(com4)).pagamentos.length === 0, "comanda aberta antes do pagamento começa sem pagamento");
  await pagar(ag4.id);
  d = await detalheComanda(com4);
  ok(d.pagamentos.some((p) => p.antecipadoId) && d.resumo.falta === 0, "pagamento que cai depois entra na comanda aberta");
  ok((await falha(() => pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag4.id, forma: "PIX" }))) !== null, "horário já na comanda não gera outro link");

  // ---- 5) regras
  const assinatura = await db.assinatura.findFirst();
  if (assinatura) {
    const ag5 = await marcar({ assinaturaId: undefined });
    await db.agendamento.update({ where: { id: ag5.id }, data: { assinaturaId: assinatura.id } });
    ok((await falha(() => pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag5.id, forma: "PIX" })))?.codigo === "nao_pode", "horário pelo plano não tem pagamento antecipado");
  }
  const ag6 = await marcar({ inicio: await horarioLivre(barbeiro.id, new Date(Date.now() - 3_600_000), 30, -30) });
  ok((await falha(() => pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag6.id, forma: "PIX" })))?.codigo === "nao_pode", "horário que já começou não paga online");
  const outro = await db.cliente.findFirstOrThrow({ where: { NOT: { id: cliente.id } } });
  ok((await falha(() => pagarAntecipado({ clienteId: outro.id, agendamentoId: ag4.id, forma: "PIX" }))) !== null, "cliente não paga horário de outra pessoa");
  await db.cliente.update({ where: { id: cliente.id }, data: { cpf: null } });
  const ag7 = await marcar();
  ok((await falha(() => pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag7.id, forma: "PIX" })))?.codigo === "cpf", "sem CPF pede o CPF");
  const p7 = await pagarAntecipado({ clienteId: cliente.id, agendamentoId: ag7.id, forma: "PIX", cpf: "405.637.710-38" });
  ok(p7.status === "PENDENTE" && (await db.cliente.findUniqueOrThrow({ where: { id: cliente.id } })).cpf === "40563771038", "CPF informado é salvo no cadastro");

  await limpar();
  console.log(process.exitCode ? "\nAlgum teste FALHOU." : "\nTodos os testes passaram.");
}

main()
  // Quebrou no meio: apaga o que criou (o telefone do teste esta na faixa do teste-cancelamento).
  .catch(async (e) => { console.error(e); process.exitCode = 1; await limpar().catch(() => {}); })
  .finally(() => db.$disconnect());
