/**
 * Importa as mensalidades pagas do CashBarber (Financeiro > Faturamento, relatorio20, filtro
 * "Origem da cobranca = Assinatura", exportado em CSV em janelas de ate 60 dias: fat_*.csv).
 *
 * Cada linha vira uma cobranca PAGA (gatewayId "cashbarber:pag:...", nunca e cobrada nem sincronizada)
 * na assinatura do cliente. Cliente que ja saiu do plano e nao tem assinatura no BarberOS ganha uma
 * assinatura CANCELADA de historico (plano pelo valor, encerrada 30 dias depois do ultimo pagamento).
 * O CSV so traz o nome: o cliente e achado pelo nome (quando o nome e de um cliente so).
 * Nada muda no status das assinaturas atuais e nenhuma mensagem sai.
 *
 * Ids fixos: rodar de novo nao duplica. Por padrao so mostra o que faria; --aplicar grava.
 * Rodar: DATABASE_URL=... npx tsx scripts/importar-mensalidades-cashbarber.ts <pasta-dos-csv> [--ate=2026-10-11] [--aplicar]
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const DIA = 86_400_000;

function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo.replace(/\r$/, "")); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

function telefoneBr(s: string): string | null {
  let d = (s || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d.length === 11 && d[2] === "9" && !/^0/.test(d) ? `55${d}` : null;
}

/** "dd/mm/aaaa hh:mm" no horario de Brasilia (UTC-3). */
function instante(s: string): Date {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
  if (!m) throw new Error(`Data inválida: ${s}`);
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 3, +m[5]));
}
const diaLocal = (d: Date) => new Date(+d - 3 * 3_600_000).toISOString().slice(0, 10);
const centavos = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100);
const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const hash = (...partes: string[]) => createHash("sha1").update(partes.join("|")).digest("hex").slice(0, 22);

function ler(pasta: string, prefixo: string) {
  return readdirSync(pasta).filter((f) => f.startsWith(prefixo) && f.endsWith(".csv"))
    .flatMap((f) => lerCsv(readFileSync(join(pasta, f), "utf8")).slice(1).filter((l) => l.length >= 8));
}

