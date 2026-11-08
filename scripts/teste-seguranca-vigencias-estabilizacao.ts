import { randomBytes } from "node:crypto";
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !["postgres:", "postgresql:"].includes(url.protocol)
    || url.port !== "55439" || url.pathname !== "/barberos_ci_local_seguranca_estabilizacao") throw new Error("Banco local exclusivo obrigatório.");
  process.env.WHATSAPP_ENVIOS_BLOQUEADOS = "true"; process.env.AMBIENTE = "homologacao";
  globalThis.fetch = async () => { throw new Error("Rede externa bloqueada."); };
  const { db } = await import("@/lib/db");
  const { salvarFicha } = await import("@/lib/rh/funcionarios");
  const { competenciasRemuneracao, lerVigenciaRemuneracao } = await import("@/lib/rh/vigencias");
  const codigo = randomBytes(6).toString("hex"), meses = competenciasRemuneracao();
  let verificacoes = 0;
  const ok = (condicao: unknown, descricao: string) => { if (!condicao) throw new Error(descricao); verificacoes++; console.log(`OK ${descricao}`); };
  try {
    const dono = await db.usuario.create({ data: { nome: "Fixture dono vigência", telefone: `sintetico-vig-dono-${codigo}`, papel: "DONO" } });
    const p = await db.checklistPessoa.create({ data: { nome: "Fixture profissional vigência", telefone: `sintetico-vig-${codigo}`, token: `fixture-vig-${codigo}`, funcao: "GERENTE", salarioCentavos: 100 } });
    const s = { usuarioId: dono.id, nome: dono.nome, papel: "DONO" as const, barbeiroId: null, clienteId: null };
    const ficha = { cargo: "Fixture", salarioCentavos: 200, admissao: null, barbeiroId: null };
    await salvarFicha(s, p.id, ficha);
    const escopo = `salario:${p.id}`, antes = await lerVigenciaRemuneracao<{ salarioCentavos: number }>(db, escopo, meses.atual);
    ok(antes?.conteudo.salarioCentavos === 100 && antes.origem === "BASELINE_LEGADO_NAO_HOMOLOGADO", "mês atual mantém baseline identificado como não homologado");
    ok((await lerVigenciaRemuneracao<{ salarioCentavos: number }>(db, escopo, meses.proxima))?.conteudo.salarioCentavos === 200, "alteração padrão aplica somente no próximo mês");
    await salvarFicha(s, p.id, { ...ficha, competenciaSalario: meses.proxima });
    ok((await db.remuneracaoVersao.count({ where: { escopo } })) === 2, "repetição idêntica não duplica versão nem baseline");
    const original = await db.remuneracaoVersao.findFirstOrThrow({ where: { escopo, competencia: meses.proxima } });
    await salvarFicha(s, p.id, { ...ficha, salarioCentavos: 250, competenciaSalario: meses.proxima });
    ok((await lerVigenciaRemuneracao<{ salarioCentavos: number }>(db, escopo, meses.proxima))?.conteudo.salarioCentavos === 250
      && JSON.stringify((await db.remuneracaoVersao.findUniqueOrThrow({ where: { id: original.id } })).conteudoJson) === JSON.stringify(original.conteudoJson), "correção cria versão posterior sem apagar a anterior");
    const tentativas = await Promise.allSettled([salvarFicha(s, p.id, { ...ficha, salarioCentavos: 300, competenciaSalario: meses.proxima }), salvarFicha(s, p.id, { ...ficha, salarioCentavos: 400, competenciaSalario: meses.proxima })]);
    ok(tentativas.every(t => t.status === "fulfilled") && (await db.remuneracaoVersao.count({ where: { escopo, competencia: meses.proxima } })) === 4, "alterações concorrentes conservam todas as versões");
    let imutavel = false;
    try { await db.remuneracaoVersao.update({ where: { id: original.id }, data: { conteudoJson: { alteracao: "fixture" } } }); } catch { imutavel = true; }
    ok(imutavel, "banco recusa reescrever versão de remuneração");
    const f = await db.folhaPagamento.create({ data: { pessoaId: p.id, competencia: meses.atual, salarioCentavos: 100, comissaoCentavos: 0, adicionaisCentavos: 0, descontosCentavos: 0, liquidoCentavos: 100, status: "FECHADA" } });
    let recusouFechada = false;
    try { await salvarFicha(s, p.id, { ...ficha, salarioCentavos: 500, competenciaSalario: meses.atual }); } catch { recusouFechada = true; }
    ok(recusouFechada && (await db.folhaPagamento.findUniqueOrThrow({ where: { id: f.id } })).liquidoCentavos === 100, "salário de folha fechada não é recalculado");
    ok((await lerVigenciaRemuneracao<{ salarioCentavos: number }>(db, escopo, meses.atual))?.conteudo.salarioCentavos === 100, "concorrência futura preserva leitura histórica");
    ok((await db.auditoria.count({ where: { acao: "remuneracao_baseline_legado", dados: { path: ["escopo"], equals: escopo } } })) === 1, "baseline possui trilha única sem supor homologação antiga");
    console.log(JSON.stringify({ verificacoes, resultado: "PASSOU", redeExterna: "bloqueada", operacaoFinanceira: false }));
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Falha no teste local de vigências; dados sintéticos preservados para inspeção."); process.exitCode = 1; });
