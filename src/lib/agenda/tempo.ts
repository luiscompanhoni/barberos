import { TZDate } from "@date-fns/tz";

/** Fuso padrao da barbearia. Todos os horarios de expediente sao "hora local" neste fuso. */
export const FUSO_PADRAO = process.env.TZ_BARBEARIA ?? "America/Sao_Paulo";

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Valida e decompoe "YYYY-MM-DD". */
export function parseData(data: string): { ano: number; mes: number; dia: number } {
  const m = RE_DATA.exec(data);
  if (!m) throw new Error(`Data inválida: ${data}`);
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const teste = new Date(Date.UTC(ano, mes - 1, dia));
  if (teste.getUTCMonth() !== mes - 1 || teste.getUTCDate() !== dia) {
    throw new Error(`Data inválida: ${data}`);
  }
  return { ano, mes, dia };
}

/** Instante (ms UTC) correspondente a `data` + `minutos` desde 00:00 no fuso. */
export function instanteLocal(data: string, minutos: number, fuso = FUSO_PADRAO): number {
  const { ano, mes, dia } = parseData(data);
  return new TZDate(ano, mes - 1, dia, 0, minutos, fuso).getTime();
}

/** Dia da semana (0 = domingo) de uma data "YYYY-MM-DD". Independe do fuso. */
export function diaSemana(data: string): number {
  const { ano, mes, dia } = parseData(data);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/** "YYYY-MM-DD" do instante no fuso da barbearia. */
export function dataLocal(instante: Date | number, fuso = FUSO_PADRAO): string {
  const d = new TZDate(+instante, fuso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Minutos desde 00:00 do instante no fuso da barbearia. */
export function minutosLocal(instante: Date | number, fuso = FUSO_PADRAO): number {
  const d = new TZDate(+instante, fuso);
  return d.getHours() * 60 + d.getMinutes();
}

/** Soma dias a uma data "YYYY-MM-DD". */
export function somarDias(data: string, dias: number): string {
  const { ano, mes, dia } = parseData(data);
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return d.toISOString().slice(0, 10);
}

/** Data "YYYY-MM-DD" como Date UTC 00:00 (formato das colunas @db.Date). */
export function dataParaColuna(data: string): Date {
  const { ano, mes, dia } = parseData(data);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

export function colunaParaData(valor: Date): string {
  return valor.toISOString().slice(0, 10);
}

/** "09:30" -> 570 */
export function hhmmParaMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Horário inválido: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new Error(`Horário inválido: ${hhmm}`);
  return h * 60 + min;
}

/** 570 -> "09:30" */
export function minParaHhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
