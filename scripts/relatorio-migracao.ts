/**
 * Relatorio da migracao CashBarber -> BarberOS. So le o banco: nao grava nada.
 * - Clientes: total, quem veio do CashBarber, dados completos e incompletos.
 * - Historico: quem tem atendimento, ultima visita por faixa e frequencia.
 * - Assinaturas por situacao (as que continuam cobradas no CashBarber a parte).
 * - Possiveis duplicados: mesmo nome (nome e sobrenome) em telefones diferentes.
 * - Conferencia com os CSVs do CashBarber (opcional): quem ficou de fora e por que.
 * Identificacao de cada cliente: ID interno + telefone unico (55 + DDD + 9 digitos).
 * Com --saida=<pasta>, grava as listas em CSV (tem dados pessoais: nao salvar dentro do projeto).
 * Rodar: DATABASE_URL=... npx tsx scripts/relatorio-migracao.ts
 *          [--clientes=Clientes.csv] [--assinantes=Relatorio19.csv] [--saida=C:/pasta]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { contarPorFaixa, diasDesde, FAIXAS_VISITA, nomeComparavel, nomesRepetidos } from "@/lib/clientes/segmentos";
import { FAIXAS_FREQUENCIA, faixaFrequencia, intervalosPorCliente, mediana } from "@/lib/indicadores/calculos";
import { formatarTelefone } from "@/lib/telefone";

const db = new PrismaClient();
const MARCA = "Importado do CashBarber";
const CASHBARBER = "cashbarber:";

/** CSV com aspas (formato do CashBarber). */
function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^\uFEFF/, "");
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

/** Mesma regra da importacao de clientes. */
function telefoneBr(s: string): string | null {
  let d = (s || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d.length === 11 && d[2] === "9" && !/^0/.test(d) ? `55${d}` : null;
}

const arg = (nome: string) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3) ?? null;
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "-");
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : "");
const csvCampo = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function gravarCsv(pasta: string | null, arquivo: string, cab: string[], linhas: (string | number | null)[][]) {
  if (!pasta) return;
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, arquivo), "\uFEFF" + [cab, ...linhas].map((l) => l.map(csvCampo).join(",")).join("\r\n"), "utf8");
  console.log(`  -> ${join(pasta, arquivo)} (${linhas.length} linha${linhas.length === 1 ? "" : "s"})`);
}

