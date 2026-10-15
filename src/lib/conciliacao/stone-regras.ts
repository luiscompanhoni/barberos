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
  const [cab, ...corpo] = L;
  if (!cab?.includes("Movimentação") || !cab.includes("Saldo depois")) throw new Error("Esse arquivo não parece o extrato CSV da Stone.");
  return corpo.filter((l) => l.length >= cab.length - 1 && l.some(Boolean)).map((l) => Object.fromEntries(cab.map((k, i) => [k, l[i] ?? ""])));
}

/** "R$ 1.234,56" / "-650,00" / "Grátis" -> centavos (com sinal). */
export function centavosStone(s: string) {
  const t = (s ?? "").replace(/R\$\s?/, "").replace(/\s/g, "");
  if (!t || /gr[aá]tis/i.test(t)) return 0;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** "14/10/2026 20:36" + "20:36:32.567" -> instante (horario de Brasilia). */
export function instanteStone(o: LinhaStone) {
  const [d, m, a] = (o["Data"] ?? "").split(" ")[0].split("/");
  const hora = o["Horário"] || (o["Data"] ?? "").split(" ")[1] || "00:00";
  return new Date(`${a}-${m}-${d}T${hora.length === 5 ? `${hora}:00` : hora}-03:00`);
}

/** Id estavel da linha (o mesmo arquivo baixado de novo nao duplica). */
export const idStone = (o: LinhaStone) =>
  createHash("sha1").update([o["Data"], o["Horário"], o["Valor"], o["Saldo antes"], o["Saldo depois"], o["Tipo"]].join("|")).digest("hex").slice(0, 24);

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
