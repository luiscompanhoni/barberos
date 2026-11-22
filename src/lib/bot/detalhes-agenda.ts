import { parseData } from "@/lib/agenda/tempo";
import { avisoAoReservar } from "@/lib/automacoes/regras";
import { temJanela24h } from "@/lib/whatsapp/canal";
import { recursoPiloto } from "@/lib/whatsapp/piloto-regras";

export function descreverData(data: string) {
  const { ano, mes, dia } = parseData(data);
  const semana = new Date(Date.UTC(ano, mes - 1, dia)).toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
  return `${semana} ${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

export function descreverLembrete(ag: { inicio: Date; criadoEm: Date; status: string }, minutos: number, aceitaMensagens: boolean, jornada = false) {
  const podeAvisar = aceitaMensagens && process.env.WHATSAPP_ENVIOS_BLOQUEADOS !== "true" && (!recursoPiloto() || jornada) && !temJanela24h();
  return avisoAoReservar({ inicio: +ag.inicio, criadoEm: +ag.criadoEm, status: ag.status }, Date.now(), jornada ? 90 : minutos, podeAvisar);
}
