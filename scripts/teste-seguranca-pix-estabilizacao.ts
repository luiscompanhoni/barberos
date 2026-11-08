import { randomBytes } from "node:crypto";
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !["postgres:", "postgresql:"].includes(url.protocol)
    || url.port !== "55439" || url.pathname !== "/barberos_ci_local_seguranca_estabilizacao") throw new Error("Banco local exclusivo obrigatório.");
  process.env.RH_PIX_ENCRYPTION_KEY = Buffer.alloc(32, 71).toString("base64"); // Exclusivamente fixture deste banco.
  process.env.WHATSAPP_ENVIOS_BLOQUEADOS = "true"; process.env.AMBIENTE = "homologacao";
  globalThis.fetch = async () => { throw new Error("Rede externa bloqueada."); };
  const { db } = await import("@/lib/db");
  const { migrarPixLegado } = await import("@/lib/rh/pix-migracao");
  const { decifrarChavePix } = await import("@/lib/rh/pix-protegido");
  const { salvarFicha, listarFuncionarios } = await import("@/lib/rh/funcionarios");
  const { prepararLotePix, previaLotePix } = await import("@/lib/rh/lote-pix");
  const codigo = randomBytes(6).toString("hex");
  let verificacoes = 0;
  const ok = (condicao: unknown, descricao: string) => { if (!condicao) throw new Error(descricao); verificacoes++; console.log(`OK ${descricao}`); };
  try {
    const dono = await db.usuario.create({ data: { nome: "Fixture dono Pix", telefone: `sintetico-pix-dono-${codigo}`, papel: "DONO" } });
    const s = { usuarioId: dono.id, nome: dono.nome, papel: "DONO" as const, barbeiroId: null, clienteId: null, sessaoVersao: 0 };
    const p = await db.checklistPessoa.create({ data: { nome: "Fixture profissional Pix", telefone: `sintetico-pix-${codigo}`, token: `fixture-token-${codigo}`, funcao: "BARBEIRO", chavePix: `fixture-${codigo}@example.test` } });
    const invalida = await db.checklistPessoa.create({ data: { nome: "Fixture revisão manual Pix", telefone: `sintetico-pix-inv-${codigo}`, token: `fixture-token-inv-${codigo}`, funcao: "BARBEIRO", chavePix: "fixture-chave-invalida" } });
    const migracao = await migrarPixLegado(), migrado = await db.checklistPessoa.findUniqueOrThrow({ where: { id: p.id } });
    ok(migracao.migradas >= 1 && migrado.chavePix === null && migrado.chavePixCifrada, "migração cifra e remove o texto somente após validar restauração");
    ok(decifrarChavePix(p.id, migrado.chavePixCifrada!) === `fixture-${codigo}@example.test`, "restauração recupera a chave sintética exata");
    ok((await db.checklistPessoa.findUniqueOrThrow({ where: { id: invalida.id } })).chavePix === "fixture-chave-invalida", "chave inválida é preservada para revisão");
    const repeticao = await migrarPixLegado();
    ok(repeticao.migradas === 0 && (await db.checklistPessoa.findUniqueOrThrow({ where: { id: p.id } })).revisaoPix === migrado.revisaoPix, "repetição não cifra nem incrementa revisão de novo");
    const listar = JSON.stringify(await listarFuncionarios());
    ok(!listar.includes(`fixture-${codigo}@example.test`) && !listar.includes(migrado.chavePixCifrada!), "listagem não revela chave ou ciphertext");
    await db.folhaPagamento.create({ data: { pessoaId: p.id, competencia: "2039-04", salarioCentavos: 100, comissaoCentavos: 0, adicionaisCentavos: 0, descontosCentavos: 0, liquidoCentavos: 100, status: "FECHADA" } });
    const previa = await previaLotePix(s, "2039-04");
    ok(previa.podeConferir && !previa.envioHabilitado, "prévia protegida continua sem autorização de envio");
    await prepararLotePix(s, { competencia: "2039-04", revisao: previa.revisao, acao: "preparar" });
    await prepararLotePix(s, { competencia: "2039-04", revisao: previa.revisao, acao: "conferir" });
    await salvarFicha(s, p.id, { cargo: "Fixture", salarioCentavos: 100, admissao: null, barbeiroId: null, chavePix: `nova-${codigo}@example.test`, revisaoPix: migrado.revisaoPix });
    const alterado = await db.checklistPessoa.findUniqueOrThrow({ where: { id: p.id } });
    ok(alterado.chavePix === null && alterado.revisaoPix === migrado.revisaoPix + 1, "trigger incrementa revisão em troca da cifra sem texto legado");
    const nova = await previaLotePix(s, "2039-04");
    ok(nova.revisao !== previa.revisao && !nova.lote, "troca de chave invalida a conferência anterior");
    ok((await db.folhaPagamento.findMany({ where: { pessoaId: p.id } })).every(f => f.status === "FECHADA"), "conferência não quita folha");
    ok((await db.auditoria.count({ where: { entidadeId: p.id, acao: "rh_pix_proteger_legado" } })) === 1, "migração possui auditoria única sem chave em texto");
    console.log(JSON.stringify({ verificacoes, resultado: "PASSOU", redeExterna: "bloqueada", envioPix: false }));
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Falha no teste local de Pix protegido; dados sintéticos preservados para inspeção, sem exportar chaves ou segredos."); process.exitCode = 1; });
