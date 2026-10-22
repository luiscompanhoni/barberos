/**
 * Completa perfis a partir dos CSVs originais. Simulacao por padrao.
 * node completar-cadastros.cjs cash.csv celcoin.csv [--aplicar] [--relatorio=/pasta/privada/resultado.json]
 * Compilar com esbuild --bundle --platform=node --external:@prisma/client.
 * Nenhuma mensagem, cobranca, assinatura, permissao ou consentimento existente e alterado.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { diferencaAuditavel, planejarCadastros, type FonteCadastro } from "./dados/cadastros-verificados";

function csv(arquivo: string, separador: string) {
  const bytes = readFileSync(arquivo);
  let texto: string;
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { texto = new TextDecoder("windows-1252").decode(bytes); }
  const linhas: string[][] = []; let linha: string[] = [], campo = "", aspas = false;
  texto = texto.replace(/^\uFEFF/, "");
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') { if (aspas && texto[i + 1] === '"') { campo += '"'; i++; } else aspas = !aspas; }
    else if (c === separador && !aspas) { linha.push(campo); campo = ""; }
    else if (c === "\n" && !aspas) { linha.push(campo.replace(/\r$/, "")); if (linha.some(Boolean)) linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (aspas) throw new Error("CSV com aspas nao fechadas");
  if (campo || linha.length) { linha.push(campo.replace(/\r$/, "")); linhas.push(linha); }
  const cab = linhas.shift(); if (!cab) throw new Error("CSV vazio");
  if (linhas.some(l => l.length !== cab.length)) throw new Error("CSV com quantidade de colunas inconsistente");
  return { cab, linhas, sha256: createHash("sha256").update(bytes).digest("hex") };
}
function ler(arquivo: string, fonte: "cashbarber" | "celcoin") {
  const dados = csv(arquivo, fonte === "cashbarber" ? "," : ";");
  const indice = (s: string) => { const i = dados.cab.indexOf(s); if (i < 0) throw new Error(`Coluna obrigatoria ausente: ${s}`); return i; };
  const cash = fonte === "cashbarber";
  const c = { id: indice(cash ? "ID" : "Código"), nome: indice(cash ? "Nome" : "Nome / Razão Social"), cpf: indice(cash ? "CPF" : "Documento do cliente"), email: indice(cash ? "Email" : "E-mail"), telefone: indice("Telefone"), nasc: cash ? indice("Data de nascimento") : -1 };
  const limpar = (s: string | undefined) => { const v = s?.trim(); return v && v !== "N/A" ? v : null; };
  const registros: FonteCadastro[] = dados.linhas.map(l => ({ fonte, id: l[c.id], nome: limpar(l[c.nome]) ?? "", telefone: limpar(l[c.telefone]), cpf: limpar(l[c.cpf]), email: limpar(l[c.email]), dataNascimento: c.nasc >= 0 ? limpar(l[c.nasc]) : null }));
  return { registros, sha256: dados.sha256 };
}
const db = new PrismaClient();
async function main() {
  const args = process.argv.slice(2), arquivos = args.filter(a => !a.startsWith("--"));
  if (arquivos.length !== 2) throw new Error("Informe CSV de clientes CashBarber e CSV de clientes Celcoin, nessa ordem");
  if (args.some(a => a.startsWith("--") && a !== "--aplicar" && !a.startsWith("--relatorio="))) throw new Error("Opcao desconhecida");
  const cash = ler(arquivos[0], "cashbarber"), cel = ler(arquivos[1], "celcoin");
  const aplicar = args.includes("--aplicar");
  const hashes = { cashbarber: cash.sha256, celcoin: cel.sha256 };
  const relatorio = await db.$transaction(async tx => {
    const clientes = await tx.cliente.findMany({ select: { id: true, nome: true, telefone: true, cpf: true, email: true, dataNascimento: true } });
    const plano = planejarCadastros(clientes.map(c => ({ ...c, dataNascimento: c.dataNascimento?.toISOString().slice(0, 10) ?? null })), [...cash.registros, ...cel.registros]);
    if (aplicar) {
      for (const a of plano.atualizacoes) {
        const dados = { ...(a.depois.cpf ? { cpf: a.depois.cpf } : {}), ...(a.depois.email ? { email: a.depois.email } : {}), ...(a.depois.dataNascimento ? { dataNascimento: new Date(a.depois.dataNascimento + "T00:00:00Z") } : {}) };
        await tx.cliente.update({ where: { id: a.id }, data: dados });
        await tx.auditoria.create({ data: { acao: "migracao_completar_cadastro", entidade: "cliente", entidadeId: a.id, dados: { ...diferencaAuditavel(a), fontes: a.fontes, hashes } } });
      }
      for (const n of plano.novos) {
        const novo = await tx.cliente.create({ data: { nome: n.nome, telefone: n.telefone!, cpf: n.cpf, email: n.email, dataNascimento: n.dataNascimento ? new Date(n.dataNascimento + "T00:00:00Z") : null, origemDetalhe: "Importacao verificada CashBarber/Celcoin", aceitaMensagens: false } });
        await tx.auditoria.create({ data: { acao: "migracao_criar_cadastro", entidade: "cliente", entidadeId: novo.id, dados: { fonte: n.fonte, origemId: n.id, hashes, consentimento: "Nao inferido: mensagens automaticas desabilitadas" } } });
      }
    }
    return { geradoEm: new Date().toISOString(), aplicado: aplicar, hashes, totalAntes: clientes.length, fontes: { cashbarber: cash.registros.length, celcoin: cel.registros.length }, ...plano };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000 });
  const caminho = args.find(a => a.startsWith("--relatorio="))?.slice(12);
  if (caminho) writeFileSync(caminho, JSON.stringify(relatorio, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ aplicado: aplicar, totalAntes: relatorio.totalAntes, fontes: relatorio.fontes, completar: relatorio.atualizacoes.length, criar: relatorio.novos.length, pendencias: relatorio.pendencias.length, campos: Object.fromEntries(["cpf", "email", "dataNascimento"].map(k => [k, relatorio.atualizacoes.filter(a => a.depois[k as keyof typeof a.depois]).length])), motivos: relatorio.pendencias.reduce<Record<string, number>>((r, p) => { r[p.motivo] = (r[p.motivo] ?? 0) + 1; return r; }, {}) }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Falha na importacao"); process.exitCode = 1; }).finally(() => db.$disconnect());
