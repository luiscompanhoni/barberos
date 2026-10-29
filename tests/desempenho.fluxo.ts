/** Fluxo real isolado. Executar com DATABASE_URL local /barberos_test_desempenho. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, dataParaColuna, diaSemana, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { avaliarDesempenho } from "@/lib/desempenho/avaliacoes";
import { aprovarBonus } from "@/lib/desempenho/bonus";
import { justificarPresenca, proporAdesao, responderAdesao, salvarPrograma } from "@/lib/desempenho/configuracao";
import { painelDesempenho, resumoPessoa } from "@/lib/desempenho/consultas";
import { marcarPresenca, revisarAjuste, revisarAjustes, solicitarAjuste } from "@/lib/desempenho/presenca";
import { PROGRAMA_INICIAL } from "@/lib/desempenho/schemas";
import { excluirLancamento, fecharFolha } from "@/lib/rh/folha";
import { avaliarItem } from "@/lib/checklist/pontos";
import { marcarNoPainel, salvarCadastro } from "@/lib/checklist/servico";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.pathname, "/barberos_test_desempenho");
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  const usuarioIds: string[] = [], pessoaIds: string[] = [];
  const prefixo = randomUUID().slice(0, 8), agora = new Date(), fuso = (await configuracao()).fuso;
  const hoje = dataLocal(agora, fuso), comp = somarDias(`${hoje.slice(0, 7)}-01`, -1).slice(0, 7), dia = `${comp}-01`;
  let regraId: string | null = null;
  const sessao = (u: { id: string; nome: string; papel: Sessao["papel"] }): Sessao => ({ usuarioId: u.id, nome: u.nome, papel: u.papel, barbeiroId: null, clienteId: null });
  async function criar(nome: string, papel: Sessao["papel"]) {
    const u = await db.usuario.create({ data: { nome: `${prefixo} ${nome}`, telefone: `teste-${prefixo}-${usuarioIds.length}`, papel } }); usuarioIds.push(u.id);
    const p = await db.checklistPessoa.create({ data: { usuarioId: u.id, nome: u.nome, telefone: u.telefone, funcao: papel === "BARBEIRO" ? "BARBEIRO" : "GERENTE", token: randomUUID() } }); pessoaIds.push(p.id);
    return { s: sessao(u), p };
  }
  try {
    const dono = await criar("Dono", "DONO"), lider = await criar("Líder", "LIDER"), profissional = await criar("Profissional", "BARBEIRO"), segundo = await criar("Segundo", "BARBEIRO");
    await assert.rejects(() => painelDesempenho(profissional.s, comp, segundo.p.id), { status: 403 });
    const pessoal = await painelDesempenho(profissional.s);
    assert.equal(pessoal.pessoas.length, 1);
    assert.equal(pessoal.pessoas[0].id, profissional.p.id);
    const propostaDaApi = { acao: "propor_adesao", pessoaId: profissional.p.id, inicio: hoje, diasSemana: [0, 1, 2, 3, 4, 5, 6], inicioMin: 540, fimMin: 1080 };
    const adesao = await proporAdesao(dono.s, propostaDaApi);
    await assert.rejects(() => responderAdesao(dono.s, adesao.id, "aceitar"), { status: 403 });
    await responderAdesao(profissional.s, adesao.id, "aceitar");
    await assert.rejects(() => proporAdesao(dono.s, { pessoaId: profissional.p.id, inicio: hoje, diasSemana: [1], inicioMin: 540, fimMin: 1080 }), { status: 409 });
    const chave = randomUUID();
    const repetidas = await Promise.all(Array.from({ length: 3 }, () => marcarPresenca(profissional.s, { pessoaId: profissional.p.id, tipo: "ENTRADA", chave })));
    assert.equal(new Set(repetidas.map((m) => m.id)).size, 1);
    await assert.rejects(() => marcarPresenca(profissional.s, { pessoaId: segundo.p.id, tipo: "ENTRADA", chave: randomUUID() }), { status: 403 });
    await assert.rejects(() => marcarPresenca(profissional.s, { pessoaId: profissional.p.id, tipo: "RETORNO", chave: randomUUID() }), { status: 409 });
    const m = repetidas[0];
    const ajuste = await solicitarAjuste(profissional.s, { pessoaId: profissional.p.id, marcacaoId: m.id, instante: m.instante, motivo: "Conferência do relógio registrado" });
    await assert.rejects(() => revisarAjuste(profissional.s, { id: ajuste.id, aprovar: true }), { status: 403 });
    await revisarAjuste(lider.s, { id: ajuste.id, aprovar: true });
    await assert.rejects(() => revisarAjuste(lider.s, { id: ajuste.id, aprovar: true }), { status: 409 });
    const orig = await db.presencaMarcacao.findUniqueOrThrow({ where: { id: m.id } });
    assert.equal(+orig.instante, +m.instante, "Original preservado após ajuste");
    const esquecida = await solicitarAjuste(segundo.s, { pessoaId: segundo.p.id, tipo: "ENTRADA", instante: new Date(instanteLocal(hoje, 0, fuso)), motivo: "Batida de entrada não registrada" });
    await revisarAjuste(lider.s, { id: esquecida.id, aprovar: true });
    assert.equal(await db.presencaMarcacao.count({ where: { chave: `ajuste:${esquecida.id}` } }), 1);
    await assert.rejects(() => avaliarDesempenho(lider.s, { pessoaId: lider.p.id, data: hoje, tipo: "DIARIA", notas: { execucao: 5, organizacao: 5, atendimento: 5, colaboracao: 5 }, comentario: "" }), { status: 403 });
    await assert.rejects(() => avaliarDesempenho(lider.s, { pessoaId: profissional.p.id, data: hoje, tipo: "DIARIA", notas: { execucao: 1, organizacao: 5, atendimento: 5, colaboracao: 5 }, comentario: "" }), /Explique/);
    await assert.rejects(() => salvarPrograma(dono.s, comp, PROGRAMA_INICIAL), /próximo mês/);
    // Abono conta como dia cumprido: a liderança registra folga, mas só o dono concede ou troca um abono.
    const folga = { pessoaId: profissional.p.id, data: hoje, motivo: "Combinado com a gestão da barbearia" };
    await assert.rejects(() => justificarPresenca(lider.s, { ...folga, tipo: "ABONO" }), { status: 403 });
    // Dia que já passou muda a apuração do bônus: nem folga a liderança lança.
    await assert.rejects(() => justificarPresenca(lider.s, { ...folga, data: somarDias(hoje, -1), tipo: "FOLGA" }), { status: 403 });
    await justificarPresenca(lider.s, { ...folga, tipo: "FOLGA" });
    await justificarPresenca(dono.s, { ...folga, tipo: "ABONO" });
    await assert.rejects(() => justificarPresenca(lider.s, { ...folga, tipo: "FOLGA" }), { status: 403 });
    assert.equal((await db.presencaJustificativa.findUniqueOrThrow({ where: { pessoaId_data: { pessoaId: profissional.p.id, data: hoje } } })).tipo, "ABONO");
    // Com outro dono ativo, ninguém aprova o próprio bônus.
    const socio = await criar("Sócio", "DONO");
    await assert.rejects(() => aprovarBonus(dono.s, dono.p.id, comp), /Outro dono/);
    await db.usuario.update({ where: { id: socio.s.usuarioId }, data: { ativo: false } });
    const programa = structuredClone(PROGRAMA_INICIAL);
    programa.ativo = true; programa.pontosPresenca = 10; programa.pontosLider = 15;
    programa.faixas.PLATINA = { bonusCentavos: 20000, presencaMinPct: 100, checklistMinPct: 100, liderMin: 4, clientesMin: null };
    const regra = await db.desempenhoRegra.upsert({ where: { competenciaInicio: comp }, create: { competenciaInicio: comp, config: programa, criadoPorId: dono.s.usuarioId }, update: { config: programa } }); regraId = regra.id;
    for (const alvo of [profissional, segundo]) {
      await db.desempenhoAdesao.create({ data: { pessoaId: alvo.p.id, inicio: dia, diasSemana: [diaSemana(dia)], inicioMin: 540, fimMin: 1080, aceitaEm: new Date(instanteLocal(somarDias(dia, -1), 0, fuso)), encerradaEm: new Date(instanteLocal(somarDias(dia, 1), 0, fuso)), criadoPorId: dono.s.usuarioId } });
      await db.presencaMarcacao.createMany({ data: [{ tipo: "ENTRADA", minuto: 540 }, { tipo: "SAIDA", minuto: 1080 }].map((v) => ({ pessoaId: alvo.p.id, tipo: v.tipo, instante: new Date(instanteLocal(dia, v.minuto, fuso)), chave: randomUUID(), criadoPorId: alvo.s.usuarioId })) });
      await db.checklistItem.create({ data: { pessoaId: alvo.p.id, data: dataParaColuna(dia), titulo: "Conferência de teste", ordem: 0, feito: true, avaliacao: "VALIDADO" } });
      await db.checklistPonto.create({ data: { pessoaId: alvo.p.id, pontos: 600, descricao: "Histórico preservado", criadoEm: new Date(instanteLocal(dia, 600, fuso)) } });
      await avaliarDesempenho(lider.s, { pessoaId: alvo.p.id, data: dia, tipo: "DIARIA", notas: { execucao: 5, organizacao: 5, atendimento: 5, colaboracao: 5 }, comentario: "Critérios atendidos no dia de teste" });
      await avaliarDesempenho(lider.s, { pessoaId: alvo.p.id, data: dia, tipo: "SEMANAL", notas: { execucao: 5, organizacao: 5, atendimento: 5, colaboracao: 5 }, comentario: "Fechamento semanal sem dupla pontuação" });
    }
    const pausa = await solicitarAjuste(profissional.s, { pessoaId: profissional.p.id, tipo: "PAUSA", instante: new Date(instanteLocal(dia, 720, fuso)), motivo: "Pausa esquecida durante o expediente" });
    const retorno = await solicitarAjuste(profissional.s, { pessoaId: profissional.p.id, tipo: "RETORNO", instante: new Date(instanteLocal(dia, 780, fuso)), motivo: "Retorno esquecido depois do intervalo" });
    await assert.rejects(() => revisarAjuste(lider.s, { id: pausa.id, aprovar: true }), /sequência/);
    await revisarAjustes(lider.s, { ids: [pausa.id, retorno.id], aprovar: true });
    const resumo = await resumoPessoa(profissional.p.id, comp);
    assert.equal(resumo.resultado.elegivel, true, JSON.stringify(resumo.resultado));
    assert.equal(resumo.lider.diasAvaliados, 1);
    assert.equal(resumo.presenca.dias[0].minutos, 480);
    await assert.rejects(() => aprovarBonus(lider.s, profissional.p.id, comp), { status: 403 });
    const bonus = await Promise.all(Array.from({ length: 3 }, () => aprovarBonus(dono.s, profissional.p.id, comp)));
    assert.equal(bonus.filter((b) => !b.jaAprovado).length, 1);
    assert.equal(await db.folhaLancamento.count({ where: { pessoaId: profissional.p.id, competencia: comp } }), 1);
    const pontos = await db.checklistPonto.aggregate({ where: { pessoaId: profissional.p.id }, _sum: { pontos: true } });
    assert.equal(pontos._sum.pontos, 625);
    const lancamento = await db.folhaLancamento.findFirstOrThrow({ where: { pessoaId: profissional.p.id, competencia: comp } });
    await assert.rejects(() => excluirLancamento(dono.s, lancamento.id), { status: 409 });
    await db.checklistItem.updateMany({ where: { pessoaId: profissional.p.id }, data: { avaliacao: null } });
    const memoria = await resumoPessoa(profissional.p.id, comp);
    assert.equal(memoria.checklist.validados, 0, "O indicador vivo recebeu dado posterior");
    assert.equal(memoria.resultado.criterios.find((c) => c.nome === "Checklist")?.cumpriu, true, "A aprovação preserva os critérios usados na época");
    await assert.rejects(() => avaliarDesempenho(lider.s, { pessoaId: profissional.p.id, data: dia, tipo: "DIARIA", notas: { execucao: 4, organizacao: 4, atendimento: 4, colaboracao: 4 }, comentario: "Não pode alterar período fechado" }), { status: 409 });
    await fecharFolha(dono.s, comp, profissional.p.id);
    // Pontos de mês fechado não mudam: desfazer, dar ré ou desmarcar a tarefa é recusado.
    const itemFechado = await db.checklistItem.create({ data: { pessoaId: profissional.p.id, data: dataParaColuna(dia), titulo: "Tarefa do mês fechado", ordem: 1, feito: true, avaliacao: "VALIDADO" } });
    await db.checklistPonto.create({ data: { pessoaId: profissional.p.id, itemId: itemFechado.id, pontos: 10, descricao: "Validada: Tarefa do mês fechado", criadoEm: new Date(instanteLocal(dia, 700, fuso)) } });
    await assert.rejects(() => avaliarItem(dono.s, itemFechado.id, null), /mês já fechado/);
    await assert.rejects(() => avaliarItem(dono.s, itemFechado.id, "RE", "Marcou sem fazer"), /mês já fechado/);
    await assert.rejects(() => marcarNoPainel(dono.s, itemFechado.id, false), /mês já fechado/);
    assert.equal((await db.checklistPonto.findUniqueOrThrow({ where: { itemId: itemFechado.id } })).pontos, 10);
    // Mês aberto: reavaliar troca os pontos, mas mantém a data original (o ponto não muda de mês).
    const itemAberto = await db.checklistItem.create({ data: { pessoaId: segundo.p.id, data: dataParaColuna(hoje), titulo: "Tarefa do mês aberto", ordem: 1, feito: true } });
    await avaliarItem(dono.s, itemAberto.id, "VALIDADO");
    const dataOriginal = new Date(instanteLocal(`${hoje.slice(0, 7)}-01`, 0, fuso));
    await db.checklistPonto.update({ where: { itemId: itemAberto.id }, data: { criadoEm: dataOriginal } });
    await avaliarItem(dono.s, itemAberto.id, "RE", "Marcou sem fazer");
    const reavaliado = await db.checklistPonto.findUniqueOrThrow({ where: { itemId: itemAberto.id } });
    assert(reavaliado.pontos < 0); assert.equal(+reavaliado.criadoEm, +dataOriginal);
    // Mudar os pontos das faixas: só o dono, e quem muda de faixa aparece antes de salvar (nada é gravado).
    const faixasNovas = { config: { ativo: false, horaEnvio: "08:00", horaResumo: "20:00", nivelPlatina: 100_000, nivelLegend: 200_000 }, pessoas: [], tarefas: [] };
    await assert.rejects(() => salvarCadastro(dono.s, faixasNovas), (e: { codigo?: string; detalhes?: { mudancas: { nome: string; para: string; quando: string }[] } }) =>
      e.codigo === "confirmar_faixas" && !!e.detalhes?.mudancas.some((m) => m.nome === profissional.p.nome && m.para === "ELITE" && m.quando === "agora")
      // O bônus de comp do segundo ainda não foi aprovado: a prévia mostra que ele também mudaria de faixa ali.
      && !!e.detalhes?.mudancas.some((m) => m.nome === segundo.p.nome && m.quando === comp)
      && !e.detalhes?.mudancas.some((m) => m.nome === profissional.p.nome && m.quando === comp));
    assert.equal((await db.folhaPagamento.findUniqueOrThrow({ where: { competencia_pessoaId: { competencia: comp, pessoaId: profissional.p.id } } })).adicionaisCentavos, 20000);
    await Promise.allSettled([aprovarBonus(dono.s, segundo.p.id, comp), fecharFolha(dono.s, comp, segundo.p.id)]);
    const folhaSegunda = await db.folhaPagamento.findUnique({ where: { competencia_pessoaId: { competencia: comp, pessoaId: segundo.p.id } } });
    const lancsSegunda = await db.folhaLancamento.aggregate({ where: { pessoaId: segundo.p.id, competencia: comp }, _sum: { valorCentavos: true } });
    if (folhaSegunda) assert.equal(folhaSegunda.adicionaisCentavos, lancsSegunda._sum.valorCentavos ?? 0, "Concorrência nunca congela folha sem o bônus registrado");
    else assert.equal(lancsSegunda._sum.valorCentavos, 20000, "O bônus foi registrado e a folha aguarda nova conferência");
    console.log("PASS desempenho: acesso próprio, adesão, marcação idempotente, ajustes auditados, notas sem autoavaliação, bônus único, pontos preservados e concorrência com folha.");
  } finally {
    await db.desempenhoBonus.deleteMany({ where: { pessoaId: { in: pessoaIds } } });
    await db.presencaAjuste.deleteMany({ where: { pessoaId: { in: pessoaIds } } });
    await db.presencaMarcacao.deleteMany({ where: { pessoaId: { in: pessoaIds } } });
    await db.presencaJustificativa.deleteMany({ where: { pessoaId: { in: pessoaIds } } });
    await db.desempenhoAdesao.deleteMany({ where: { pessoaId: { in: pessoaIds } } });
    await db.desempenhoAvaliacao.deleteMany({ where: { pessoaId: { in: pessoaIds } } });
    await db.checklistPessoa.deleteMany({ where: { id: { in: pessoaIds } } });
    await db.usuario.deleteMany({ where: { id: { in: usuarioIds } } });
    if (regraId && !await db.desempenhoBonus.count({ where: { regraId } })) await db.desempenhoRegra.delete({ where: { id: regraId } });
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : "Falha no fluxo de desempenho"); process.exitCode = 1; });
