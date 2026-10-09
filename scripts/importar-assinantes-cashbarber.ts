/**
 * Liga os assinantes do CashBarber (Relatorios > Quantidade de assinantes, CSV) aos clientes ja
 * importados. O relatorio so traz o nome, entao a ligacao e pelo nome (sem acento/maiuscula);
 * nome que bate com mais de um cliente, ou com nenhum, fica de fora e e listado.
 * A cobranca continua no CashBarber: a assinatura entra sem gateway (gatewayId "cashbarber:...")
 * e a rotina de pagamentos do BarberOS nao gera cobranca nem manda aviso para ela.
 * Sem --aplicar so mostra o que faria.
 * Rodar: DATABASE_URL=... npx tsx scripts/importar-assinantes-cashbarber.ts "C:/.../Relatorio19.csv" [--aplicar]
 */
import { readFileSync } from "node:fs";
import { PrismaClient, type StatusAssinatura } from "@prisma/client";

const db = new PrismaClient();
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function lerCsv(t: string) {
  return t.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean).map((l) => [...l.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')));
}

const ATIVO = ["em dia", "boleto compensado", "pago fora do sistema"];
const status = (s: string): StatusAssinatura => (ATIVO.includes(s.toLowerCase()) ? "ATIVA" : "ATRASADA");

async function main() {
  const [arquivo, flag] = process.argv.slice(2);
  const aplicar = flag === "--aplicar";
  const [cab, ...linhas] = lerCsv(readFileSync(arquivo, "utf8"));
  if (cab.join() !== "Cliente,Plano,Status,Data de criação") throw new Error(`Cabeçalho inesperado: ${cab.join()}`);
  const assinantes = linhas.filter((l) => l[1]);

  const planos = await db.plano.findMany();
  const planoDe = (nome: string) => {
    const n = norm(nome);
    const alvo = n.includes("corte e barba") ? "plano de corte e barba" : n.includes("barba") ? "plano de barba" : "plano de corte";
    return planos.find((p) => norm(p.nome) === alvo);
  };

  // Indice de nomes: nome do cadastro + "outros nomes com este telefone" (cadastros juntados).
  const clientes = await db.cliente.findMany({ select: { id: true, nome: true, observacoes: true } });
  const indice = new Map<string, Set<string>>();
  const add = (nome: string, id: string) => { const k = norm(nome); if (k) indice.set(k, (indice.get(k) ?? new Set()).add(id)); };
  for (const c of clientes) {
    add(c.nome, c.id);
    const outros = c.observacoes?.match(/Outros nomes com este telefone: (.*?)\./)?.[1];
    outros?.split(", ").forEach((n) => add(n, c.id));
  }
  const jaAssina = new Set((await db.assinatura.findMany({ where: { status: { not: "CANCELADA" } }, select: { clienteId: true } })).map((a) => a.clienteId));

  const ok: { clienteId: string; planoId: string; preco: number; forma: "CARTAO" | "PIX"; st: StatusAssinatura; criada: Date; n: number }[] = [];
  const semCliente: string[] = [], ambiguos: string[] = [], repetidos: string[] = [];
  const usados = new Set<string>();
  for (const [i, [nome, planoNome, st, data]] of assinantes.entries()) {
    const plano = planoDe(planoNome);
    if (!plano) throw new Error(`Plano não encontrado para "${planoNome}"`);
    const ids = [...(indice.get(norm(nome)) ?? [])];
    if (!ids.length) { semCliente.push(nome); continue; }
    if (ids.length > 1) { ambiguos.push(`${nome} (${ids.length} clientes)`); continue; }
    if (usados.has(ids[0]) || jaAssina.has(ids[0])) { repetidos.push(nome); continue; }
    usados.add(ids[0]);
    const [d, m, a] = data.split("/").map(Number);
    ok.push({
      clienteId: ids[0], planoId: plano.id, preco: plano.precoCentavos, forma: /cart/i.test(planoNome) ? "CARTAO" : "PIX",
      st: status(st), criada: new Date(Date.UTC(a, m - 1, d, 12)), n: i,
    });
  }

  console.log(`assinantes no relatório: ${assinantes.length}`);
  console.log(`ligados a um cliente: ${ok.length} (${ok.filter((o) => o.st === "ATIVA").length} em dia, ${ok.filter((o) => o.st === "ATRASADA").length} com pagamento pendente)`);
  for (const p of planos) console.log(`  ${p.nome}: ${ok.filter((o) => o.planoId === p.id).length}`);
  console.log(`\nnome não encontrado nos clientes (${semCliente.length}):\n  ${semCliente.join("\n  ")}`);
  console.log(`\nnome igual em mais de um cliente (${ambiguos.length}):\n  ${ambiguos.join("\n  ")}`);
  if (repetidos.length) console.log(`\ncliente já tem assinatura (${repetidos.length}):\n  ${repetidos.join("\n  ")}`);

  if (!aplicar) return console.log("\n(simulação: rode com --aplicar para gravar)");
  await db.assinatura.createMany({
    data: ok.map((o) => ({
      clienteId: o.clienteId, planoId: o.planoId, status: o.st, formaPagamento: o.forma, precoCentavos: o.preco,
      gatewayId: `cashbarber:${o.n}:${o.clienteId}`, criadaEm: o.criada, ativadaEm: o.criada, origem: "PAINEL" as const,
    })),
  });
  console.log(`\ngravadas: ${ok.length}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
