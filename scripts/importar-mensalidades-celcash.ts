/**
 * Importa as mensalidades pagas direto da Celcash (a fonte do dinheiro que entrou), completando o que o
 * relatorio do CashBarber nao trouxe.
 *
 * Fonte: os recebimentos do extrato ja guardados (movimentos_externos, tipo RECEBIMENTO) + o detalhe de cada
 * transacao (cliente, CPF, telefone, assinatura, vencimento). Cada pagamento vira uma cobranca PAGA
 * (gatewayId "celcash:pag:<id da transacao>", nunca e cobrada nem sincronizada) na assinatura do cliente.
 * - Cliente: pelo telefone, depois CPF, depois nome (so quando o nome e de um cliente so).
 * - Ja importado do CashBarber (mesmo cliente, mesmo valor, ate 3 dias de diferenca): fica o que ja existe.
 * - Cliente sem assinatura no BarberOS ganha uma assinatura CANCELADA de historico (como no importador do CashBarber).
 * Nada muda nas assinaturas atuais e nenhuma mensagem sai. Rodar de novo nao duplica.
 *
 * Roda onde estao as chaves da Celcash e o banco (no servidor). Por padrao so mostra; --aplicar grava.
 */
import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const DIA = 86_400_000;
const base = process.env.CELCASH_AMBIENTE === "producao" ? "https://api-celcash.celcoin.com.br/v2" : "https://api.sandbox.cel.cash/v2";

type Transacao = {
  galaxPayId: number; value: number; payday: string; status: string;
  Subscription?: { galaxPayId: number; planGalaxPayId?: number; Customer?: { name?: string; document?: string; phones?: (string | number)[] } } | null;
  Charge?: { Customer?: { name?: string; document?: string; phones?: (string | number)[] } } | null;
};

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const so = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const hash = (...p: string[]) => createHash("sha1").update(p.join("|")).digest("hex").slice(0, 22);
function telefoneBr(s: string): string | null {
  let d = so(s);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d.length === 11 && d[2] === "9" ? `55${d}` : null;
}

