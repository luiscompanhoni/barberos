import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { dataLocal, diaSemana, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { executarTurno, type Modelo } from "@/lib/bot/agente";
import { executarFerramenta, type ContextoBot } from "@/lib/bot/ferramentas";
import { contextoDaMensagem } from "@/lib/bot/prompt";
import { aberturaReativacao } from "@/lib/automacoes/regras";
import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";
import { criarLancamentoPessoal } from "@/lib/financeiro/pessoal";

const banco = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (banco.hostname !== "127.0.0.1" || banco.pathname !== "/barberos_revisao_bot_descartavel" ||
  process.env.AMBIENTE !== "homologacao" || process.env.WHATSAPP_PROVIDER !== "simulador" ||
  process.env.PAGAMENTOS_PROVIDER !== "simulado" || process.env.WHATSAPP_ENVIOS_BLOQUEADOS !== "true" ||
  process.env.WHATSAPP_ATENDIMENTO_IA_PAGA !== "false" || process.env.PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS !== "true") {
  throw new Error("Use somente o PostgreSQL descartável, com provedores simulados e efeitos reais bloqueados.");
}
globalThis.fetch = async () => { throw new Error("Rede bloqueada no teste do bot."); };

type Historico = Anthropic.Beta.BetaMessageParam[];
function turno(ctx: ContextoBot, texto: string, historico: Historico, nome: string, entrada: unknown, resposta: string) {
  const falas = [
    { content: [{ type: "tool_use", id: randomUUID(), name: nome, input: entrada }], stop_reason: "tool_use" },
    { content: [{ type: "text", text: resposta }], stop_reason: "end_turn" },
  ];
  const modelo: Modelo = { criar: async () => {
    const fala = falas.shift();
    assert.ok(fala, "o teste só usa respostas roteirizadas");
    return fala as unknown as Anthropic.Beta.BetaMessage;
  } };
  return executarTurno({ sistema: "", contexto: "", texto, historico, modelo, ctx: { ...ctx, textoEntrada: texto } });
}

function resultado(historico: Historico) {
  const retorno = historico.findLast(m => m.role === "user" && Array.isArray(m.content) && m.content.some(b => b.type === "tool_result"));
  const bloco = Array.isArray(retorno?.content) && retorno.content.find(b => b.type === "tool_result");
  assert.ok(bloco && bloco.type === "tool_result" && typeof bloco.content === "string");
  return { content: bloco.content, is_error: bloco.is_error };
}

const celular = () => `554799${randomInt(10_000_000, 100_000_000)}`;

async function main() {
  const fuso = "America/Sao_Paulo";
  const cfg = await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, fuso },
    update: { fuso, agendaExternaAtiva: false, botAtivo: false } });
  const hoje = dataLocal(Date.now(), cfg.fuso);
  const data = somarDias(hoje, 3);
  const profissional = await db.usuario.create({ data: { nome: "Barbeiro teste", telefone: celular(), papel: "BARBEIRO", telefoneVerificadoEm: new Date() } });
  const barbeiro = await db.barbeiro.create({ data: { usuarioId: profissional.id, nome: "Barbeiro teste",
    expediente: { create: { diaSemana: diaSemana(data), inicioMin: 780, fimMin: 1140 } } } });
  const servico = await db.servico.create({ data: { nome: "Corte teste", precoCentavos: 6000, duracaoMin: 30,
    barbeiros: { create: { barbeiroId: barbeiro.id } } } });
  const titular = await db.usuario.create({ data: { nome: "Cliente teste", telefone: celular(), papel: "CLIENTE", telefoneVerificadoEm: new Date() } });
  const cliente = await db.cliente.create({ data: { usuarioId: titular.id, nome: titular.nome, telefone: titular.telefone } });
  const conversa = await db.conversa.create({ data: { clienteId: cliente.id, telefone: cliente.telefone, nomePerfil: cliente.nome } });
  const ctx = { conversaId: conversa.id, telefone: cliente.telefone, nomePerfil: cliente.nome };
  const consulta = { data, servico_id: servico.id, barbeiro_id: barbeiro.id };

  const consultado = await turno(ctx, "Quais horários tem para corte?", [], "consultar_horarios", consulta, "Consultei.");
  const opcoes = JSON.parse(resultado(consultado.historico).content).opcoes as { horario: string }[];
  assert.equal(opcoes.length, 2);
  const oferta: Historico = [...consultado.historico.slice(0, -1),
    { role: "assistant", content: `Corte com Barbeiro teste no dia ${data}. Tenho ${opcoes[0].horario} ou ${opcoes[1].horario}. Qual prefere?` }];
  const desvio = await turno(ctx, "A segunda", oferta, "agendar", { ...consulta, data: somarDias(data, 1), horario: opcoes[1].horario }, "Vou conferir.");
  assert.equal(resultado(desvio.historico).is_error, true);
  assert.equal(await db.agendamento.count({ where: { clienteId: cliente.id } }), 0);
  await db.configuracao.update({ where: { id: 1 }, data: { agendaExternaAtiva: true } });
  const transferido = await turno(ctx, "A primeira", oferta, "agendar", { ...consulta, horario: opcoes[0].horario }, "Pronto.");
  assert.equal(transferido.passouParaHumano, true);
  assert.equal(await db.agendamento.count({ where: { clienteId: cliente.id } }), 0);
  await db.configuracao.update({ where: { id: 1 }, data: { agendaExternaAtiva: false } });
  const confirmado = await turno(ctx, "A segunda", oferta, "agendar", { ...consulta, horario: opcoes[1].horario }, "Pronto.");
  assert.match(resultado(confirmado.historico).content, /^Agendado/);
  assert.equal(await db.agendamento.count({ where: { clienteId: cliente.id, barbeiroId: barbeiro.id, origem: "BOT" } }), 1);
  console.log("OK Agenda. Duas vagas reais, reserva da segunda, divergência recusada e transferência durante a transição.");

  const retorno = await db.cliente.create({ data: { nome: "Ygor teste", telefone: celular() } });
  const conversaRetorno = await db.conversa.create({ data: { clienteId: retorno.id, telefone: retorno.telefone } });
  const ctxRetorno = { conversaId: conversaRetorno.id, telefone: retorno.telefone, nomePerfil: retorno.nome };
  for (const [dias, minuto] of [[40, 1110], [48, 1050]]) {
    const inicio = instanteLocal(somarDias(hoje, -dias), minuto, fuso);
    await db.agendamento.create({ data: { clienteId: retorno.id, barbeiroId: barbeiro.id, servicoId: servico.id, inicio: new Date(inicio),
      fim: new Date(inicio + 30 * 60_000), status: "CONCLUIDO", origem: "RECEPCAO", precoCentavos: 6000 } });
  }
  const informacao = contextoDaMensagem({ agora: Date.now(), fuso, inicioDeSessao: true, janelaDias: 7,
    cliente: retorno, nomePerfil: retorno.nome, avisos: [...aberturaReativacao(retorno.nome)] });
  assert.match(informacao, /respondeu à abertura da reativação/);
  const preferencia = await turno(ctxRetorno, "Pode ser, melhor à noite", [], "minha_preferencia_de_atendimento", {},
    "Vou conferir perto do teu horário de costume.");
  const passado = JSON.parse(resultado(preferencia.historico).content);
  assert.equal(passado.visitas_consideradas, 2);
  assert.equal(passado.horario_medio, "18:00");
  assert.equal(passado.ultimo_barbeiro.barbeiro_id, barbeiro.id);
  assert.equal(passado.ultimo_servico.servico_id, servico.id);
  assert.deepEqual(JSON.parse((await executarFerramenta("minha_preferencia_de_atendimento", {}, ctx)).texto), { visitas_consideradas: 0 });
  const consultaRetorno = { ...consulta, periodo: "NOITE", horario_preferido: passado.horario_medio };
  const consultaPreferida = await turno(ctxRetorno, "Melhor à noite", preferencia.historico, "consultar_horarios", consultaRetorno, "Consultei.");
  const vagaPreferida = JSON.parse(resultado(consultaPreferida.historico).content).opcoes[0].horario as string;
  assert.equal(vagaPreferida, "18:00");
  const ofertaRetorno: Historico = [...consultaPreferida.historico.slice(0, -1),
    { role: "assistant", content: `Ó, tenho corte com ${barbeiro.nome} em ${data} às 18h. Pode ser pra ti?` }];
  const reservouRetorno = await turno(ctxRetorno, "Pô, pode marcar", ofertaRetorno, "agendar", { ...consulta, horario: vagaPreferida }, "Marcado!");
  assert.match(resultado(reservouRetorno.historico).content, /^Agendado/);
  assert.equal(await db.agendamento.count({ where: { clienteId: retorno.id, origem: "BOT", status: "MARCADO" } }), 1);
  console.log("OK Reativação. Abertura no contexto, histórico próprio, vaga das 18h com o profissional da última visita e reserva no primeiro aceite.");

  const membro = { ...ctx, telefone: profissional.telefone, textoEntrada: "Gastei 1.200,35 reais com farmácia", entradaId: randomUUID() };
  const entradaDespesa = { valor_centavos: 120035, descricao: "Farmácia", categoria: "Saúde" };
  const respostas = await Promise.all([1, 2].map(() => executarFerramenta("registrar_minha_despesa", entradaDespesa, membro)));
  assert.ok(respostas.every(r => !r.erro));
  assert.equal(await db.lancamentoPessoal.count({ where: { usuarioId: profissional.id, valorCentavos: 120035, tipo: "DESPESA" } }), 1);
  assert.equal((await executarFerramenta("indicadores_da_barbearia", {}, membro)).erro, true);
  assert.equal((await executarFerramenta("registrar_minha_despesa", entradaDespesa, { ...membro, telefone: titular.telefone })).erro, true);
  await db.usuario.update({ where: { id: profissional.id }, data: { telefoneVerificadoEm: null } });
  await assert.rejects(criarLancamentoPessoal(profissional.id, {
    tipo: "DESPESA", valorCentavos: 120035, descricao: "Farmácia", categoria: "Saúde", data: hoje, realizado: true,
  }, { id: randomUUID(), telefone: profissional.telefone }), { status: 403 });
  assert.equal(await db.lancamentoPessoal.count({ where: { usuarioId: profissional.id } }), 1);
  console.log("OK Permissões. Titularidade, papel, telefone revogado e idempotência do lançamento foram conferidos.");

  const atual = await db.plano.create({ data: { nome: "Plano Base teste", precoCentavos: 10000 } });
  const renovacao = somarDias(hoje, 15);
  const assinatura = await db.assinatura.create({ data: {
    clienteId: cliente.id, planoId: atual.id, status: "ATIVA", formaPagamento: "CARTAO", precoCentavos: 10000,
    origem: "SITE", proximoVencimento: new Date(renovacao), gatewayId: `sim_${randomUUID()}`,
  } });
  const link = await executarFerramenta("link_pagamento_assinatura", { forma: "PIX" }, ctx);
  assert.ok(!link.erro);
  const orientacao = JSON.parse(link.texto);
  assert.equal(orientacao.cobranca_aberta_encontrada, false);
  assert.equal(orientacao.forma_atual, "CARTAO");
  assert.equal(orientacao.link_area_do_plano, `${urlSite()}/c/planos`);
  assert.equal(orientacao.link, undefined);
  assert.equal(await db.cobranca.count({ where: { assinaturaId: assinatura.id } }), 0);
  for (const [tipo, valor] of [["UPGRADE", 15000], ["DOWNGRADE", 8000]] as const) {
    const nome = `Plano ${tipo} teste`;
    const novo = await db.plano.create({ data: { nome, precoCentavos: valor } });
    const troca = { plano_id: novo.id, nome_conferido: nome, preco_conferido_centavos: valor, renovacao_conferida: renovacao };
    const texto = `${nome} por R$ ${valor / 100},00 na renovação de ${renovacao}.`;
    const proposta: Historico = [{ role: "assistant", content: texto }];
    const conferido = await turno(ctx, "Pode trocar", proposta, "solicitar_troca_plano", troca, "Solicitado.");
    assert.equal(JSON.parse(resultado(conferido.historico).content).tipo, tipo);
    const reenvio = await turno(ctx, "Pode trocar", proposta, "solicitar_troca_plano", troca, "Solicitado.");
    assert.equal(JSON.parse(resultado(reenvio.historico).content).pedido, "SOLICITADA");
    const pedido = await db.alteracaoPlanoAssinatura.findMany({ where: { assinaturaId: assinatura.id, estado: "SOLICITADA" } });
    assert.equal(pedido.length, 1);
    await db.alteracaoPlanoAssinatura.update({ where: { id: pedido[0].id }, data: { estado: "CANCELADA" } });
  }
  assert.equal((await db.assinatura.findUniqueOrThrow({ where: { id: assinatura.id } })).planoId, atual.id);
  assert.equal(await db.cobranca.count({ where: { assinaturaId: assinatura.id } }), 0);
  console.log("OK Assinaturas. Upgrade e downgrade idempotentes, cartão sem mensalidade aberta e zero cobrança criada.");
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
