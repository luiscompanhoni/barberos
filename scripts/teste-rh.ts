// Teste de integracao do RH (pontos do checklist, comissoes e folha) contra o banco de
// DESENVOLVIMENTO. Cria e apaga os proprios dados. Rodar: npm run teste:rh
process.env.WHATSAPP_PROVIDER = "simulador";

import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal } from "@/lib/agenda/tempo";
import type { Sessao } from "@/lib/auth/sessao";
import { ajustarPontos, avaliarItem, classificacao, resumoPontos } from "@/lib/checklist/pontos";
import { gerarItens, listaPublica, marcarNoPainel, marcarPublico, novoToken } from "@/lib/checklist/servico";
import { db } from "@/lib/db";
import { abrirCaixa, caixaAberto } from "@/lib/financeiro/caixa";
import { relatorioComissoes, salvarComissoes } from "@/lib/rh/comissoes";
import { fecharFolha, lancar, pagarFolha, previaFolha, reabrirFolha } from "@/lib/rh/folha";
import { criarAdicional, encerrarAdicional, excluirAdicional } from "@/lib/rh/adicionais";
import { configExtras, salvarExtras } from "@/lib/rh/pote";
import { salvarFicha } from "@/lib/rh/funcionarios";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string }; } };
const TEL = "5511933337201";
const TEL_BARB = "5511933337202";
const TEL_CLI = "5511933337203";
const COMP = "2031-01"; // mes futuro: nao mistura com atendimentos reais

