/** Integração sintética. Exige banco exclusivo vazio já migrado; não envia Pix nem usa credencial bancária. */
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import type { Sessao } from "@/lib/auth/sessao";
import { prepararLotePix, previaLotePix } from "@/lib/rh/lote-pix";

const url = new URL(process.env.DATABASE_URL || "postgresql://invalido");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "15439" || !/^\/barberos_pix_preparacao_teste_20261103(?:_\d+)?$/.test(url.pathname)) throw Error("Banco de teste Pix exclusivo obrigatório.");
const competencia = "2039-11";
let checks = 0;
function ok(condicao: unknown, mensagem: string) { assert.ok(condicao, mensagem); checks++; console.log(`OK ${mensagem}`); }
async function main() {
  assert.equal(await db.folhaPagamento.count(), 0, "Use banco exclusivo vazio");
  const dono = await db.usuario.create({ data: { nome: "Dono sintético", telefone: "5500000000001", papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, nome: dono.nome, papel: "DONO", barbeiroId: null, clienteId: null };
  const p = await db.checklistPessoa.create({ data: { nome: "Profissional sintético", telefone: "5500000000002", funcao: "BARBEIRO", token: "token-exclusivo-pix-teste", chavePix: "sintetico@example.com" } });
  const f = await db.folhaPagamento.create({ data: { competencia, pessoaId: p.id, salarioCentavos: 100000, comissaoCentavos: 1000, adicionaisCentavos: 0, descontosCentavos: 0, liquidoCentavos: 101000, status: "FECHADA" } });
  const antes = await previaLotePix(s, competencia);
  ok(antes.totalCentavos === 101000 && antes.itens.length === 1 && !antes.envioHabilitado, "prévia soma sem habilitar envio");
  const pedido = { competencia, revisao: antes.revisao, acao: "preparar" as const };
  const concorrentes = await Promise.allSettled([prepararLotePix(s, pedido), prepararLotePix(s, pedido)]);
  ok(concorrentes.some(r => r.status === "fulfilled"), "ao menos uma preparação concorrente confirma");
  for (const r of concorrentes) if (r.status === "rejected") assert.equal(r.reason.status, 409);
  ok(await db.folhaLotePix.count() === 1, "concorrência não duplica lote");
  await prepararLotePix(s, pedido);
  await prepararLotePix(s, { ...pedido, acao: "conferir" });
  await prepararLotePix(s, { ...pedido, acao: "conferir" });
  ok(await db.auditoria.count({ where: { acao: "rh_pix_preparar" } }) === 1 && await db.auditoria.count({ where: { acao: "rh_pix_conferir_preparacao" } }) === 1, "repetição não duplica preparação/conferência ou auditoria");
  ok(!!(await previaLotePix(s, competencia)).lote?.conferidoEm, "conferência local disponível para revisão exata");
  await db.checklistPessoa.update({ where: { id: p.id }, data: { chavePix: "alterada@example.com" } });
  ok(!(await previaLotePix(s, competencia)).lote, "troca de chave invalida conferência na leitura");
  await db.checklistPessoa.update({ where: { id: p.id }, data: { chavePix: "sintetico@example.com" } });
  ok((await db.checklistPessoa.findUniqueOrThrow({ where: { id: p.id } })).revisaoPix === 2, "trigger registra troca e reversão da chave");
  ok(!(await previaLotePix(s, competencia)).lote, "reverter chave não revive conferência antiga");
  await assert.rejects(prepararLotePix(s, { ...pedido, acao: "conferir" }), (e: unknown) => !!e && typeof e === "object" && "codigo" in e && e.codigo === "lote_mudou");
  checks++; console.log("OK revisão antiga recusada após alteração");
  ok((await db.folhaPagamento.findUniqueOrThrow({ where: { id: f.id } })).status === "FECHADA" && await db.despesa.count() === 0, "preparação e conferência não quitam folha nem criam despesa");
  const nova = await previaLotePix(s, competencia);
  await prepararLotePix(s, { competencia, revisao: nova.revisao, acao: "preparar" });
  await db.folhaPagamento.delete({ where: { id: f.id } });
  ok((await previaLotePix(s, competencia)).itens.length === 0, "reabertura/exclusão do congelado remove obrigação da prévia");
  ok(await db.folhaLotePix.count() === 2, "histórico de preparações preservado após reabertura");
  console.log(`${checks} verificações Pix PostgreSQL passaram; nenhum efeito externo.`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
