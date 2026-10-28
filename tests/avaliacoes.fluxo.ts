/** Executar com tsx e DATABASE_URL apontando exclusivamente para barberos_test_qualidade. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Sessao } from "@/lib/auth/sessao";
import { assegurarConvitePrimeiraVisita, conviteDoCliente } from "@/lib/avaliacoes/convites";
import { responderAvaliacao, consultarIdentidadeAvaliacao } from "@/lib/avaliacoes/respostas";
import { resumoPublicado, resumoAvaliacaoBarbeiro } from "@/lib/avaliacoes/resumos";
import { salvarConfiguracaoAvaliacao } from "@/lib/avaliacoes/configuracao";
import { processarConvitesAvaliacao } from "@/lib/avaliacoes/automacao";
import { reenviarConvitesSemSaida } from "@/lib/avaliacoes/reenvio";
import { sincronizarFichas } from "@/lib/jogos/fichas";
import { competenciaResposta } from "@/lib/avaliacoes/regras";

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/barberos_test_qualidade", "Use o banco isolado de testes");
  assert.equal(process.env.WHATSAPP_PROVIDER, "simulador", "Mensagens reais não são permitidas neste teste");
  const sufixo = randomUUID().slice(0, 8);
  let numero = 0;
  const agora = new Date();
  const ontem = new Date(agora.getTime() - 86_400_000);
  const antigo = new Date(agora.getTime() - 20 * 86_400_000);
  const dono = await db.usuario.create({ data: { nome: "Teste dono", telefone: `teste-dono-${sufixo}`, papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, nome: dono.nome, papel: "DONO", barbeiroId: null, clienteId: null };
  const usuario = await db.usuario.create({ data: { nome: "Teste barbeiro", telefone: `teste-barber-${sufixo}`, papel: "BARBEIRO" } });
  const barbeiro = await db.barbeiro.create({ data: { nome: "Teste barbeiro", usuarioId: usuario.id } });
  const servico = await db.servico.create({ data: { nome: "Teste serviço", duracaoMin: 10, precoCentavos: 6500 } });
  const jogo = await db.jogo.create({ data: { id: `avaliacao-${sufixo}`, tipo: "ROLETA", nome: "Roleta teste", ativo: true, contarDesde: antigo, jogadasPorAtendimento: 1, jogadasAniversario: 1 } });
  await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  await db.avaliacaoConfig.upsert({ where: { id: 1 }, create: { id: 1, ativo: true, ativaDesde: ontem, jogoId: jogo.id }, update: { ativo: true, ativaDesde: ontem, jogoId: jogo.id, whatsapp: false } });

  async function cliente(fim?: Date) {
    const n = ++numero;
    const c = await db.cliente.create({ data: { nome: `Cliente teste ${n}`, telefone: `teste-${sufixo}-${n}`, aceitaMensagens: false } });
    const termino = fim ?? new Date(agora.getTime() - 86_400_000 + n * 20 * 60_000);
    const a = await db.agendamento.create({ data: {
      clienteId: c.id, barbeiroId: barbeiro.id, servicoId: servico.id, origem: "RECEPCAO", status: "CONCLUIDO",
      inicio: new Date(termino.getTime() - 10 * 60_000), fim: termino, precoCentavos: 6500,
    } });
    return { c, a };
  }

  const recorrente = await cliente(antigo);
  await db.agendamento.create({ data: { ...recorrente.a, id: undefined, inicio: new Date(agora.getTime() - 10 * 60_000), fim: agora } });
  assert.equal(await assegurarConvitePrimeiraVisita(recorrente.c.id), null, "Cliente antigo não recebe convite de primeira visita");
  const primeiro = await cliente();
  const adicional = await db.agendamento.create({ data: { ...primeiro.a, id: undefined, adicionalDeId: primeiro.a.id } });
  assert(adicional.id);
  const convites = await Promise.all(Array.from({ length: 4 }, () => assegurarConvitePrimeiraVisita(primeiro.c.id)));
  assert.equal(new Set(convites.map(c => c?.id)).size, 1, "Concorrência não duplica convite");
  const convite = convites[0]!;
  await db.$transaction(tx => sincronizarFichas(tx, primeiro.c.id, jogo));
  assert.equal(await db.fichaJogo.count({ where: { clienteId: primeiro.c.id, jogoId: jogo.id } }), 0, "Primeira visita e adicional esperam avaliação");
  await assert.rejects(responderAvaliacao(recorrente.c.id, { conviteId: convite.id, nota: 5 }), { status: 404 });
  const respostas = await Promise.all(Array.from({ length: 4 }, () => responderAvaliacao(primeiro.c.id, { conviteId: convite.id, nota: 1, corte: 1, atendimento: 5, comentario: "Pode melhorar" })));
  assert.equal(respostas.filter(r => !r.repetida).length, 1, "Uma resposta grava, as demais são repetidas");
  assert.equal(await db.fichaJogo.count({ where: { clienteId: primeiro.c.id, origem: "AVALIACAO" } }), 1, "Nota baixa ganha exatamente uma jogada");
  await db.$transaction(tx => sincronizarFichas(tx, primeiro.c.id, jogo));
  assert.equal(await db.fichaJogo.count({ where: { clienteId: primeiro.c.id, jogoId: jogo.id } }), 1, "Não duplica a ficha por atendimento depois de avaliar");
  const parcial = await resumoPublicado(barbeiro.id);
  assert.equal(parcial.media, null);
  assert.equal(parcial.quantidade, 0);
  for (let k = 0; k < 4; k++) {
    const x = await cliente();
    const i = (await assegurarConvitePrimeiraVisita(x.c.id))!;
    await responderAvaliacao(x.c.id, { conviteId: i.id, nota: 5, atendimento: 5 });
  }
  const lote = await resumoPublicado(barbeiro.id);
  assert.equal(lote.media, 4.2);
  assert.equal(lote.quantidade, 5);
  assert.equal(lote.categorias.find(c => c.chave === "corte")?.media, null, "Nota opcional com base1 não vaza");
  assert.equal(JSON.stringify(lote).includes("Cliente teste"), false);
  const sexta = await cliente();
  await responderAvaliacao(sexta.c.id, { conviteId: (await assegurarConvitePrimeiraVisita(sexta.c.id))!.id, nota: 1, atendimento: 1 });
  assert.deepEqual(await resumoPublicado(barbeiro.id), lote, "Sexta avaliação não altera nenhum agregado público");
  assert.equal((await resumoAvaliacaoBarbeiro(barbeiro.id, competenciaResposta(agora))).quantidade, 5);
  for (let k = 0; k < 4; k++) {
    const x = await cliente();
    await responderAvaliacao(x.c.id, { conviteId: (await assegurarConvitePrimeiraVisita(x.c.id))!.id, nota: 3 });
  }
  const loteDois = await resumoPublicado(barbeiro.id);
  assert.equal(loteDois.quantidade, 10);
  assert.equal(loteDois.categorias.find(c => c.chave === "atendimento")?.media, 5, "Nova publicação global mantém categoria com seis respostas em lote de cinco");
  const resposta = await db.avaliacaoCliente.findUniqueOrThrow({ where: { conviteId: convite.id } });
  await assert.rejects(consultarIdentidadeAvaliacao({ ...s, papel: "GERENTE" }, resposta.id), { status: 403 });
  const detalhe = await consultarIdentidadeAvaliacao(s, resposta.id);
  assert.equal(detalhe.cliente, primeiro.c.nome);
  assert.equal(await db.auditoria.count({ where: { acao: "consultar_identidade_avaliacao", entidadeId: resposta.id } }), 1);
  await assert.rejects(salvarConfiguracaoAvaliacao({ ...s, papel: "BARBEIRO" }, { ativo: true, whatsapp: false, jogoId: jogo.id, validadeDias: 14, recompensaValidadeDias: 30 }), { status: 403 });
  const expirado = await cliente();
  const ie = (await assegurarConvitePrimeiraVisita(expirado.c.id))!;
  await db.conviteAvaliacao.update({ where: { id: ie.id }, data: { expiraEm: antigo } });
  await assert.rejects(responderAvaliacao(expirado.c.id, { conviteId: ie.id, nota: 5 }), { codigo: "convite_expirado" });
  assert.equal((await conviteDoCliente(expirado.c.id))?.expirada, true);
  const desativada = await cliente();
  await db.avaliacaoConfig.update({ where: { id: 1 }, data: { ativo: false } });
  assert.equal(await assegurarConvitePrimeiraVisita(desativada.c.id), null);
  assert.equal(await processarConvitesAvaliacao({ clienteIds: [desativada.c.id] }), 0);
  await db.avaliacaoConfig.update({ where: { id: 1 }, data: { ativo: true } });
  assert.equal(await processarConvitesAvaliacao({ clienteIds: [desativada.c.id] }), 0);
  assert(await db.conviteAvaliacao.findUnique({ where: { clienteId: desativada.c.id } }), "Convite interno existe com WhatsApp desligado");
  await db.avaliacaoConfig.update({ where: { id: 1 }, data: { whatsapp: true } });
  await db.cliente.update({ where: { id: desativada.c.id }, data: { aceitaMensagens: true } });
  const reenviar = await db.conviteAvaliacao.findUniqueOrThrow({ where: { clienteId: desativada.c.id } });
  await db.automacaoEnviada.create({ data: { tipo: "AVALIACAO", chave: reenviar.id, clienteId: desativada.c.id, ok: false,
    erro: "Fora da janela de 24h e WHATSAPP_TEMPLATE_AVISO não configurado: aviso não enviado." } });
  const incerto = await cliente();
  const ic = (await assegurarConvitePrimeiraVisita(incerto.c.id))!;
  await db.cliente.update({ where: { id: incerto.c.id }, data: { aceitaMensagens: true } });
  await db.automacaoEnviada.create({ data: { tipo: "AVALIACAO", chave: ic.id, clienteId: incerto.c.id, ok: false, erro: "Timeout do provedor" } });
  const comercial = new Date(agora); comercial.setUTCHours(15, 0, 0, 0);
  await Promise.all([reenviarConvitesSemSaida(s, comercial), reenviarConvitesSemSaida(s, comercial)]);
  assert.equal(await db.automacaoEnviada.count({ where: { tipo: "AVALIACAO", chave: { startsWith: `${reenviar.id}:retry:` } } }), 1, "Retry concorrente não duplica envio");
  assert.equal(await db.automacaoEnviada.count({ where: { tipo: "AVALIACAO", chave: { startsWith: `${ic.id}:retry:` } } }), 0, "Timeout ambíguo nunca é reenviado");
  await db.avaliacaoConfig.update({ where: { id: 1 }, data: { whatsapp: false } });
  console.log("PASS avaliações: concorrência, primeira visita, expiração, nota baixa, privacidade, lote mensal, auditoria, configuração e ficha única");
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