async function token() {
  const basic = Buffer.from(`${process.env.CELCASH_GALAX_ID}:${process.env.CELCASH_GALAX_HASH}`).toString("base64");
  const r = await fetch(`${base}/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", scope: "transactions.read" }) });
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error(`Celcash token: HTTP ${r.status}`);
  return j.access_token;
}

async function transacoes(ids: string[]) {
  const t = await token();
  const out = new Map<string, Transacao>();
  for (let i = 0; i < ids.length; i += 100) {
    const r = await fetch(`${base}/transactions?galaxPayIds=${ids.slice(i, i + 100).join(",")}&startAt=0&limit=100`, { headers: { Authorization: `Bearer ${t}` } });
    const j = (await r.json()) as { Transactions?: Transacao[] };
    for (const x of j.Transactions ?? []) out.set(String(x.galaxPayId), x);
  }
  return out;
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  // Recebimentos do extrato (o dinheiro que entrou), um por transacao.
  const recs = await db.movimentoExterno.findMany({ where: { fonte: "CELCASH", tipo: "RECEBIMENTO", transacaoId: { not: null } }, orderBy: { data: "asc" } });
  const porTx = new Map<string, (typeof recs)[number]>();
  for (const r of recs) if (!porTx.has(r.transacaoId!)) porTx.set(r.transacaoId!, r);
  const txs = await transacoes([...porTx.keys()]);
  console.log(`recebimentos: ${recs.length} | transacoes: ${porTx.size} | detalhadas: ${txs.size}`);

  const clientes = await db.cliente.findMany({ select: { id: true, telefone: true, nome: true, cpf: true } });
  const porTel = new Map(clientes.map((c) => [c.telefone, c.id]));
  const porCpf = new Map(clientes.filter((c) => so(c.cpf).length === 11).map((c) => [so(c.cpf), c.id]));
  const porNome = new Map<string, Set<string>>();
  for (const c of clientes) porNome.set(normal(c.nome), (porNome.get(normal(c.nome)) ?? new Set()).add(c.id));

  // Pagamentos ja registrados (CashBarber): cliente -> [valor, data]
  const existentes = await db.cobranca.findMany({ where: { status: { in: ["PAGA", "ESTORNADA"] } }, select: { gatewayId: true, valorCentavos: true, pagaEm: true, assinatura: { select: { clienteId: true } } } });
  const jaTem = new Set(existentes.map((e) => e.gatewayId));
  const doCliente = new Map<string, { valor: number; quando: number; usado: boolean }[]>();
  for (const e of existentes) if (e.pagaEm) doCliente.set(e.assinatura.clienteId, [...(doCliente.get(e.assinatura.clienteId) ?? []), { valor: e.valorCentavos, quando: +e.pagaEm, usado: false }]);

  type Pag = { gatewayId: string; clienteId: string; valor: number; pagaEm: Date; vencimento: string };
  const novos: Pag[] = [];
  const candidatos: Pag[] = [];
  const semCliente: string[] = [];
  let duplicados = 0, jaImportados = 0, semDetalhe = 0;
  const como = { telefone: 0, cpf: 0, nome: 0 };
  for (const [txId, mov] of porTx) {
    const gatewayId = `celcash:pag:${txId}`;
    if (jaTem.has(gatewayId)) { jaImportados++; continue; }
    const tx = txs.get(txId);
    if (!tx) { semDetalhe++; continue; }
    const cust = tx.Subscription?.Customer ?? tx.Charge?.Customer;
    let clienteId: string | undefined;
    for (const f of cust?.phones ?? []) { const t = telefoneBr(String(f)); if (t && porTel.has(t)) { clienteId = porTel.get(t); como.telefone++; break; } }
    if (!clienteId && so(cust?.document).length === 11 && porCpf.has(so(cust?.document))) { clienteId = porCpf.get(so(cust?.document)); como.cpf++; }
    if (!clienteId && cust?.name) { const ids = porNome.get(normal(cust.name)); if (ids?.size === 1) { clienteId = [...ids][0]; como.nome++; } }
    if (!clienteId) { semCliente.push(`${cust?.name ?? "?"} R$ ${(mov.valorCentavos / 100).toFixed(2)} ${mov.data.toISOString().slice(0, 10)}`); continue; }
    candidatos.push({ gatewayId, clienteId, valor: mov.valorCentavos, pagaEm: mov.data, vencimento: (tx.payday || mov.data.toISOString()).slice(0, 10) });
  }

  // Mesmo pagamento ja veio do CashBarber? O CashBarber registra em outra data (as vezes um ciclo depois):
  // pareia um para um, mesmo cliente e valor, os mais proximos primeiro, ate 45 dias.
  const pares: { c: Pag; e: { valor: number; quando: number; usado: boolean }; d: number }[] = [];
  for (const c of candidatos) for (const e of doCliente.get(c.clienteId) ?? []) {
    const d = Math.abs(e.quando - +c.pagaEm);
    if (e.valor === c.valor && d <= 45 * DIA) pares.push({ c, e, d });
  }
  pares.sort((a, b) => a.d - b.d);
  const pareado = new Set<Pag>();
  for (const p of pares) if (!p.e.usado && !pareado.has(p.c)) { p.e.usado = true; pareado.add(p.c); duplicados++; }
  for (const c of candidatos) if (!pareado.has(c)) novos.push(c);

  // Conferencia por mes: o que caiu na Celcash x o que fica registrado (CashBarber + novos).
  const mes = (d: Date | number) => new Date(+d - 3 * 3_600_000).toISOString().slice(0, 7);
  const conf = new Map<string, { celcash: number; cashbarber: number; novos: number }>();
  const add = (m: string, k: "celcash" | "cashbarber" | "novos", v: number) => { const x = conf.get(m) ?? { celcash: 0, cashbarber: 0, novos: 0 }; x[k] += v; conf.set(m, x); };
  for (const r of porTx.values()) add(mes(r.data), "celcash", r.valorCentavos);
  for (const e of existentes) if (e.pagaEm) add(mes(e.pagaEm), "cashbarber", e.valorCentavos);
  for (const p of novos) add(mes(p.pagaEm), "novos", p.valor);
  const naoPareados = [...doCliente.values()].flat().filter((e) => !e.usado);
  console.log(`CashBarber sem par na Celcash (pago por fora ou sem registro na Celcash): ${naoPareados.length}, R$ ${(naoPareados.reduce((t, e) => t + e.valor, 0) / 100).toFixed(2)}`);
  console.log("mes | Celcash | registrado depois (CashBarber + novos)");
  for (const [m, x] of [...conf].sort()) console.log(`${m} | ${(x.celcash / 100).toFixed(2)} | ${((x.cashbarber + x.novos) / 100).toFixed(2)}`);

  // Assinatura: a que esta valendo (ou a mais recente); sem nenhuma, uma CANCELADA de historico.
  const assinaturas = await db.assinatura.findMany({ select: { id: true, clienteId: true, status: true }, orderBy: { criadaEm: "desc" } });
  const planos = await db.plano.findMany({ select: { id: true, nome: true } });
  const plano = (v: number) => (planos.find((p) => normal(p.nome) === (v >= 14_000 ? "plano de corte e barba" : v < 9_900 ? "plano de barba" : "plano de corte")) ?? planos[0]).id;
  const assinaturaDe = new Map<string, string>();
  for (const a of assinaturas) if (a.status !== "CANCELADA" && !assinaturaDe.has(a.clienteId)) assinaturaDe.set(a.clienteId, a.id);
  for (const a of assinaturas) if (!assinaturaDe.has(a.clienteId)) assinaturaDe.set(a.clienteId, a.id);
  const historicas: Prisma.AssinaturaCreateManyInput[] = [];
  const porCliente = new Map<string, Pag[]>();
  for (const p of novos) porCliente.set(p.clienteId, [...(porCliente.get(p.clienteId) ?? []), p]);
  for (const [clienteId, ps] of porCliente) {
    if (assinaturaDe.has(clienteId)) continue;
    ps.sort((a, b) => +a.pagaEm - +b.pagaEm);
    const ultima = ps.at(-1)!;
    const id = `ccas_${hash(clienteId)}`;
    historicas.push({
      id, clienteId, planoId: plano(ultima.valor), status: "CANCELADA", formaPagamento: "CARTAO", precoCentavos: ultima.valor,
      gatewayId: `celcash:hist:${clienteId}`, criadaEm: ps[0].pagaEm, ativadaEm: ps[0].pagaEm, cicloInicio: ultima.pagaEm,
      canceladaEm: new Date(+ultima.pagaEm + 30 * DIA), motivoCancelamento: "Pagou pela Celcash e não tem assinatura no BarberOS (histórico importado).", origem: "PAINEL",
    });
    assinaturaDe.set(clienteId, id);
  }
  const cobrancas: Prisma.CobrancaCreateManyInput[] = novos.map((p) => ({
    gatewayId: p.gatewayId, assinaturaId: assinaturaDe.get(p.clienteId)!, valorCentavos: p.valor, status: "PAGA",
    vencimento: new Date(`${p.vencimento}T00:00:00Z`), pagaEm: p.pagaEm, criadaEm: p.pagaEm,
  }));

  const porMes = new Map<string, number>();
  for (const p of novos) { const m = new Date(+p.pagaEm - 3 * 3_600_000).toISOString().slice(0, 7); porMes.set(m, (porMes.get(m) ?? 0) + p.valor); }
  console.log(`ja do CashBarber (mesmo pagamento): ${duplicados} | ja importados antes: ${jaImportados} | sem detalhe: ${semDetalhe}`);
  console.log(`novos: ${novos.length} (cliente por telefone ${como.telefone}, CPF ${como.cpf}, nome ${como.nome}) | sem cliente: ${semCliente.length}`);
  console.log(`assinaturas de historico novas: ${historicas.length}`);
  console.log("novo por mes:", JSON.stringify(Object.fromEntries([...porMes].sort().map(([m, v]) => [m, (v / 100).toFixed(2)]))));
  if (semCliente.length) console.log("sem cliente (ate 15):", semCliente.slice(0, 15).join("; "));
  if (!aplicar) { console.log("\nSo simulacao. Para gravar: --aplicar"); return; }
  const nAs = (await db.assinatura.createMany({ data: historicas, skipDuplicates: true })).count;
  let nCob = 0;
  for (let i = 0; i < cobrancas.length; i += 1000) nCob += (await db.cobranca.createMany({ data: cobrancas.slice(i, i + 1000), skipDuplicates: true })).count;
  console.log(`\ngravado: assinaturas de historico ${nAs}, mensalidades ${nCob}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
