/**
 * Regras puras do extrato da Stone (CSV baixado em conta.stone.com.br > Extrato > Baixar extrato > CSV):
 * leitura do arquivo, id de cada linha (a Stone nao manda id: data com milissegundos + valor + saldos) e tipo.
 */
import { createHash } from "node:crypto";
import { ehContaPropria, type TipoExterno } from "./regras";

export type LinhaStone = Record<string, string>;

/** CSV com aspas e virgulas dentro dos campos. */
export function lerCsvStone(texto: string): LinhaStone[] {
  const t = texto.replace(/^﻿/, "");
  const L: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo.replace(/\r$/, "")); L.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); L.push(linha); }
  if (aspas) throw new Error("O CSV contém aspas sem fechamento.");
  const [cabecalho, ...corpo] = L;
  const cab = cabecalho?.map(c => c.trim());
  const obrigatorios = ["Data", "Horário", "Movimentação", "Tipo", "Valor", "Saldo antes", "Saldo depois"];
  if (!cab || new Set(cab).size !== cab.length || obrigatorios.some(c => !cab.includes(c))) throw new Error("O extrato CSV da Stone precisa conter Data, Horário, Movimentação, Tipo, Valor, Saldo antes e Saldo depois, sem colunas repetidas.");
  return corpo.filter(l => l.some(c => c.trim())).map((l, i) => {
    if (l.length !== cab.length) throw new Error(`Linha ${i + 2}: quantidade de colunas diferente do cabeçalho.`);
    return Object.fromEntries(cab.map((k, n) => [k, l[n].trim()]));
  });
}

/** "R$ 1.234,56" / "-650,00" / "Grátis" -> centavos (com sinal). */
export function centavosStone(s: string) {
  const t = (s ?? "").trim().replace(/^R\$\s*/i, "").replace(/[\s\u00a0]/g, "");
  if (/^gr[aá]tis$/i.test(t)) return 0;
  if (!/^[+-]?(?:(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}|\d+)$/.test(t)) throw new Error("Valor monetário inválido no extrato.");
  const negativo = t.startsWith("-");
  const [inteiro, decimal = "00"] = t.replace(/^[+-]/, "").replace(/\./g, "").split(",");
  const valor = Number(inteiro) * 100 + Number(decimal);
  if (!Number.isSafeInteger(valor) || valor > 2_147_483_647) throw new Error("Valor monetário fora do limite suportado.");
  return negativo ? -valor : valor;
}

/** "14/10/2026 20:36" + "20:36:32.567" -> instante (horario de Brasilia). */
export function instanteStone(o: LinhaStone) {
  const partes = (o["Data"] ?? "").trim().split(/\s+/);
  const data = partes[0]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const hora = (o["Horário"] || partes[1] || "").match(/^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (!data || !hora || +hora[1] > 23 || +hora[2] > 59 || +(hora[3] ?? 0) > 59) throw new Error("Data ou horário inválido no extrato.");
  const [, dia, mes, ano] = data;
  const calendario = new Date(`${ano}-${mes}-${dia}T00:00:00Z`);
  if (!Number.isFinite(+calendario) || calendario.toISOString().slice(0, 10) !== `${ano}-${mes}-${dia}`) throw new Error("A data do extrato não existe no calendário.");
  return new Date(`${ano}-${mes}-${dia}T${hora[1]}:${hora[2]}:${hora[3] ?? "00"}.${(hora[4] ?? "0").padEnd(3, "0")}-03:00`);
}

/** Id estavel da linha (o mesmo arquivo baixado de novo nao duplica). */
export const idStoneLegado = (o: LinhaStone) =>
  createHash("sha1").update([o["Data"], o["Horário"], o["Valor"], o["Saldo antes"], o["Saldo depois"], o["Tipo"]].join("|")).digest("hex").slice(0, 24);

export function idStone(o: LinhaStone) {
  const texto = (s: string | undefined) => (s ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  const referencia = o["ID da transação"] || o["Identificador da transação"];
  return createHash("sha256").update(JSON.stringify(referencia ? ["stone-id", texto(referencia)] : [
    "stone-canonica-v1", instanteStone(o).toISOString(), centavosStone(o["Valor"]),
    centavosStone(o["Saldo antes"]), centavosStone(o["Saldo depois"]),
    texto(o["Tipo"]), texto(o["Movimentação"]),
  ])).digest("hex");
}

/** Classifica uma linha do extrato da Stone. `contraparte` e quem recebeu (debito) ou quem mandou (credito). */
export function classificarStone(o: LinhaStone, contasProprias: string[]): { tipo: TipoExterno; forma: string | null; contraparte: string | null } {
  const debito = o["Movimentação"] === "Débito";
  const tipo = o["Tipo"] ?? "";
  const contraparte = (debito ? o["Destino"] : o["Origem"])?.trim() || null;
  if (debito) {
    if (ehContaPropria(contraparte, contasProprias)) return { tipo: "TRANSFERENCIA", forma: "PIX", contraparte };
    return { tipo: "PAGAMENTO", forma: tipo === "Pagamento" ? "BOLETO" : tipo === "Pix" ? "PIX" : null, contraparte };
  }
  // Pix vindo da propria empresa (ex.: repasse da Celcash, que esta no nome da Black Barber Ltda).
  if (ehContaPropria(contraparte, contasProprias)) return { tipo: "TRANSFERENCIA", forma: "PIX", contraparte };
  if (tipo === "Recebível de Cartão" || /stone principal/i.test(contraparte ?? "")) return { tipo: "RECEBIMENTO", forma: "CARTAO", contraparte };
  if (tipo === "Pix" || tipo === "Transação") return { tipo: "RECEBIMENTO", forma: "PIX", contraparte };
  return { tipo: "OUTRO", forma: null, contraparte };
}

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

export type Regra = { padrao: string; tipo: TipoExterno; categoria: string | null };

/** Regra que vale para esse nome (o padrao mais especifico, isto e, o mais longo, ganha). */
export function regraPara(nome: string | null, regras: Regra[]) {
  if (!nome) return null;
  const n = normal(nome);
  return [...regras].sort((a, b) => b.padrao.length - a.padrao.length).find((r) => n.includes(normal(r.padrao))) ?? null;
}

/** Padrao sugerido para lembrar um destino (sem numeros de CNPJ/CPF do inicio, ex.: "57 074 417 GABRIEL ALVES"). */
export const padraoDoNome = (nome: string) => normal(nome).replace(/^[\d .\-/*]+/, "").trim();
