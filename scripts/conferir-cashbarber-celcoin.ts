/**
 * Confere exportações locais de clientes (CashBarber) e contratos/transações (Celcoin).
 * Não consulta rede ou banco. A posição corresponde à data das exportações.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { nomeChave } from "./dados/cadastros-verificados";
import { conferirCelcoin } from "./lib/conferencia-celcoin";
import { lerFonteMigracao } from "./lib/conferencia-migracao";

function ler(arquivo: string, obrigatorias: string[], separador: "," | ";") {
  const bytes = readFileSync(arquivo);
  let texto: string;
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { texto = new TextDecoder("windows-1252").decode(bytes); }
  const fonte = lerFonteMigracao(texto, obrigatorias, separador);
  return { linhas: fonte.linhas, origem: { arquivo: basename(arquivo), sha256: createHash("sha256").update(bytes).digest("hex"), registros: fonte.linhas.length } };
}

function contar(valores: string[]) {
  const quantidades = new Map<string, number>();
  for (const v of valores) quantidades.set(v, (quantidades.get(v) ?? 0) + 1);
  return Object.fromEntries(quantidades);
}

function main() {
  const { values: v } = parseArgs({ options: {
    clientes: { type: "string" }, contratos: { type: "string" }, transacoes: { type: "string" },
    "assinaturas-cashbarber": { type: "string" }, "data-corte": { type: "string" }, saida: { type: "string" },
  } });
  const { clientes, contratos, transacoes, "data-corte": dataCorte, saida } = v;
  if (!clientes || !contratos || !transacoes || !dataCorte) throw new Error("Informe --clientes, --contratos, --transacoes e --data-corte=AAAA-MM-DD.");
  const c = ler(clientes, ["ID", "Nome", "CPF", "Telefone"], ",");
  const a = ler(contratos, ["Código", "Nome do cliente", "Documento do Cliente", "Plano", "Valor", "Status", "Periodicidade"], ";");
  const t = ler(transacoes, ["Código", "Código do Contrato/Venda", "Nome do cliente", "Plano", "Vencimento", "Status", "Data do status atual", "Valor"], ";");
  const cash = v["assinaturas-cashbarber"] ? ler(v["assinaturas-cashbarber"], ["Cliente", "Plano", "Status"], ",") : null;
  const r = conferirCelcoin(c.linhas, a.linhas, t.linhas, dataCorte);
  const ativos = r.contratos.filter(l => l.recorrencia && l.status === "ativa");
  const resumo = {
    dataCorte, fontes: { clientesCashBarber: c.origem, assinaturasCashBarber: cash?.origem, contratosCelcoin: a.origem, transacoesCelcoin: t.origem },
    clientesCashBarber: r.clientes, cadastrosComPendencia: r.pendenciasCadastros.length,
    motivosCadastro: contar(r.pendenciasCadastros.flatMap(p => p.motivos)),
    situacoesReportadasCashBarber: cash ? contar(cash.linhas.map(l => nomeChave(l.colunas?.status ?? "") || "SEM_STATUS")) : undefined,
    contratosRecorrentesAtivosNaExportacao: ativos.length,
    contratosInconsistentes: r.contratosInconsistentes,
    vinculosDosAtivos: contar(ativos.map(l => l.vinculo)),
    estadosDosUltimosCiclos: contar(ativos.map(l => l.estado)),
    clientesComMaisDeUmContratoAtivo: r.clientesComMaisDeUmContratoAtivo,
    ciclosConfirmadosComVinculo: r.ciclosConfirmadosComVinculo,
    ciclosConfirmadosSemPendenciaAnterior: r.ciclosConfirmadosSemPendenciaAnterior,
    ciclosVencidosComVinculo: r.ciclosVencidosComVinculo,
    transacoesSemContratoIdentificado: r.transacoesSemContratoIdentificado,
  };
  if (saida) writeFileSync(saida, JSON.stringify({ resumo, cadastrosAConferir: r.pendenciasCadastros, contratos: r.contratos }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(resumo, null, 2));
}

try { main(); }
catch (e) {
  const mensagem = e instanceof Error && /^(Informe|Data de corte|CSV com|Colunas obrigatórias)/.test(e.message) ? e.message
    : "Falha ao ler as exportações ou gravar o relatório. Confira caminhos e permissões.";
  console.error(mensagem);
  process.exitCode = 1;
}