async function main() {
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, barbeiroId: null, clienteId: null };
  const fuso = (await configuracao()).fuso;
  const hoje = dataLocal(Date.now(), fuso);
  const cfgAntes = await db.checklistConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const excecoesAntes = await db.comissaoServico.findMany({ where: { barbeiroId: { not: null } } });
  const jaAberto = await caixaAberto();
  if (jaAberto) await db.caixa.update({ where: { id: jaAberto.id }, data: { status: "FECHADO", fechadoEm: new Date(), observacao: "fechado pelo teste" } });
  const ids = { pessoa: "", tarefas: [] as string[], usuario: "", barbeiro: "", servico: "", cliente: "", plano: "", assinatura: "", ags: [] as string[], caixas: [] as string[], despesas: [] as string[], produto: "", comanda: "", comandaServico: "", estorno: "" };
  const poteAntes = {
    cfg: await db.poteConfig.findUnique({ where: { id: "pote" } }),
    fichas: await db.poteFicha.findMany(), faixas: await db.comissaoProdutoFaixa.findMany(),
  };
  // Comeca com a comissao das assinaturas desligada (o banco de dev pode estar com ela ligada); o finally restaura.
  await db.poteConfig.updateMany({ data: { ativo: false } });
  try {
    // ================= PONTOS DO CHECKLIST
    await db.checklistConfig.update({ where: { id: 1 }, data: { pontosRe: 20, nivelPlatina: 50, nivelLegend: 100 } });
    const p = await db.checklistPessoa.create({ data: { nome: "[teste rh] Diarista", telefone: TEL, funcao: "DIARISTA", token: novoToken() } });
    ids.pessoa = p.id;
    for (const titulo of ["[teste rh] Varrer", "[teste rh] Lixo"]) ids.tarefas.push((await db.checklistTarefa.create({ data: { titulo, funcao: "DIARISTA", pontos: 30 } })).id);
    await gerarItens(hoje, [p.id]);
    const itens = await db.checklistItem.findMany({ where: { pessoaId: p.id, tarefaId: { in: ids.tarefas } }, orderBy: { titulo: "asc" } });
    const [lixo, varrer] = itens;
    ok(itens.length === 2 && itens.every((i) => i.pontos === 30), "item do dia copia os pontos da tarefa (30)");
    ok((await falha(() => avaliarItem(s, varrer.id, "VALIDADO")))?.codigo === "nao_feito", "tarefa não feita não pode ser validada");

    await marcarPublico(p.token, varrer.id, true);
    await avaliarItem(s, varrer.id, "VALIDADO");
    ok((await resumoPontos(p.id)).pontos === 30, "validar: ganha os pontos da tarefa (+30)");
    await avaliarItem(s, varrer.id, "VALIDADO");
    ok((await db.checklistPonto.count({ where: { pessoaId: p.id } })) === 1 && (await resumoPontos(p.id)).pontos === 30, "reavaliar substitui (um lançamento por tarefa)");
    ok((await falha(() => marcarPublico(p.token, varrer.id, false)))?.codigo === "validada", "funcionário não desmarca tarefa já validada");

    await marcarPublico(p.token, lixo.id, true);
    await avaliarItem(s, lixo.id, "RE", "lixo ainda cheio");
    const lixoRe = await db.checklistItem.findUniqueOrThrow({ where: { id: lixo.id } });
    ok((await resumoPontos(p.id)).pontos === 10, "ré: perde os pontos da config (30 − 20 = 10)");
    ok(!lixoRe.feito && lixoRe.avaliacao === "RE" && lixoRe.motivoRe === "lixo ainda cheio", "ré: tarefa volta para não feita com o motivo");
    const msgRe = await db.mensagem.findFirst({ where: { conversa: { telefone: TEL }, texto: { contains: "você tomou uma ré" } } });
    ok(!!msgRe && msgRe.texto.includes("−20 pts") && msgRe.texto.includes("[teste rh] Lixo"), "ré avisa o funcionário no WhatsApp");
    const pub = (await listaPublica(p.token))!;
    ok(pub.pontos.pontos === 10 && pub.pontos.nivel === "ELITE" && pub.itens.find((i) => i.id === lixo.id)?.avaliacao === "RE", "link público mostra pontos, faixa e a ré");

    await marcarPublico(p.token, lixo.id, true);
    const lixoDeNovo = await db.checklistItem.findUniqueOrThrow({ where: { id: lixo.id } });
    ok(lixoDeNovo.feito && lixoDeNovo.avaliacao === null && (await resumoPontos(p.id)).pontos === 10, "marcar de novo depois da ré: aguardando validação e a ré continua no extrato");
    await avaliarItem(s, lixo.id, "VALIDADO");
    ok((await resumoPontos(p.id)).pontos === 40, "valida depois de feita de verdade (10 + 30 = 40)");

    await ajustarPontos(s, p.id, 15, "ajudou a fechar a loja");
    let r = await resumoPontos(p.id);
    ok(r.pontos === 55 && r.nivel === "PLATINA", `ajuste manual sobe para BLACK PLATINA (${r.pontos} ${r.nivel})`);
    await ajustarPontos(s, p.id, 50, "mês impecável");
    r = await resumoPontos(p.id);
    ok(r.pontos === 105 && r.nivel === "LEGEND" && r.proximo === null, "chega a BLACK LEGEND (topo)");
    const cl = (await classificacao()).pessoas.find((x) => x.id === p.id);
    ok(!!cl && cl.pontos === 105 && cl.pontosMes === 105 && cl.extrato.length === 5, "classificação: total, pontos do mês e extrato");
    await marcarNoPainel(s, varrer.id, false);
    r = await resumoPontos(p.id);
    ok(r.pontos === 75 && r.nivel === "PLATINA", "painel desmarca tarefa validada: perde a validação e volta para PLATINA");
    await avaliarItem(s, lixo.id, null);
    ok((await resumoPontos(p.id)).pontos === 45 && (await resumoPontos(p.id)).nivel === "ELITE", "desfazer validação tira os pontos (volta para ELITE)");

    // ================= COMISSOES
    const u = await db.usuario.create({ data: { telefone: TEL_BARB, nome: "[teste rh] Barbeiro", papel: "BARBEIRO" } });
    ids.usuario = u.id;
    const b = await db.barbeiro.create({ data: { usuarioId: u.id, nome: "[teste rh] Barbeiro" } });
    ids.barbeiro = b.id;
    const sv = await db.servico.create({ data: { nome: "[teste rh] Corte", duracaoMin: 30, precoCentavos: 5000 } });
    ids.servico = sv.id;
    const cli = await db.cliente.create({ data: { telefone: TEL_CLI, nome: "[teste rh] Cliente" } });
    ids.cliente = cli.id;
    const pl = await db.plano.create({ data: { nome: "[teste rh] Plano", precoCentavos: 9900, ativo: false } });
    ids.plano = pl.id;
    const as = await db.assinatura.create({ data: { clienteId: cli.id, planoId: pl.id, status: "ATIVA", formaPagamento: "PIX", precoCentavos: 9900, origem: "PAINEL" } });
    ids.assinatura = as.id;
    const ag = async (dia: string, preco: number, plano: boolean, status: "CONCLUIDO" | "MARCADO" = "CONCLUIDO") => {
      const inicio = new Date(instanteLocal(dia, 600, fuso));
      const a = await db.agendamento.create({
        data: { barbeiroId: b.id, clienteId: cli.id, servicoId: sv.id, inicio, fim: new Date(+inicio + 30 * 60000), status, origem: "PAINEL", precoCentavos: preco, assinaturaId: plano ? as.id : null },
      });
      ids.ags.push(a.id);
    };
    await ag(`${COMP}-05`, 6000, false); // avulso cobrado acima da tabela
    await ag(`${COMP}-12`, 0, true); // pelo plano
    await ag(`${COMP}-31`, 0, true); // pelo plano, ultimo dia do mes
    await ag(`${COMP}-20`, 5000, false, "MARCADO"); // nao atendido: fica fora
    await ag("2031-02-01", 5000, false); // fora do mes

    const rel0 = await relatorioComissoes(`${COMP}-01`, `${COMP}-31`, b.id);
    ok(rel0.barbeiros[0]?.semRegra === 3 && rel0.total === 0, "serviço sem regra salva não gera comissão (e avisa)");
    await salvarComissoes(s, {
      gerais: [{ servicoId: sv.id, avulsoTipo: "PERCENTUAL", avulsoValor: 4000, planoTipo: "FIXO", planoValor: 1500 }],
      excecoes: excecoesAntes.map((e) => ({ servicoId: e.servicoId, barbeiroId: e.barbeiroId!, avulsoTipo: e.avulsoTipo, avulsoValor: e.avulsoValor, planoTipo: e.planoTipo, planoValor: e.planoValor })),
    });
    await salvarComissoes(s, { gerais: [{ servicoId: sv.id, avulsoTipo: "PERCENTUAL", avulsoValor: 4000, planoTipo: "FIXO", planoValor: 1500 }], excecoes: excecoesAntes.map((e) => ({ ...e, barbeiroId: e.barbeiroId! })) });
    ok((await db.comissaoServico.count({ where: { servicoId: sv.id, barbeiroId: null } })) === 1, "salvar duas vezes não duplica a regra geral (unique com NULL)");
    let rel = (await relatorioComissoes(`${COMP}-01`, `${COMP}-31`, b.id)).barbeiros[0];
    ok(rel.avulso.qtd === 1 && rel.avulso.base === 6000 && rel.avulso.comissao === 2400, `avulso: 40% do valor cobrado (R$ 60 → R$ 24) (${rel.avulso.comissao})`);
    ok(rel.plano.qtd === 2 && rel.plano.base === 10000 && rel.plano.comissao === 3000, `plano: R$ 15 fixo por corte, base = tabela (${rel.plano.comissao})`);
    ok(rel.total === 5400 && rel.atendimentos.length === 3, "só CONCLUIDO dentro do período entra no relatório");
    await salvarComissoes(s, {
      gerais: [{ servicoId: sv.id, avulsoTipo: "PERCENTUAL", avulsoValor: 4000, planoTipo: "FIXO", planoValor: 1500 }],
      excecoes: [...excecoesAntes.map((e) => ({ ...e, barbeiroId: e.barbeiroId! })), { servicoId: sv.id, barbeiroId: b.id, avulsoTipo: "PERCENTUAL", avulsoValor: 5000, planoTipo: "PERCENTUAL", planoValor: 3000 }],
    });
    rel = (await relatorioComissoes(`${COMP}-01`, `${COMP}-31`, b.id)).barbeiros[0];
    ok(rel.avulso.comissao === 3000 && rel.plano.comissao === 3000 && rel.total === 6000, `exceção do barbeiro substitui a geral (50% avulso, 30% da tabela no plano) (${rel.total})`);
    ok(rel.atendimentos.find((a) => a.modalidade === "PLANO")?.regra === "30% da tabela", "detalhe mostra a regra aplicada");

    // ================= FOLHA
    await salvarFicha(s, p.id, { cargo: "Barbeiro", salarioCentavos: 200000, chavePix: "teste@pix", admissao: "2026-01-10", barbeiroId: b.id });
    ok((await falha(() => lancar(s, { competencia: COMP, pessoaId: p.id, tipo: "VALE", valorCentavos: 5000, descricao: "vale", doCaixa: true })))?.codigo === "fechado", "vale do caixa exige caixa aberto");
    const cx = await abrirCaixa(s, 20000);
    ids.caixas.push(cx.id);
    await lancar(s, { competencia: COMP, pessoaId: p.id, tipo: "BONUS", valorCentavos: 10000, descricao: "meta batida" });
    const vale = await lancar(s, { competencia: COMP, pessoaId: p.id, tipo: "VALE", valorCentavos: 5000, descricao: "vale do dia 10", doCaixa: true });
    await lancar(s, { competencia: COMP, pessoaId: p.id, tipo: "DESCONTO", valorCentavos: 2000, descricao: "toalha perdida" });
    const sangria = vale.movimentoCaixaId ? await db.movimentoCaixa.findUnique({ where: { id: vale.movimentoCaixaId } }) : null;
    ok(!!sangria && sangria.tipo === "SANGRIA" && sangria.valorCentavos === 5000 && sangria.caixaId === cx.id, "vale com dinheiro do caixa gera sangria e guarda o movimento");
    let linha = (await previaFolha(COMP)).linhas.find((l) => l.pessoaId === p.id)!;
    // 2000 + 60 (comissao) + 100 - 50 - 20 = 2090
    ok(linha.status === "ABERTA" && linha.comissao === 6000 && linha.adicionais === 10000 && linha.descontos === 7000 && linha.liquido === 209000, `prévia: salário + comissão + bônus − vale − desconto (${linha.liquido})`);
    ok((await fecharFolha(s, COMP, p.id)) === 1, "fecha a folha do funcionário");
    linha = (await previaFolha(COMP)).linhas.find((l) => l.pessoaId === p.id)!;
    ok(linha.status === "FECHADA" && linha.liquido === 209000, "valores congelados");
    ok((await falha(() => lancar(s, { competencia: COMP, pessoaId: p.id, tipo: "BONUS", valorCentavos: 100, descricao: "x" })))?.codigo === "folha_fechada", "não lança com a folha fechada");
    await ag(`${COMP}-15`, 5000, false);
    linha = (await previaFolha(COMP)).linhas.find((l) => l.pessoaId === p.id)!;
    ok(linha.liquido === 209000 && linha.mudouDepois, "atendimento novo não muda o congelado (mas avisa)");
    await reabrirFolha(s, COMP, p.id);
    await fecharFolha(s, COMP, p.id);
    linha = (await previaFolha(COMP)).linhas.find((l) => l.pessoaId === p.id)!;
    ok(linha.status === "FECHADA" && linha.liquido === 211500, `reabrir e fechar de novo recalcula (+ R$ 25 de comissão) (${linha.liquido})`);
    const pago = await pagarFolha(s, COMP, p.id, "PIX");
    if (pago.despesaId) ids.despesas.push(pago.despesaId);
    const desp = pago.despesaId ? await db.despesa.findUnique({ where: { id: pago.despesaId } }) : null;
    const folha = await db.folhaPagamento.findUnique({ where: { competencia_pessoaId: { competencia: COMP, pessoaId: p.id } } });
    ok(!!desp && desp.categoria === "FOLHA" && desp.status === "PAGA" && desp.valorCentavos === 211500 && !!desp.pagoEm && desp.formaPagamento === "PIX", "pagar cria a despesa FOLHA paga com o líquido");
    ok(folha?.status === "PAGA" && folha.despesaId === desp?.id && !!folha.pagoEm, "folha fica PAGA ligada à despesa");
    ok((await falha(() => reabrirFolha(s, COMP, p.id)))?.codigo === "ja_paga", "folha paga não reabre");
    ok((await falha(() => pagarFolha(s, COMP, p.id)))?.codigo === "ja_paga", "não paga duas vezes");

    // ================= COMISSAO DAS ASSINATURAS, COMISSAO DIFERENCIADA E PRODUTOS
    // Atendimentos do barbeiro no mes: avulsos de R$ 60 (dia 5) e R$ 50 (dia 15), plano nos dias 12 e 31 (excecao: 50% avulso).
    await db.cobranca.create({ data: { assinaturaId: as.id, gatewayId: "teste-rh-pote-1", valorCentavos: 100000, vencimento: new Date(`${COMP}-10T00:00:00Z`), status: "PAGA", pagaEm: new Date(instanteLocal(`${COMP}-10`, 600, fuso)) } });
    ok((await falha(() => salvarExtras(s, { assinaturas: { ativo: true, percentualBps: 3500, creditos: [] }, faixas: [] })))?.message.includes("créditos") === true, "comissão das assinaturas ligada sem créditos é recusada");
    await salvarExtras(s, {
      assinaturas: { ativo: true, percentualBps: 3500, creditos: [{ servicoId: sv.id, creditos: 40 }] },
      faixas: [{ categoria: "LOJA", minimoCentavos: 10000, percentualBps: 500 }, { categoria: "LOJA", minimoCentavos: 12000, percentualBps: 1000 }, { categoria: "BAR", minimoCentavos: 10000, percentualBps: 100 }],
    });
    // Adicional de +5 pts que ja valia (como os migrados); o mes de teste ja tem a folha paga.
    const adicAntigo = await db.adicionalComissao.create({ data: { barbeiroId: b.id, modalidade: "ASSINATURA", pontosBps: 500, motivo: "[teste rh] antigo", inicio: new Date("2000-01-01T00:00:00Z") } });
    // Estorno de R$ 100 de mensalidade feito no mes: sai da Receita Distribuivel.
    ids.estorno = (await db.pedidoEstorno.create({ data: {
      tipo: "MENSALIDADE", referenciaId: "teste-rh-pote-1", valorCentavos: 10000, valorOriginalCentavos: 100000, motivo: "[teste rh]", status: "EXECUTADO",
      meio: "SIMULADO", forma: "ONLINE", descricao: "[teste rh] mensalidade", executadoEm: new Date(instanteLocal(`${COMP}-25`, 600, fuso)),
    } })).id;
    // Avulso do dia 5 numa comanda com outro item de R$ 40 e R$ 10 de desconto: o corte vale R$ 54.
    const agAvulso = await db.agendamento.findFirstOrThrow({ where: { barbeiroId: b.id, inicio: new Date(instanteLocal(`${COMP}-05`, 600, fuso)) } });
    const cmServ = await db.comanda.create({ data: { status: "FECHADA", clienteId: cli.id, descontoCentavos: 1000, abertaEm: agAvulso.inicio, fechadaEm: agAvulso.fim } });
    ids.comandaServico = cmServ.id;
    await db.itemComanda.createMany({ data: [
      { comandaId: cmServ.id, agendamentoId: agAvulso.id, descricao: "[teste rh] Corte", precoUnitCentavos: 6000, barbeiroId: b.id },
      { comandaId: cmServ.id, descricao: "[teste rh] Item avulso", precoUnitCentavos: 4000 },
    ] });
    await db.pagamentoComanda.create({ data: { comandaId: cmServ.id, forma: "PIX", valorCentavos: 9000, status: "PAGO", pagoEm: agAvulso.fim } });
    const prod = await db.produto.create({ data: { nome: "[teste rh] Pomada", categoria: "LOJA", precoCentavos: 5000 } });
    ids.produto = prod.id;
    const cm = await db.comanda.create({ data: { status: "FECHADA", abertaEm: new Date(instanteLocal(`${COMP}-20`, 600, fuso)), fechadaEm: new Date(instanteLocal(`${COMP}-20`, 620, fuso)), clienteId: cli.id } });
    ids.comanda = cm.id;
    await db.itemComanda.create({ data: { comandaId: cm.id, produtoId: prod.id, descricao: prod.nome, quantidade: 3, precoUnitCentavos: 5000, barbeiroId: b.id } });
    const relAss = await relatorioComissoes(`${COMP}-01`, `${COMP}-31`, b.id);
    rel = relAss.barbeiros[0];
    ok(relAss.assinaturas?.recebidoCentavos === 100000 && relAss.assinaturas.estornosCentavos === 10000 && relAss.assinaturas.distribuivelCentavos === 90000 && relAss.assinaturas.creditosTotal === 80,
      `Receita de Assinaturas R$ 1.000 − estorno R$ 100 = Receita Distribuível R$ 900, 80 créditos (${JSON.stringify(relAss.assinaturas)})`);
    ok(rel.assinaturas?.qtd === 2 && rel.assinaturas.receitaAtribuida === 90000 && rel.assinaturas.comissaoBase === 31500 && rel.assinaturas.adicionalCentavos === 4500 && rel.assinaturas.comissao === 36000,
      `único com créditos: atribuída R$ 900, 35% = R$ 315 + 5 pts = R$ 360 (${JSON.stringify(rel.assinaturas)})`);
    ok(rel.plano.comissao === 0 && rel.atendimentos.filter((a) => a.modalidade === "PLANO").every((a) => a.regra === "Comissão das assinaturas"), "comissão das assinaturas substitui a regra pelo plano");
    ok(rel.avulso.base === 5400 + 5000 && rel.avulso.comissao === 2700 + 2500, `avulso sobre o valor cobrado: corte de R$ 60 com desconto proporcional vale R$ 54 (${rel.avulso.base} / ${rel.avulso.comissao})`);
    ok(rel.produtos?.vendido === 15000 && rel.produtos.comissao === 1500, `produtos: R$ 150 na loja → faixa de 10% = R$ 15 (${rel.produtos?.comissao})`);
    ok(rel.total === 5200 + 36000 + 1500, `total = avulso + assinaturas + produtos (${rel.total})`);
    ok(relAss.competencia === COMP && rel.folha?.salario === 200000 && rel.folha.bonus === 10000 && rel.folha.descontos === 7000 && rel.folha.status === "PAGA" && rel.folha.totalAPagar === 200000 + 42700 + 10000 - 7000,
      `mês inteiro: folha junto (salário + comissões + bônus − descontos) (${JSON.stringify(rel.folha)})`);
    ok((await relatorioComissoes(`${COMP}-02`, `${COMP}-31`, b.id)).barbeiros[0].folha === null, "período que não é mês inteiro não mostra a folha");

    // Regras da comissão diferenciada (o mês de teste está com a folha paga).
    const novoAdic = { barbeiroId: b.id, modalidade: "ASSINATURA" as const, pontosBps: 200, motivo: "[teste rh] meta", inicio: `${COMP}-10`, fim: null };
    ok((await falha(() => criarAdicional(s, novoAdic)))?.codigo === "folha_fechada", "não cria adicional em mês com a folha fechada");
    ok((await falha(() => criarAdicional(s, { ...novoAdic, inicio: "2031-03-01" })))?.codigo === "sobreposto", "não cria adicional sobreposto a outro da mesma modalidade");
    ok((await falha(() => encerrarAdicional(s, adicAntigo.id, `${COMP}-10`)))?.codigo === "folha_fechada", "encerrar antes de um mês fechado é recusado (mudaria o mês fechado)");
    await encerrarAdicional(s, adicAntigo.id, "2031-02-28");
    const futuro = await criarAdicional(s, { ...novoAdic, inicio: "2031-03-01" });
    ok(futuro.autorizadoPorId === dono.id, "adicional novo guarda quem autorizou");
    ok((await falha(() => excluirAdicional(s, adicAntigo.id)))?.codigo === "ja_vale", "adicional que já valeu não se apaga");
    await excluirAdicional(s, futuro.id);
    ok(!(await db.adicionalComissao.findUnique({ where: { id: futuro.id } })), "adicional que ainda não começou pode ser apagado");
    ok((await db.auditoria.count({ where: { entidade: "adicional_comissao", entidadeId: { in: [adicAntigo.id, futuro.id] } } })) === 3, "criar, encerrar e apagar ficam na auditoria");
    await db.adicionalComissao.delete({ where: { id: adicAntigo.id } });

    const extras = await configExtras();
    await salvarExtras(s, {
      assinaturas: { ativo: false, percentualBps: extras.assinaturas.percentualBps, creditos: extras.assinaturas.creditos.map(({ servicoId, creditos }) => ({ servicoId, creditos })) },
      faixas: extras.faixas,
    });
    rel = (await relatorioComissoes(`${COMP}-01`, `${COMP}-31`, b.id)).barbeiros[0];
    ok(rel.assinaturas === null && rel.plano.comissao === 3000, `comissão das assinaturas desligada volta a regra pelo plano (30% da tabela) (${rel.plano.comissao})`);
  } finally {
    if (ids.comanda) await db.comanda.delete({ where: { id: ids.comanda } });
    if (ids.comandaServico) await db.comanda.delete({ where: { id: ids.comandaServico } });
    if (ids.estorno) await db.pedidoEstorno.delete({ where: { id: ids.estorno } });
    await db.adicionalComissao.deleteMany({ where: { barbeiroId: ids.barbeiro || "-" } });
    if (ids.produto) await db.produto.delete({ where: { id: ids.produto } });
    await db.poteConfig.deleteMany({});
    if (poteAntes.cfg) await db.poteConfig.create({ data: poteAntes.cfg });
    await db.poteFicha.deleteMany({});
    if (poteAntes.fichas.length) await db.poteFicha.createMany({ data: poteAntes.fichas });
    await db.comissaoProdutoFaixa.deleteMany({});
    if (poteAntes.faixas.length) await db.comissaoProdutoFaixa.createMany({ data: poteAntes.faixas });
    await db.despesa.deleteMany({ where: { id: { in: ids.despesas } } });
    await db.caixa.deleteMany({ where: { id: { in: ids.caixas } } });
    if (jaAberto) await db.caixa.update({ where: { id: jaAberto.id }, data: { status: "ABERTO", fechadoEm: null, observacao: null } });
    await db.agendamento.deleteMany({ where: { id: { in: ids.ags } } });
    if (ids.assinatura) await db.assinatura.delete({ where: { id: ids.assinatura } });
    if (ids.plano) await db.plano.delete({ where: { id: ids.plano } });
    if (ids.cliente) await db.cliente.delete({ where: { id: ids.cliente } });
    if (ids.servico) await db.servico.delete({ where: { id: ids.servico } });
    if (ids.pessoa) await db.checklistPessoa.delete({ where: { id: ids.pessoa } });
    if (ids.barbeiro) await db.barbeiro.delete({ where: { id: ids.barbeiro } });
    if (ids.usuario) await db.usuario.delete({ where: { id: ids.usuario } });
    await db.checklistItem.deleteMany({ where: { tarefaId: { in: ids.tarefas } } });
    await db.checklistTarefa.deleteMany({ where: { id: { in: ids.tarefas } } });
    // Restaura as excecoes de comissao e a config do checklist como estavam.
    await db.comissaoServico.deleteMany({ where: { barbeiroId: { not: null } } });
    if (excecoesAntes.length) await db.comissaoServico.createMany({ data: excecoesAntes });
    await db.checklistConfig.update({ where: { id: 1 }, data: cfgAntes });
    const conv = await db.conversa.findMany({ where: { telefone: { in: [TEL, TEL_BARB, TEL_CLI] } }, select: { id: true } });
    await db.mensagem.deleteMany({ where: { conversaId: { in: conv.map((c) => c.id) } } });
    await db.conversa.deleteMany({ where: { id: { in: conv.map((c) => c.id) } } });
  }
  console.log(process.exitCode ? "\nAlgum teste FALHOU." : "\nTodos os testes passaram.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
