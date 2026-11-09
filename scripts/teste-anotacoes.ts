/** Integração nominal descartável: cadastro, duplicidade e antecipação do grupo. */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { cadastrarPelaConversa } from "@/lib/clientes/conversa";
import { pagarAntecipado, sincronizarAntecipado, aoCancelarHorario, marcarPago } from "@/lib/agenda/antecipado";
import { cancelarPeloCliente, remarcarPeloCliente } from "@/lib/agenda/cliente";
import { pagarSimulada } from "@/lib/pagamentos/simulado";
import { abrirComanda, detalheComanda } from "@/lib/comandas/servico";
import { gateway } from "@/lib/pagamentos/gateway";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "55549" || url.pathname !== "/barberos_anotacoes_teste_20261109" || process.env.PAGAMENTOS_PROVIDER !== "simulado") throw Error("Use somente o banco nominal local e o gateway simulado.");
globalThis.fetch = async () => { throw Error("Rede bloqueada neste teste."); };
let checks = 0;
function ok(v: unknown, msg: string) { assert.ok(v, msg); checks++; console.log(`OK ${msg}`); }
const codigo = (v: string) => (e: unknown) => !!e && typeof e === "object" && "codigo" in e && e.codigo === v;

async function main() {
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const sessao = { usuarioId: dono.id, papel: dono.papel, nome: dono.nome, clienteId: null, barbeiroId: null, sessaoVersao: dono.sessaoVersao };
  const tag = `anotacoes-${randomUUID()}`;
  const telefone = `119${randomInt(10000000, 99999998)}`;
  const cadastrado = await cadastrarPelaConversa({ nome: tag, telefone }, sessao);
  const cliente = await db.cliente.findUniqueOrThrow({ where: { id: cadastrado.clienteId! } });
  ok(cadastrado.criado && cliente.telefone === `55${telefone}` && !cliente.aceitaMensagens && !cliente.usuarioId, "cadastro pelo WhatsApp normaliza telefone, sem envio, consentimento ou acesso de equipe");
  const repetidos = await Promise.all([1, 2, 3].map(() => cadastrarPelaConversa({ nome: "Não sobrescrever", telefone: `+55 (${telefone.slice(0, 2)}) ${telefone.slice(2, 7)}-${telefone.slice(7)}` }, sessao)));
  ok(repetidos.every(c => c.id === cadastrado.id && !c.criado) && await db.cliente.count({ where: { telefone: cliente.telefone } }) === 1, "cadastros concorrentes reutilizam cliente e conversa");
  ok((await db.cliente.findUniqueOrThrow({ where: { id: cliente.id } })).nome === tag && (await db.conversa.findUniqueOrThrow({ where: { id: cadastrado.id } })).estado === "HUMANO", "preserva o nome existente e inicia atendimento humano");
  ok(await db.mensagem.count({ where: { conversaId: cadastrado.id } }) === 0 && await db.auditoria.count({ where: { entidadeId: cliente.id, acao: "abrir_cadastro_conversa" } }) === 4, "audita os quatro acessos sem gerar mensagem");
  await db.cliente.update({ where: { id: cliente.id }, data: { cpf: "40563771038", email: "anotacoes@example.invalid" } });
  const outro = await db.cliente.create({ data: { nome: "Outro teste", telefone: `55${Number(telefone) + 1}`, aceitaMensagens: false } });
  const servicos = await db.servico.findMany({ where: { ativo: true }, take: 2, orderBy: { ordem: "asc" } });
  const barbeiro = await db.barbeiro.create({ data: { nome: tag, usuario: { create: { nome: tag, telefone: `${tag}-barbeiro`, papel: "BARBEIRO" } }, servicos: { create: servicos.map(s => ({ servicoId: s.id })) }, expediente: { create: Array.from({ length: 7 }, (_, diaSemana) => ({ diaSemana, inicioMin: 0, fimMin: 1440 })) } } });
  const criarGrupo = async (i: number) => {
    const inicio = new Date(Date.now() + (i + 3) * 86_400_000);
    const a = await db.agendamento.create({ data: { clienteId: cliente.id, barbeiroId: barbeiro.id, servicoId: servicos[0].id, precoCentavos: 5000, origem: "SITE", inicio, fim: new Date(+inicio + 60 * 60000) } });
    const extra = await db.agendamento.create({ data: { clienteId: cliente.id, barbeiroId: barbeiro.id, servicoId: servicos[1].id, precoCentavos: 3000, origem: "SITE", adicionalDeId: a.id, inicio: new Date(+inicio + 30 * 60000), fim: new Date(+inicio + 60 * 60000) } });
    return { a, extra };
  };
  const g1 = await criarGrupo(1);
  const emitir = (id: string, forma: "PIX" | "CARTAO" = "PIX") => pagarAntecipado({ clienteId: cliente.id, agendamentoId: id, forma });
  const corrida = await Promise.allSettled([emitir(g1.a.id), emitir(g1.a.id)]);
  ok(corrida.some(r => r.status === "fulfilled") && await db.cobrancaSimulada.count({ where: { assinaturaGatewayId: { startsWith: `avulsa:ag-${g1.a.id}-` } } }) === 1, "duas emissões concorrentes geram apenas uma cobrança simulada");
  const pg = await db.pagamentoAntecipado.findUniqueOrThrow({ where: { agendamentoId: g1.a.id } });
  ok(pg.valorCentavos === 8000 && !pg.emissaoChave, "pagamento agrega R$ 50 + R$ 30 e finaliza o claim conhecido");
  const repetido = await emitir(g1.a.id);
  ok(repetido.id === pg.id && repetido.valorCentavos === 8000, "repetição retorna a cobrança existente sem cobrar de novo");
  await assert.rejects(emitir(g1.a.id, "CARTAO"), codigo("antecipado_conferencia")); checks++;
  await assert.rejects(emitir(g1.extra.id), /não encontrado/); checks++;
  await assert.rejects(pagarAntecipado({ clienteId: outro.id, agendamentoId: g1.a.id, forma: "PIX" }), /não encontrado/); checks++;
  await pagarSimulada(pg.gatewayId!);
  await sincronizarAntecipado(pg.id); await sincronizarAntecipado(pg.id);
  ok((await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: pg.id } })).status === "PAGO", "prova monetária simulada confirma o pagamento uma única vez");
  const comanda = await abrirComanda(sessao, { agendamentoId: g1.a.id });
  const detalhe = await detalheComanda(comanda.id);
  ok(detalhe.itens.length === 2 && detalhe.pagamentos.filter(p => p.antecipadoId === pg.id).length === 1 && detalhe.resumo.falta === 0, "comanda recebe os dois serviços e um único pagamento integral");
  await assert.rejects(emitir(g1.a.id), codigo("na_comanda")); checks++;

  await db.configuracao.update({ where: { id: 1 }, data: { agendaExternaAtiva: false, botAtivo: false } });
  const g2 = await criarGrupo(2), p2 = await emitir(g2.a.id);
  await assert.rejects(remarcarPeloCliente(cliente.id, g2.a.id, new Date(+g2.a.inicio + 3600000), barbeiro.id, false, 8000, undefined, 60), codigo("antecipado_existente")); checks++;
  const remota2 = await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: p2.id } });
  await pagarSimulada(remota2.gatewayId!); await sincronizarAntecipado(p2.id);
  await cancelarPeloCliente(cliente.id, g2.a.id); await aoCancelarHorario(g2.a.id); await aoCancelarHorario(g2.a.id);
  const creditado = await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: p2.id } });
  ok(creditado.status === "CREDITADO" && await db.beneficio.count({ where: { clienteId: cliente.id, valorCentavos: 8000 } }) === 1, "cancelamento credita o total de todos os serviços uma única vez");

  const g3 = await criarGrupo(3);
  await db.pagamentoAntecipado.create({ data: { clienteId: cliente.id, agendamentoId: g3.a.id, valorCentavos: 8000, forma: "PIX", emissaoChave: randomUUID() } });
  await assert.rejects(emitir(g3.a.id), codigo("antecipado_conferencia")); checks++;
  ok(await db.cobrancaSimulada.count({ where: { assinaturaGatewayId: { startsWith: `avulsa:ag-${g3.a.id}-` } } }) === 0, "queda após claim não libera outra cobrança automaticamente");

  const g4 = await criarGrupo(4), p4 = await emitir(g4.a.id);
  const anterior = await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: p4.id } });
  const meio = await gateway(), buscarOriginal = meio.buscarCobrancaAvulsa!;
  await meio.cancelarCobrancaAvulsa!(anterior.gatewayId!);
  let capturar!: () => void, liberar!: () => void;
  const capturado = new Promise<void>(resolve => { capturar = resolve; });
  const respostaLiberada = new Promise<void>(resolve => { liberar = resolve; });
  let primeiraConsulta = true;
  meio.buscarCobrancaAvulsa = async id => {
    const resposta = await buscarOriginal(id);
    if (id === anterior.gatewayId && primeiraConsulta) { primeiraConsulta = false; capturar(); await respostaLiberada; }
    return resposta;
  };
  const consultaAntiga = sincronizarAntecipado(anterior.id);
  try {
    await Promise.race([capturado, consultaAntiga.then(() => { throw Error("A consulta antiga terminou antes da captura."); })]);
    await sincronizarAntecipado(anterior.id);
    await emitir(g4.a.id);
    const nova = await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: anterior.id } });
    liberar(); await consultaAntiga;
    const depois = await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: anterior.id } });
    ok(nova.gatewayId !== anterior.gatewayId && depois.status === "PENDENTE" && depois.gatewayId === nova.gatewayId, "resposta atrasada de cancelamento não altera a nova cobrança");
    await marcarPago(depois.id, new Date().toISOString(), { gatewayId: anterior.gatewayId!, valorCentavos: anterior.valorCentavos });
    ok((await db.pagamentoAntecipado.findUniqueOrThrow({ where: { id: depois.id } })).status === "PENDENTE", "prova da cobrança antiga não confirma a tentativa substituta");
    await pagarSimulada(depois.gatewayId!);
    const [, aberta] = await Promise.all([sincronizarAntecipado(depois.id), abrirComanda(sessao, { agendamentoId: g4.a.id })]);
    await sincronizarAntecipado(depois.id);
    const comandaConcorrente = await detalheComanda(aberta.id);
    ok(comandaConcorrente.pagamentos.filter(p => p.antecipadoId === depois.id).length === 1 && comandaConcorrente.resumo.falta === 0, "recebimento e abertura concorrentes lançam uma única antecipação na comanda");
    ok(await db.auditoria.count({ where: { entidadeId: g4.a.id, acao: "pagamento_antecipado_cancelado" } }) === 1, "cancelamento comprovado é auditado uma vez, sem evento para a resposta antiga");
  } finally { liberar(); await consultaAntiga; meio.buscarCobrancaAvulsa = buscarOriginal; }

  await db.cliente.update({ where: { id: outro.id }, data: { excluidoEm: new Date() } });
  await assert.rejects(cadastrarPelaConversa({ nome: "Não restaurar", telefone: outro.telefone }, sessao), /cadastro foi excluído/); checks++;
  const recepcao = await db.usuario.create({ data: { nome: tag, telefone: `${tag}-recepcao`, papel: "RECEPCAO", ativo: false, sessaoVersao: 4 } });
  const sessaoRevogada = { usuarioId: recepcao.id, sessaoVersao: 4 };
  const auditoriaAntes = await db.auditoria.count({ where: { entidadeId: cliente.id } });
  await assert.rejects(cadastrarPelaConversa({ nome: tag, telefone }, sessaoRevogada), /sessão mudou/); checks++;
  await db.usuario.update({ where: { id: recepcao.id }, data: { ativo: true, sessaoVersao: 5 } });
  await assert.rejects(cadastrarPelaConversa({ nome: tag, telefone }, sessaoRevogada), /sessão mudou/); checks++;
  await db.usuario.update({ where: { id: recepcao.id }, data: { papel: "BARBEIRO", sessaoVersao: 4 } });
  await assert.rejects(cadastrarPelaConversa({ nome: tag, telefone }, sessaoRevogada), /sessão mudou/); checks++;
  ok(await db.auditoria.count({ where: { entidadeId: cliente.id } }) === auditoriaAntes, "sessão revogada ou papel sem balcão não grava cadastro nem auditoria de sucesso");
  console.log(`PASS ${checks} verificações; banco nominal, dados fictícios e rede bloqueada.`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
