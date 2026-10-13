/**
 * Regras puras das mensagens automaticas: quando cada uma sai e o texto.
 */
import { dataLocal, minParaHhmm, minutosLocal, somarDias } from "@/lib/agenda/tempo";

const MIN = 60_000;
const HORA = 60 * MIN;

export type CfgLembrete = { lembreteHorasAntes: number; lembreteMinutosAntes: number };
export type AgLembrete = { inicio: number; criadoEm: number; status: string };

/**
 * Qual lembrete e devido agora (ou null):
 * - vespera: faltam ate X horas, o horario foi marcado antes disso (nao lembra quem acabou de marcar)
 *   e ainda nao esta confirmado;
 * - proximo: faltam ate X minutos (e pelo menos 15), marcado ha mais de 30 min.
 */
export function lembreteDevido(ag: AgLembrete, agora: number, cfg: CfgLembrete): "LEMBRETE_VESPERA" | "LEMBRETE_PROXIMO" | null {
  if (ag.status !== "MARCADO" && ag.status !== "CONFIRMADO") return null;
  const falta = ag.inicio - agora;
  if (falta <= 0) return null;
  const proximoMs = cfg.lembreteMinutosAntes * MIN;
  if (cfg.lembreteMinutosAntes > 0 && falta <= proximoMs) {
    return falta >= 15 * MIN && agora - ag.criadoEm >= 30 * MIN ? "LEMBRETE_PROXIMO" : null;
  }
  if (cfg.lembreteHorasAntes > 0 && ag.status === "MARCADO") {
    const vesperaMs = cfg.lembreteHorasAntes * HORA;
    const antesDoProximo = falta > proximoMs + HORA;
    const marcadoAntes = ag.criadoEm <= ag.inicio - vesperaMs && agora - ag.criadoEm >= 2 * HORA;
    if (falta <= vesperaMs && antesDoProximo && marcadoAntes) return "LEMBRETE_VESPERA";
  }
  return null;
}

/** Mensagens que nao sao de ultima hora so saem entre 8h e 21h. */
export function horarioComercial(agora: number, fuso: string) {
  const h = Math.floor(minutosLocal(agora, fuso) / 60);
  return h >= 8 && h < 21;
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "hoje às 14:30" / "amanhã (quarta, 01/10) às 14:30" / "sexta, 03/10 às 9:00" */
export function quandoFalar(inicio: number, agora: number, fuso: string) {
  const d = dataLocal(inicio, fuso);
  const hoje = dataLocal(agora, fuso);
  const hora = minParaHhmm(minutosLocal(inicio, fuso));
  const [, m, dia] = d.split("-");
  const semana = DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()];
  if (d === hoje) return `hoje às ${hora}`;
  if (d === somarDias(hoje, 1)) return `amanhã (${semana}, ${dia}/${m}) às ${hora}`;
  return `${semana}, ${dia}/${m} às ${hora}`;
}

const primeiro = (nome: string) => nome.trim().split(/\s+/)[0] || "tudo bem";

export const TEXTOS = {
  LEMBRETE_VESPERA: (p: { nome: string; quando: string; servico: string; barbeiro: string; barbearia: string }) =>
    `Oi, ${primeiro(p.nome)}! Passando para lembrar: ${p.quando} você tem ${p.servico} com ${p.barbeiro} na ${p.barbearia}. ` +
    `Posso confirmar? Responda *SIM* para confirmar ou me diga se precisa remarcar.`,
  LEMBRETE_PROXIMO: (p: { nome: string; hora: string; servico: string; barbeiro: string; endereco: string | null }) =>
    `Oi, ${primeiro(p.nome)}! Daqui a pouco, às ${p.hora}, é o seu ${p.servico} com ${p.barbeiro}.` +
    `${p.endereco ? ` Endereço: ${p.endereco}.` : ""} Até já! 💈`,
  POS_FALTA: (p: { nome: string; hora: string }) =>
    `Oi, ${primeiro(p.nome)}! Sentimos sua falta no horário das ${p.hora}. Aconteceu alguma coisa? Se quiser, já vejo um novo horário para você.`,
  POS_ATENDIMENTO: (p: { nome: string; link: string | null }) =>
    `Valeu pela visita, ${primeiro(p.nome)}! ` +
    `${p.link ? `Se curtiu, deixa sua avaliação aqui, ajuda muito a gente: ${p.link} ` : ""}Quando quiser marcar o próximo, é só chamar aqui. 💈`,
  ANIVERSARIO: (p: { nome: string; barbearia: string; presente: string | null }) =>
    `Feliz aniversário, ${primeiro(p.nome)}! 🎉 Toda a equipe da ${p.barbearia} te deseja um dia incrível.` +
    `${p.presente ? ` Seu presente: ${p.presente} na sua próxima visita este mês, é só avisar na recepção.` : ""}`,
  REATIVACAO: (p: { nome: string; dias: number; barbearia: string }) =>
    `Oi, ${primeiro(p.nome)}! Faz ${p.dias} dias que você não passa aqui na ${p.barbearia}. Bora dar aquele trato no visual? ` +
    `Posso ver um horário para você esta semana. (Se não quiser mais receber mensagens, responda PARAR.)`,
};

/** Aniversario hoje? Quem nasceu em 29/02 comemora em 28/02 nos anos que nao sao bissextos. */
export function fazAniversario(nascimento: string, hoje: string) {
  const [, m, d] = nascimento.split("-");
  const [ano, mh, dh] = hoje.split("-");
  if (m === mh && d === dh) return true;
  const bissexto = (Number(ano) % 4 === 0 && Number(ano) % 100 !== 0) || Number(ano) % 400 === 0;
  return m === "02" && d === "29" && !bissexto && mh === "02" && dh === "28";
}

/** Texto do cliente pedindo para parar as mensagens automaticas. */
export function pediuParar(texto: string) {
  return /^\s*(parar|pare|sair|stop|cancelar mensagens|não quero( mais)? (receber )?mensagens?)\s*[.!]*\s*$/i.test(texto);
}
