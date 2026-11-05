/** Ensaio local com registros próprios; não usa provedores nem altera a configuração da barbearia. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Sessao } from "@/lib/auth/sessao";
import { criarPedido, cancelarPedido, decidirPedido, listarPedidos } from "@/lib/agenda/pedidos";
import { criarAgendamento } from "@/lib/agenda/agendamentos";
import { previaPedido } from "@/lib/agenda/pedidos-previa";
import { agendaDoPeriodo } from "@/lib/agenda/consultas";
import { dataLocal, diaSemana, instanteLocal, somarDias } from "@/lib/agenda/tempo";

const url = new URL(process.env.DATABASE_URL ?? "http://invalido");
if (url.hostname !== "127.0.0.1" || url.port !== "15439" || url.pathname !== "/barberos_cliente_teste_20261104") throw Error("Use somente o banco sintético local desta implementação.");
globalThis.fetch = async () => { throw Error("Acesso externo proibido neste ensaio."); };
const tag = `testpedido-${randomUUID()}`;
const usuarios: string[] = [], clientes: string[] = [], servicos: string[] = [], barbeiros: string[] = [];
const planos: string[] = [];
let checks = 0;
function ok(c: unknown, m: string) { assert.ok(c, m); checks++; console.log(`OK ${m}`); }
async function main() {
  const cfg = await db.configuracao.findUniqueOrThrow({ where: { id: 1 } });
  assert.equal(cfg.agendaExternaAtiva, true, "O ensaio requer modo de confirmação por equipe já configurado.");
  const data = somarDias(dataLocal(Date.now(), cfg.fuso), 2), hora = (m: number) => new Date(instanteLocal(data, m, cfg.fuso));
  const recepcao = await db.usuario.create({ data: { nome: tag, telefone: `${tag}-equipe`, papel: "RECEPCAO" } }); usuarios.push(recepcao.id);
  const ator: Sessao = { usuarioId: recepcao.id, nome: recepcao.nome, papel: "RECEPCAO", barbeiroId: null, clienteId: null };
  for (const [nome, precoCentavos] of [["corte", 5000], ["barba", 3000]] as const) {
    const s = await db.servico.create({ data: { nome: `${tag}-${nome}`, duracaoMin: 30, precoCentavos } }); servicos.push(s.id);
  }
  const b = await db.barbeiro.create({ data: { nome: tag, usuario: { create: { nome: tag, telefone: `${tag}-barbeiro`, papel: "BARBEIRO" } }, servicos: { create: servicos.map(servicoId => ({ servicoId })) }, expediente: { create: { diaSemana: diaSemana(data), inicioMin: 480, fimMin: 1200 } } } });
  barbeiros.push(b.id); usuarios.push(b.usuarioId);
  for (let n = 0; n < 3; n++) {
    const c = await db.cliente.create({ data: { nome: `${tag}-${n}`, telefone: `${tag}-cliente-${n}`, usuario: { create: { nome: tag, telefone: `${tag}-usuario-${n}`, papel: "CLIENTE" } } } });
    clientes.push(c.id); usuarios.push(c.usuarioId!);
  }
  const entrada = { chave: randomUUID(), servicoIds: servicos, barbeiroId: b.id, dataPreferida: data, horaPreferida: "10:00", observacao: "Prefiro manter o comprimento no topo." };
  const dupla = await Promise.all([criarPedido(clientes[0], usuarios[2], entrada), criarPedido(clientes[0], usuarios[2], entrada)]);
  ok(dupla[0].id === dupla[1].id && await db.pedidoAgendamento.count({ where: { clienteId: clientes[0] } }) === 1, "concorrência no envio mantém um único pedido");
  ok(await db.agendamento.count({ where: { clienteId: clientes[0] } }) === 0, "enviar pedido não reserva agenda");
  await assert.rejects(criarPedido(clientes[0], usuarios[2], { ...entrada, horaPreferida: "11:00" }), /outros dados/); checks++;
  const aprovar = { acao: "aprovar" as const, barbeiroId: b.id, inicio: hora(600), conferido: true as const, precoEsperadoCentavos: 8000, duracaoEsperadaMin: 60 };
  const aprovacoes = await Promise.all([decidirPedido(dupla[0].id, ator, aprovar), decidirPedido(dupla[0].id, ator, aprovar)]);
  ok(aprovacoes.every(a => a.status === "APROVADO"), "aprovações concorrentes retornam a mesma conclusão");
  const ags = await db.agendamento.findMany({ where: { clienteId: clientes[0] }, orderBy: { inicio: "asc" } });
  ok(ags.length === 2 && ags[1].adicionalDeId === ags[0].id && +ags[0].fim - +ags[0].inicio === 60 * 60_000, "uma reserva agrupada ocupa corte + barba integralmente");
  ok(ags[0].observacao === entrada.observacao, "observação do pedido fica disponível no atendimento do barbeiro");
  const confirmado = await db.pedidoAgendamento.findUniqueOrThrow({ where: { id: dupla[0].id } });
  ok(confirmado.status === "APROVADO" && JSON.stringify(confirmado.agendamentoIds) === JSON.stringify(ags.map(a => a.id)), "pedido guarda os dois IDs na confirmação atômica");
  ok(await db.auditoria.count({ where: { entidadeId: confirmado.id, acao: "aprovar_pedido_agendamento" } }) === 1, "auditoria não duplica aprovação");
  await assert.rejects(cancelarPedido(confirmado.id, clientes[0], usuarios[2]), /já respondeu/); checks++;
  await assert.rejects(decidirPedido(confirmado.id, ator, { ...aprovar, inicio: hora(660) }), /outro horário/); checks++;
  const p2 = await criarPedido(clientes[1], usuarios[3], { ...entrada, chave: randomUUID() });
  await assert.rejects(decidirPedido(p2.id, ator, aprovar), /ocupado/); checks++;
  ok((await db.pedidoAgendamento.findUniqueOrThrow({ where: { id: p2.id } })).status === "PENDENTE" && await db.agendamento.count({ where: { clienteId: clientes[1] } }) === 0, "conflito preserva pedido pendente sem reserva parcial");
  await assert.rejects(criarAgendamento({ pedidoId: p2.id, cliente: { id: clientes[1] }, barbeiroId: b.id, servicoId: servicos[0], servicosAdicionais: [servicos[1]], inicio: hora(720), origem: "SITE", precoEsperadoCentavos: 7999 }, ator), /valor mudou/); checks++;
  ok(await db.agendamento.count({ where: { clienteId: clientes[1] } }) === 0 && (await db.pedidoAgendamento.findUniqueOrThrow({ where: { id: p2.id } })).status === "PENDENTE", "erro após inserir os serviços reverte todo o atendimento e a aprovação");
  const p3 = await criarPedido(clientes[2], usuarios[4], { ...entrada, chave: randomUUID(), horaPreferida: "14:00" });
  const disputa = await Promise.allSettled([cancelarPedido(p3.id, clientes[2], usuarios[4]), decidirPedido(p3.id, ator, { ...aprovar, inicio: hora(840) })]);
  ok(disputa.filter(r => r.status === "fulfilled").length === 1, "aprovação e cancelamento concorrentes têm somente um vencedor");
  const final = await db.pedidoAgendamento.findUniqueOrThrow({ where: { id: p3.id } });
  const total = await db.agendamento.count({ where: { clienteId: clientes[2] } });
  ok((final.status === "CANCELADO" && total === 0) || (final.status === "APROVADO" && total === 2), "estado do pedido corresponde integralmente à agenda");
  const lista = await listarPedidos(clientes[0]);
  ok(lista.pedidos.length === 1 && lista.pedidos[0].agendamento?.id === ags[0].id && !('cliente' in lista.pedidos[0]), "cliente consulta apenas pedido próprio e horário confirmado sem cadastro alheio");
  const grade = await agendaDoPeriodo(data, 1, b.id);
  ok(grade.agendamentos.find(a => a.id === ags[0].id)?.totalServicosCentavos === 8000, "resumo da agenda da equipe inclui total dos dois serviços");
  for (const servicoId of servicos) await db.barbeiroServico.update({ where: { barbeiroId_servicoId: { barbeiroId: b.id, servicoId } }, data: { duracaoMin: 45, precoCentavos: servicoId === servicos[0] ? 6000 : 4000 } });
  const p4 = await criarPedido(clientes[1], usuarios[3], { ...entrada, chave: randomUUID(), horaPreferida: "16:00" });
  const prevista = await previaPedido(p4.id, b.id, hora(960));
  ok(prevista.duracaoMin === 90 && prevista.precoCentavos === 10000 && Date.parse(prevista.fim) === +hora(1050), "prévia usa overrides e mostra término às 17h30");
  await assert.rejects(decidirPedido(p4.id, ator, { ...aprovar, inicio: hora(960), precoEsperadoCentavos: 10000 }), /duração mudou/); checks++;
  await db.barbeiroServico.update({ where: { barbeiroId_servicoId: { barbeiroId: b.id, servicoId: servicos[0] } }, data: { precoCentavos: 6500 } });
  const decisaoAtual = { ...aprovar, inicio: hora(960), duracaoEsperadaMin: 90, precoEsperadoCentavos: 10000 };
  await assert.rejects(decidirPedido(p4.id, ator, decisaoAtual), /valor mudou/); checks++;
  ok(await db.agendamento.count({ where: { clienteId: clientes[1] } }) === 0 && (await db.pedidoAgendamento.findUniqueOrThrow({ where: { id: p4.id } })).status === "PENDENTE", "prévia obsoleta não cria reserva parcial nem aprova o pedido");
  const plano = await db.plano.create({ data: { nome: tag, precoCentavos: 10000, diasSemana: [(diaSemana(data) + 1) % 7], maxAgendamentosAbertos: 5, servicos: { create: servicos.map(servicoId => ({ servicoId })) } } }); planos.push(plano.id);
  await db.assinatura.create({ data: { clienteId: clientes[1], planoId: plano.id, status: "ATIVA", formaPagamento: "PIX", precoCentavos: 10000, origem: "SITE", cicloInicio: new Date() } });
  const avulso = await previaPedido(p4.id, b.id, hora(960));
  ok(avulso.requerAvulso && avulso.precoCentavos === 10500, "prévia de dia fora do plano informa total avulso e exige aceite");
  await assert.rejects(decidirPedido(p4.id, ator, { ...decisaoAtual, precoEsperadoCentavos: 10500 }), /vale só em/); checks++;
  const confirmadoAvulso = await decidirPedido(p4.id, ator, { ...decisaoAtual, precoEsperadoCentavos: 10500, forcarAvulso: true });
  ok(confirmadoAvulso.status === "APROVADO" && await db.agendamento.count({ where: { clienteId: clientes[1], assinaturaId: null } }) === 2, "aceite explícito aprova grupo avulso sem cobrança externa");
  console.log(`${checks} verificações PostgreSQL passaram; sem envio externo.`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await db.pedidoAgendamento.deleteMany({ where: { clienteId: { in: clientes } } });
  await db.agendamento.deleteMany({ where: { clienteId: { in: clientes } } });
  await db.assinatura.deleteMany({ where: { clienteId: { in: clientes } } });
  await db.planoServico.deleteMany({ where: { planoId: { in: planos } } });
  await db.plano.deleteMany({ where: { id: { in: planos } } });
  await db.cliente.deleteMany({ where: { id: { in: clientes } } });
  await db.expedientePadrao.deleteMany({ where: { barbeiroId: { in: barbeiros } } });
  await db.barbeiroServico.deleteMany({ where: { barbeiroId: { in: barbeiros } } });
  await db.barbeiro.deleteMany({ where: { id: { in: barbeiros } } });
  await db.servico.deleteMany({ where: { id: { in: servicos } } });
  await db.usuario.deleteMany({ where: { id: { in: usuarios } } });
  await db.$disconnect();
});
