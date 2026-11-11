/**
 * Relatorio da migracao CashBarber -> BarberOS. So le o banco: nao grava nada.
 * - Clientes: total, quem veio do CashBarber, dados completos e incompletos.
 * - Historico: quem tem atendimento, ultima visita por faixa e frequencia.
 * - Assinaturas por situacao (as que continuam cobradas no CashBarber a parte).
 * - Possiveis duplicados: mesmo nome (nome e sobrenome) em telefones diferentes.
 * - Conferência com os CSVs do CashBarber (opcional): uma decisão por registro da origem.
 * Identificacao de cada cliente: ID interno + telefone unico (55 + DDD + 9 digitos).
 * Com --saida=<pasta>, grava as listas em CSV (tem dados pessoais: nao salvar dentro do projeto).
 * Rodar: DATABASE_URL=... npx tsx scripts/relatorio-migracao.ts
 *          [--clientes=Clientes.csv] [--assinantes=Relatorio19.csv] [--saida=C:/pasta]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { dataLocal } from "@/lib/agenda/tempo";
import { contarPorFaixa, diasDesde, FAIXAS_VISITA, nomeComparavel, nomesRepetidos } from "@/lib/clientes/segmentos";
import { FAIXAS_FREQUENCIA, faixaFrequencia, intervalosPorCliente, mediana } from "@/lib/indicadores/calculos";
import { formatarTelefone } from "@/lib/telefone";
import { conferirAssinantes, conferirCadastros, lerFonteMigracao } from "./lib/conferencia-migracao";

const db = new PrismaClient();
const CASHBARBER = "cashbarber:";
const origemCashBarber = (origem: string | null) => origem?.toLowerCase().includes("cashbarber") === true;

const arg = (nome: string) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3) ?? null;
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "-");
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : "");
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const csvCampo = (v: string | number | null) => {
  const s = String(v ?? "");
  const protegido = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(s) ? `'${s}` : s;
  return `"${protegido.replace(/"/g, '""')}"`;
};

function gravarCsv(pasta: string | null, arquivo: string, cab: string[], linhas: (string | number | null)[][]) {
  if (!pasta) return;
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, arquivo), "\uFEFF" + [cab, ...linhas].map((l) => l.map(csvCampo).join(",")).join("\r\n"), { encoding: "utf8", mode: 0o600 });
  console.log(`  -> ${arquivo} (${linhas.length} linha${linhas.length === 1 ? "" : "s"})`);
}

function lerArquivo(arquivo: string, obrigatorias: string[]) {
  const bytes = readFileSync(arquivo);
  let texto: string;
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { texto = new TextDecoder("windows-1252").decode(bytes); }
  return { ...lerFonteMigracao(texto, obrigatorias), sha256: createHash("sha256").update(bytes).digest("hex") };
}

function apresentarConferencia(linhas: { pendencias: string[] }[], sha256: string) {
  const semDivergencia = linhas.filter(l => !l.pendencias.length).length;
  const motivos = new Map<string, number>();
  for (const l of linhas) for (const p of l.pendencias) motivos.set(p, (motivos.get(p) ?? 0) + 1);
  console.log(`  SHA-256 da fonte: ${sha256}`);
  console.log(`  registros revisados: ${linhas.length} | sem divergência nos campos conferidos: ${semDivergencia} | com pendências: ${linhas.length - semDivergencia}`);
  for (const [motivo, total] of motivos) console.log(`  ${motivo}: ${total}`);
}

async function main() {
  const saida = arg("saida");
  const agora = Date.now();
  console.log(`== Relatório da migração CashBarber → BarberOS (${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })})`);
  console.log("Identificação de cada cliente: ID interno + telefone único (55 + DDD + 9 dígitos).");

  const [clientes, visitas, comandas, assinaturas, mensalidades] = await db.$transaction([
    db.cliente.findMany({ select: { id: true, nome: true, telefone: true, cpf: true, email: true, dataNascimento: true, origemDetalhe: true, observacoes: true, excluidoEm: true } }),
    db.agendamento.findMany({ where: { status: "CONCLUIDO" }, select: { id: true, clienteId: true, inicio: true } }),
    db.comanda.findMany({ where: { id: { startsWith: "cbc_" } }, select: { itens: { select: { quantidade: true, precoUnitCentavos: true } } } }),
    db.assinatura.findMany({ select: {
      id: true, clienteId: true, status: true, gatewayId: true, proximoVencimento: true,
      plano: { select: { nome: true } },
      cobrancas: { where: { status: "PAGA", pagaEm: { not: null } }, orderBy: { pagaEm: "desc" }, take: 1, select: { pagaEm: true } },
    } }),
    db.cobranca.aggregate({ where: { gatewayId: { startsWith: `${CASHBARBER}pag:` }, status: "PAGA" }, _count: true, _sum: { valorCentavos: true } }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  const cadastros = clientes.map(c => ({ ...c, dataNascimento: iso(c.dataNascimento) }));

  // ---------------- clientes
  const total = clientes.length;
  const doCashBarber = clientes.filter((c) => origemCashBarber(c.origemDetalhe)).length;
  const comNasc = clientes.filter((c) => c.dataNascimento).length;
  const juntados = clientes.filter((c) => c.observacoes?.includes("Outros nomes com este telefone")).length;
  console.log("\nCLIENTES");
  console.log(`  total no BarberOS: ${total}`);
  console.log(`  origem registrada inclui CashBarber: ${doCashBarber} | demais cadastros: ${total - doCashBarber}`);
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
  console.log(`  origem local CashBarber: ${cbVigentes.length} (ativas ${st("ATIVA", noCashBarber)}, atrasadas ${st("ATRASADA", noCashBarber)}) | sem vencimento no BarberOS: ${cbVigentes.filter((a) => !a.proximoVencimento).length}`);
  console.log(`  mensalidades importadas do CashBarber marcadas como pagas no BarberOS: ${mensalidades._count}, total registrado ${reais(mensalidades._sum.valorCentavos ?? 0)}`);

  // ---------------- duplicados e incompletos
  const grupos = nomesRepetidos(clientes);
  console.log(`\nPOSSÍVEIS DUPLICADOS (mesmo nome em telefones diferentes): ${grupos.length} grupo(s)`);
  gravarCsv(saida, "possiveis-duplicados.csv", ["Grupo", "Nome", "Telefone", "Atendimentos", "Última visita", "ID"],
    grupos.flatMap((g, i) => g.map((c) => [i + 1, c.nome, formatarTelefone(c.telefone), porCliente.get(c.id)?.length ?? 0, dataBr(ultima(c.id) === null ? null : new Date(ultima(c.id)!)), c.id])));

  const generico = (n: string) => nomeComparavel(n).length < 3 || nomeComparavel(n) === "cliente";
  const incompletos = clientes.map((c) => ({
    c, falta: [!c.dataNascimento && "nascimento", generico(c.nome) && "nome", !porCliente.has(c.id) && "histórico"].filter(Boolean) as string[],
  })).filter((x) => x.falta.length);
  console.log("\nDADOS INCOMPLETOS");
  console.log(`  sem nascimento: ${total - comNasc} | nome genérico ou curto: ${clientes.filter((c) => generico(c.nome)).length} | sem histórico: ${total - comHistorico}`);
  gravarCsv(saida, "clientes-incompletos.csv", ["Nome", "Telefone", "Falta", "Origem", "ID"],
    incompletos.map(({ c, falta }) => [c.nome, formatarTelefone(c.telefone), falta.join(", "), origemCashBarber(c.origemDetalhe) ? "CashBarber" : "Outra ou não identificada", c.id]));

  // ---------------- conferencia com o CSV de clientes do CashBarber
  const arqClientes = arg("clientes");
  if (arqClientes) {
    const fonte = lerArquivo(arqClientes, ["Nome", "Telefone"]);
    const revisao = conferirCadastros(fonte.linhas, cadastros);
    console.log("\nCONFERÊNCIA COM O CSV DE CLIENTES DO CASHBARBER");
    apresentarConferencia(revisao, fonte.sha256);
    gravarCsv(saida, "conferencia-clientes-cashbarber.csv", ["Registro CSV", "ID CashBarber", "ID BarberOS", "Pendências"], revisao.map(l => [l.linha, l.origemId, l.clienteId, l.pendencias.join(" | ")]));
    const vinculados = new Set(revisao.map(l => l.clienteId));
    const semCorrespondencia = clientes.filter(c => origemCashBarber(c.origemDetalhe) && !vinculados.has(c.id));
    console.log(`  Cadastros locais de origem CashBarber sem correspondência identificada nesta exportação: ${semCorrespondencia.length}`);
    gravarCsv(saida, "clientes-legados-sem-correspondencia.csv", ["ID BarberOS"], semCorrespondencia.map(c => [c.id]));
  }

  // ---------------- conferencia com o relatorio de assinantes do CashBarber
  const arqAssinantes = arg("assinantes");
  if (arqAssinantes) {
    const fonte = lerArquivo(arqAssinantes, ["Cliente", "Plano", "Status"]);
    const revisao = conferirAssinantes(fonte.linhas, cadastros, assinaturas.map(a => ({
      ...a, plano: a.plano.nome, proximoVencimento: iso(a.proximoVencimento),
      ultimoPagamento: a.cobrancas[0]?.pagaEm ? dataLocal(a.cobrancas[0].pagaEm) : null,
    })));
    console.log("\nCONFERÊNCIA COM O RELATÓRIO DE ASSINANTES DO CASHBARBER");
    apresentarConferencia(revisao, fonte.sha256);
    console.log(`  situação reportada nas linhas da origem: em dia ${revisao.filter(l => l.statusOrigem === "ATIVA").length} | atrasadas ${revisao.filter(l => l.statusOrigem === "ATRASADA").length} | primeiro pagamento ${revisao.filter(l => l.statusOrigem === "PENDENTE").length} | canceladas ${revisao.filter(l => l.statusOrigem === "CANCELADA").length} | indefinidas ${revisao.filter(l => !l.statusOrigem).length}`);
    console.log("  Contagem por linha, sujeita a duplicidades e à data da exportação. A adimplência depende da conciliação do ciclo.");
    const campos = [
      ["ID do contrato", "id da assinatura", "id do contrato"], ["CPF ou telefone", "cpf", "telefone"],
      ["Próximo vencimento", "proximo vencimento"], ["Último pagamento", "ultimo pagamento"],
    ].filter(([, ...chaves]) => !chaves.some(c => fonte.cabecalho.includes(c))).map(([nome]) => nome);
    if (campos.length) console.log(`  Campos ausentes na exportação (confira no contrato e no gateway): ${campos.join(", ")}.`);
    gravarCsv(saida, "conferencia-assinaturas-cashbarber.csv", ["Registro CSV", "ID CashBarber", "ID cliente BarberOS", "ID assinatura BarberOS", "Situação reportada", "Próximo vencimento CashBarber", "Próximo vencimento BarberOS", "Pendências"], revisao.map(l => [l.linha, l.origemId, l.clienteId, l.assinaturaId, l.statusOrigem, l.vencimentoOrigem, l.vencimentoBarberOS, l.pendencias.join(" | ")]));
    const vinculados = new Set(revisao.map(l => l.assinaturaId));
    const semCorrespondencia = assinaturas.filter(a => noCashBarber(a) && !vinculados.has(a.id));
    console.log(`  Contratos locais de origem CashBarber sem correspondência identificada nesta exportação: ${semCorrespondencia.length}`);
    gravarCsv(saida, "contratos-legados-sem-correspondencia.csv", ["ID BarberOS", "Situação", "Próximo vencimento"], semCorrespondencia.map(a => [a.id, a.status, iso(a.proximoVencimento)]));
  }

  console.log("\nNão vêm do CashBarber: créditos/saldos (não há relatório deles) e o serviço de cada atendimento antigo");
  console.log("(entra como \"Atendimento (CashBarber)\").");
}

main()
  .catch((e: unknown) => {
    if (e instanceof Error && /^(CSV com|Colunas obrigatórias)/.test(e.message)) console.error(e.message);
    else console.error("Falha na leitura do banco, dos arquivos de origem ou na gravação do relatório. Confira os argumentos e o acesso.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
