import { z } from "zod";
import { dataLocal, diaSemana, instanteLocal, somarDias } from "@/lib/agenda/tempo";
export const FUSO_ENTREVISTA = "America/Sao_Paulo";
export const zConviteEntrevista = z.object({ chave: z.uuid(), versao: z.number().int().min(0), duracaoMin: z.number().int().min(1).max(45).default(45), local: z.string().trim().min(5).max(500) }).strict();
export const zAcaoEntrevista = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("CONSULTAR") }).strict(),
  z.object({ acao: z.literal("ESCOLHER"), inicio: z.iso.datetime(), versao: z.number().int().min(0) }).strict(),
  z.object({ acao: z.literal("CONFIRMAR"), versao: z.number().int().min(0) }).strict(),
  z.object({ acao: z.literal("CANCELAR"), versao: z.number().int().min(0) }).strict(),
]);
export type AcaoEntrevista = z.infer<typeof zAcaoEntrevista>;
/** Grade de 15 minutos; todos os intervalos cabem integralmente na janela do dono. */
export function janelasEntrevista(duracaoMin: number, agora: number) {
  if (!Number.isInteger(duracaoMin) || duracaoMin < 1 || duracaoMin > 45) throw Error("Duração inválida.");
  const hoje = dataLocal(agora, FUSO_ENTREVISTA); const janelas: { inicio: Date; fim: Date }[] = [];
  for (let d = 0; d < 28; d++) {
    const data = somarDias(hoje, d); if (diaSemana(data) !== 1) continue;
    for (let minuto = 840; minuto + duracaoMin <= 960; minuto += 15) {
      const inicio = instanteLocal(data, minuto, FUSO_ENTREVISTA);
      if (inicio > agora) janelas.push({ inicio: new Date(inicio), fim: new Date(inicio + duracaoMin * 60_000) });
    }
  }
  return janelas;
}
export function sobrepoe(a: { inicio: Date; fim: Date }, b: { inicio: Date; fim: Date }) { return +a.inicio < +b.fim && +b.inicio < +a.fim; }
export function rotuloEntrevista(inicio: Date | string, duracao: number) {
  const i = new Date(inicio); const f = new Date(+i + duracao * 60_000);
  const dia = i.toLocaleDateString("pt-BR", { timeZone: FUSO_ENTREVISTA, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = (v: Date) => v.toLocaleTimeString("pt-BR", { timeZone: FUSO_ENTREVISTA, hour: "2-digit", minute: "2-digit" });
  return `${dia}, ${hora(i)}–${hora(f)} (horário de São Paulo)`;
}