async function main() {
  const saida = arg("saida");
  const agora = Date.now();
  console.log(`== Relatório da migração CashBarber → BarberOS (${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })})`);
  console.log("Identificação de cada cliente: ID interno + telefone único (55 + DDD + 9 dígitos).");

  const [clientes, visitas, comandas, assinaturas, mensalidades] = await Promise.all([
    db.cliente.findMany({ select: { id: true, nome: true, telefone: true, cpf: true, email: true, dataNascimento: true, origemDetalhe: true, observacoes: true } }),
    db.agendamento.findMany({ where: { status: "CONCLUIDO" }, select: { id: true, clienteId: true, inicio: true } }),
    db.comanda.findMany({ where: { id: { startsWith: "cbc_" } }, select: { itens: { select: { quantidade: true, precoUnitCentavos: true } } } }),
    db.assinatura.findMany({ select: { status: true, gatewayId: true, proximoVencimento: true, cliente: { select: { nome: true, observacoes: true } } } }),
    db.cobranca.aggregate({ where: { gatewayId: { startsWith: `${CASHBARBER}pag:` } }, _count: true, _sum: { valorCentavos: true } }),
  ]);

  // ---------------- clientes
  const total = clientes.length;
  const doCashBarber = clientes.filter((c) => c.origemDetalhe === MARCA).length;
  const comNasc = clientes.filter((c) => c.dataNascimento).length;
  const juntados = clientes.filter((c) => c.observacoes?.includes("Outros nomes com este telefone")).length;
  console.log("\nCLIENTES");
  console.log(`  total no BarberOS: ${total}`);
  console.log(`  vieram do CashBarber: ${doCashBarber} | cadastrados direto no BarberOS: ${total - doCashBarber}`);
  console.log(`  com data de nascimento: ${comNasc} (${pct(comNasc, total)}) | com CPF: ${clientes.filter((c) => c.cpf).length} | com e-mail: ${clientes.filter((c) => c.email).length}`);
  console.log(`  telefones com mais de um nome no CashBarber (juntados num cadastro só): ${juntados}`);

  // ---------------- historico
  const porCliente = new Map<string, number[]>();
  for (const v of visitas) porCliente.set(v.clienteId, [...(porCliente.get(v.clienteId) ?? []), +v.inicio]);
  const ultima = (id: string) => { const vs = porCliente.get(id); return vs ? Math.max(...vs) : null; };
  const comHistorico = clientes.filter((c) => porCliente.has(c.id)).length;
  const importados = visitas.filter((v) => v.id.startsWith("cba_")).length;
  const totalComandas = comandas.reduce((t, c) => t + c.itens.reduce((s, i) => s + i.quantidade * i.precoUnitCentavos, 0), 0);
  const faixas = contarPorFaixa(clientes.map((c) => diasDesde(ultima(c.id), agora)));
  const intervalos = intervalosPorCliente(porCliente);
  const porFrequencia = Object.fromEntries(FAIXAS_FREQUENCIA.map((f) => [f, 0]));
  for (const d of intervalos.values()) porFrequencia[faixaFrequencia(d)]++;
  const med = mediana([...intervalos.values()]);
  console.log("\nHISTÓRICO");
  console.log(`  com pelo menos 1 atendimento concluído: ${comHistorico} (${pct(comHistorico, total)}) | sem nenhum: ${total - comHistorico}`);
  console.log(`  atendimentos concluídos: ${visitas.length} (vindos do CashBarber: ${importados})`);
  console.log(`  comandas vindas do CashBarber: ${comandas.length}, total ${reais(totalComandas)}`);
  console.log(`  última visita: ${FAIXAS_VISITA.map((f) => `${f} ${faixas[f]}`).join(" | ")}`);
  console.log(`  frequência (clientes com 2+ visitas: ${intervalos.size}; mediana de ${med === null ? "-" : Math.round(med)} dias entre visitas):`);
  console.log(`    ${FAIXAS_FREQUENCIA.map((f) => `${f} ${porFrequencia[f]}`).join(" | ")}`);

  // ---------------- assinaturas
  const st = (s: string, so?: (a: (typeof assinaturas)[number]) => boolean) => assinaturas.filter((a) => a.status === s && (!so || so(a))).length;
  const noCashBarber = (a: (typeof assinaturas)[number]) => !!a.gatewayId?.startsWith(CASHBARBER) && !a.gatewayId.startsWith(`${CASHBARBER}hist:`);
  const cbVigentes = assinaturas.filter((a) => noCashBarber(a) && (a.status === "ATIVA" || a.status === "ATRASADA"));
  console.log("\nASSINATURAS");
  console.log(`  ativas ${st("ATIVA")} | atrasadas ${st("ATRASADA")} | esperando o 1º pagamento ${st("PENDENTE")} | canceladas ${st("CANCELADA")}`);
  console.log(`  ainda cobradas no CashBarber: ${cbVigentes.length} (ativas ${st("ATIVA", noCashBarber)}, atrasadas ${st("ATRASADA", noCashBarber)}) | sem vencimento no BarberOS: ${cbVigentes.filter((a) => !a.proximoVencimento).length}`);
  console.log(`  mensalidades pagas vindas do CashBarber: ${mensalidades._count}, total ${reais(mensalidades._sum.valorCentavos ?? 0)}`);

  // ---------------- duplicados e incompletos
  const grupos = nomesRepetidos(clientes);
  console.log(`\nPOSSÍVEIS DUPLICADOS (mesmo nome em telefones diferentes): ${grupos.length} grupo(s)`);
  for (const g of grupos.slice(0, 15)) console.log(`  ${g[0].nome}: ${g.map((c) => formatarTelefone(c.telefone)).join(", ")}`);
  if (grupos.length > 15) console.log(`  ... e mais ${grupos.length - 15} (lista completa com --saida)`);
  gravarCsv(saida, "possiveis-duplicados.csv", ["Grupo", "Nome", "Telefone", "Atendimentos", "Última visita", "ID"],
    grupos.flatMap((g, i) => g.map((c) => [i + 1, c.nome, formatarTelefone(c.telefone), porCliente.get(c.id)?.length ?? 0, dataBr(ultima(c.id) === null ? null : new Date(ultima(c.id)!)), c.id])));

  const generico = (n: string) => nomeComparavel(n).length < 3 || nomeComparavel(n) === "cliente";
  const incompletos = clientes.map((c) => ({
    c, falta: [!c.dataNascimento && "nascimento", generico(c.nome) && "nome", !porCliente.has(c.id) && "histórico"].filter(Boolean) as string[],
  })).filter((x) => x.falta.length);
  console.log("\nDADOS INCOMPLETOS");
  console.log(`  sem nascimento: ${total - comNasc} | nome genérico ou curto: ${clientes.filter((c) => generico(c.nome)).length} | sem histórico: ${total - comHistorico}`);
  gravarCsv(saida, "clientes-incompletos.csv", ["Nome", "Telefone", "Falta", "Origem", "ID"],
    incompletos.map(({ c, falta }) => [c.nome, formatarTelefone(c.telefone), falta.join(", "), c.origemDetalhe === MARCA ? "CashBarber" : "BarberOS", c.id]));

  // ---------------- conferencia com o CSV de clientes do CashBarber
  const arqClientes = arg("clientes");
  if (arqClientes) {
    const [cab, ...linhas] = lerCsv(readFileSync(arqClientes, "utf8"));
    const iNome = cab.indexOf("Nome"), iTel = cab.indexOf("Telefone");
    if (iNome < 0 || iTel < 0) throw new Error("O CSV de clientes precisa das colunas Nome e Telefone.");
    const validas = linhas.filter((l) => l.length >= cab.length - 1);
    const telefones = new Set(clientes.map((c) => c.telefone));
    const vistos = new Set<string>();
    const fora: (string | null)[][] = [];
    for (const l of validas) {
      const tel = telefoneBr(l[iTel]);
      if (!tel) { fora.push([l[iNome], l[iTel], "telefone inválido ou vazio"]); continue; }
      if (vistos.has(tel)) continue;
      vistos.add(tel);
      if (!telefones.has(tel)) fora.push([l[iNome], l[iTel], "não está no BarberOS"]);
    }
    const faltando = fora.filter((f) => f[2] === "não está no BarberOS").length;
    console.log("\nCONFERÊNCIA COM O CSV DE CLIENTES DO CASHBARBER");
    console.log(`  linhas no CSV: ${validas.length} | telefones válidos distintos: ${vistos.size} | sem telefone válido: ${fora.length - faltando}`);
    console.log(`  encontrados no BarberOS: ${vistos.size - faltando} (${pct(vistos.size - faltando, vistos.size)}) | faltando: ${faltando}`);
    gravarCsv(saida, "clientes-fora-da-migracao.csv", ["Nome", "Telefone no CashBarber", "Motivo"], fora);
  }

  // ---------------- conferencia com o relatorio de assinantes do CashBarber
  const arqAssinantes = arg("assinantes");
  if (arqAssinantes) {
    const linhas = readFileSync(arqAssinantes, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean)
      .map((l) => [...l.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'))).slice(1).filter((l) => l[1]);
    // Nomes de quem tem assinatura vigente: o do cadastro e os "outros nomes" juntados no mesmo telefone.
    const vigentes = new Set<string>();
    for (const a of assinaturas.filter((a) => a.status !== "CANCELADA")) {
      vigentes.add(nomeComparavel(a.cliente.nome));
      a.cliente.observacoes?.match(/Outros nomes com este telefone: (.*?)\./)?.[1].split(", ").forEach((n) => vigentes.add(nomeComparavel(n)));
    }
    const semVinculo = linhas.filter(([nome]) => !vigentes.has(nomeComparavel(nome)));
    console.log("\nCONFERÊNCIA COM O RELATÓRIO DE ASSINANTES DO CASHBARBER");
    console.log(`  assinantes no relatório: ${linhas.length} | com assinatura no BarberOS: ${linhas.length - semVinculo.length} | sem vínculo: ${semVinculo.length}`);
    for (const [nome, plano, status] of semVinculo.slice(0, 15)) console.log(`  ${nome} (${plano}, ${status})`);
    if (semVinculo.length > 15) console.log(`  ... e mais ${semVinculo.length - 15} (lista completa com --saida)`);
    gravarCsv(saida, "assinantes-sem-vinculo.csv", ["Cliente", "Plano", "Status no CashBarber", "Desde"], semVinculo);
  }

  console.log("\nNão vêm do CashBarber: créditos/saldos (não há relatório deles) e o serviço de cada atendimento antigo");
  console.log("(entra como \"Atendimento (CashBarber)\").");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
