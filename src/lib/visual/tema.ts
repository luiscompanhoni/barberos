export type Tema = "claro" | "escuro" | "espacial" | "automatico";
export const TEMAS: Tema[] = ["claro", "escuro", "espacial", "automatico"];
export function temaValido(valor: string | null): valor is Tema {
  return TEMAS.includes(valor as Tema);
}
/** Horários da unidade em São Paulo: madrugada 00–06, dia 06–18, noite 18–24. */
export function resolverTema(tema: Tema, agora = new Date()): Exclude<Tema, "automatico"> {
  if (tema !== "automatico") return tema;
  const hora = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(agora));
  return hora < 6 ? "espacial" : hora < 18 ? "claro" : "escuro";
}