async function main() {
  const pasta = process.argv[2];
  if (!pasta) throw new Error("Informe a pasta com os CSVs.");
  const aplicar = process.argv.includes("--aplicar");
  const ate = new Date(`${process.argv.find((a) => a.startsWith("--ate="))?.slice(6) ?? "2026-10-11"}T03:00:00Z`);

  // Nome -> cliente: cadastro do BarberOS + nomes do historico de agendamentos (que traz o telefone).
  const clientes = await db.cliente.findMany({ select: { id: true, telefone: true, nome: true } });
  const porTelefone = new Map(clientes.map((c) => [c.telefone, c.id]));
  const porNome = new Map<string, Set<string>>();
  const juntar = (nome: string, id: string) => porNome.set(normal(nome), (porNome.get(normal(nome)) ?? new Set()).add(id));
  for (const c of clientes) juntar(c.nome, c.id);
  for (const l of ler(pasta, "agend_")) {
    const partes = l[2].split(" - ");
    const id = porTelefone.get(telefoneBr(partes.find((p) => /\(\d{2}\)/.test(p)) ?? "") ?? "");
    if (id) juntar(partes[0], id);
  }

  // Linhas de assinatura (o relatorio sem filtro tambem traz comandas). Mesma linha repetida entre janelas conta uma vez.
  type Pag = { gatewayId: string; clienteId: string; valor: number; pagaEm: Date };
  const vistos = new Map<string, number>();
  const pags: Pag[] = [];
  const semCliente = new Map<string, number>();
  let depois = 0, total = 0;
  for (const l of ler(pasta, "fat_")) {
    const [, , , nome, tipo, , valor, quando] = l;
    if (tipo !== "Assinatura") continue;
    const chave = `${nome}|${valor}|${quando}`;
    const pagaEm = instante(quando);
    if (pagaEm >= ate) { depois++; continue; }
    total++;
    const ids = porNome.get(normal(nome));
    if (ids?.size !== 1) { semCliente.set(nome, (semCliente.get(nome) ?? 0) + centavos(valor)); continue; }
    // Dois pagamentos iguais no mesmo minuto existem (ex.: duas assinaturas): o contador separa.
    const n = (vistos.get(chave) ?? 0) + 1;
    vistos.set(chave, n);
    pags.push({ gatewayId: `cashbarber:pag:${hash(chave, String(n))}`, clienteId: [...ids][0], valor: centavos(valor), pagaEm });
  }

  // Assinatura do cliente: a que esta valendo (ou a mais recente).
  const assinaturas = await db.assinatura.findMany({ select: { id: true, clienteId: true, status: true }, orderBy: { criadaEm: "desc" } });
  const planos = await db.plano.findMany({ select: { id: true, nome: true } });
  const plano = (v: number) => planos.find((p) => normal(p.nome) === (v >= 14_000 ? "plano de corte e barba" : v < 9_900 ? "plano de barba" : "plano de corte"))!.id;
  const assinaturaDe = new Map<string, string>();
  for (const a of assinaturas) if (a.status !== "CANCELADA" && !assinaturaDe.has(a.clienteId)) assinaturaDe.set(a.clienteId, a.id);
  for (const a of assinaturas) if (!assinaturaDe.has(a.clienteId)) assinaturaDe.set(a.clienteId, a.id);
  const historicas: Prisma.AssinaturaCreateManyInput[] = [];
  const porCliente = new Map<string, Pag[]>();
  for (const p of pags) porCliente.set(p.clienteId, [...(porCliente.get(p.clienteId) ?? []), p]);
  for (const [clienteId, ps] of porCliente) {
    if (assinaturaDe.has(clienteId)) continue;
    ps.sort((a, b) => +a.pagaEm - +b.pagaEm);
    const ultima = ps.at(-1)!;
    const id = `cbas_${hash(clienteId)}`;
    historicas.push({
      id, clienteId, planoId: plano(ultima.valor), status: "CANCELADA", formaPagamento: "CARTAO", precoCentavos: ultima.valor,
      gatewayId: `cashbarber:hist:${clienteId}`, criadaEm: ps[0].pagaEm, ativadaEm: ps[0].pagaEm, cicloInicio: ultima.pagaEm,
      canceladaEm: new Date(+ultima.pagaEm + 30 * DIA), motivoCancelamento: "Saiu do plano no CashBarber (histórico importado).", origem: "PAINEL",
    });
    assinaturaDe.set(clienteId, id);
  }
  const cobrancas: Prisma.CobrancaCreateManyInput[] = pags.map((p) => ({
    gatewayId: p.gatewayId, assinaturaId: assinaturaDe.get(p.clienteId)!, valorCentavos: p.valor, status: "PAGA",
    vencimento: new Date(`${diaLocal(p.pagaEm)}T00:00:00Z`), pagaEm: p.pagaEm, criadaEm: p.pagaEm,
  }));

  const porMes = new Map<string, number>();
  for (const p of pags) { const m = diaLocal(p.pagaEm).slice(0, 7); porMes.set(m, (porMes.get(m) ?? 0) + p.valor); }
  const fora = [...semCliente.values()].reduce((a, b) => a + b, 0);
  console.log(`corte: antes de ${ate.toISOString()} (fora: ${depois})`);
  console.log(`mensalidades: ${total} | com cliente ${pags.length} | sem cliente identificado ${total - pags.length} (R$ ${(fora / 100).toFixed(2)}, ${semCliente.size} nomes)`);
  console.log(`assinaturas de histórico (cliente já saiu do plano): ${historicas.length}`);
  console.log("pago por mês:", Object.fromEntries([...porMes].sort().map(([m, v]) => [m, (v / 100).toFixed(2)])));
  if (semCliente.size) console.log("exemplos sem cliente:", [...semCliente.keys()].slice(0, 8).join("; "));
  if (!aplicar) { console.log("\nSó simulação. Para gravar: --aplicar"); return; }

  const nAs = (await db.assinatura.createMany({ data: historicas, skipDuplicates: true })).count;
  let nCob = 0;
  for (let i = 0; i < cobrancas.length; i += 1000) nCob += (await db.cobranca.createMany({ data: cobrancas.slice(i, i + 1000), skipDuplicates: true })).count;
  console.log(`\ngravado: assinaturas de histórico ${nAs}, mensalidades ${nCob}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
