import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const normalizar = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const horario = /\b([01]?\d|2[0-3])(?::([0-5]\d)|\s*h(?:([0-5]\d)|oras)?)\b/g;
const horaCheia = /\bas\s+([01]?\d|2[0-3])(?=\s*(?:$|[.,!?*]|com\b|no\b|na\b|pro?\b|para\b))/g;
const pediuReserva = /\b(?:marca(?:r)?|marque|agenda(?:r)?|agende|reserva(?:r)?|reserve|fico com|vou de)\b/;
const duvida = /\b(?:queria saber|quero saber|como|tem como|sera que tem)\b/;
type Periodo = "MANHA" | "TARDE" | "NOITE";

export function duasVagas<T extends { minuto: number }>(vagas: T[], periodo?: Periodo, preferido?: number) {
  const filtradas = vagas.filter(v => !periodo || periodo === (v.minuto < 720 ? "MANHA" : v.minuto < 1080 ? "TARDE" : "NOITE"));
  filtradas.sort((a, b) => preferido === undefined ? a.minuto - b.minuto : Math.abs(a.minuto - preferido) - Math.abs(b.minuto - preferido));
  const vistas = new Set<number>();
  return filtradas.filter(v => {
    if (vistas.has(v.minuto)) return false;
    vistas.add(v.minuto);
    return true;
  }).slice(0, 2);
}

function horariosDe(texto: string) {
  const normalizado = normalizar(texto);
  const horarios = [...normalizado.matchAll(horario), ...normalizado.matchAll(horaCheia)]
    .sort((a, b) => a.index - b.index);
  return [...new Set(horarios.map(m => Number(m[1]) * 60 + Number(m[2] ?? m[3] ?? 0)))];
}

export function confirmouHorario(texto: string | null, proposta: string, hora: unknown) {
  if (!texto || typeof hora !== "string" || !/^\d{1,2}:[0-5]\d$/.test(hora)) return false;
  const [h, m] = hora.split(":").map(Number);
  const alvo = h * 60 + m;
  const pedido = normalizar(texto)
    .replace(/^(?:(?:opa|po|beleza|mano|irmao)(?:[,!]\s*|\s+))+/, "")
    .replace(/(?:,\s*|\s+)(?:mano|irmao|irma|cara|amigo|amiga)([.!]?)$/, "$1");
  if (/\b(?:nao|talvez|vou ver|vou pensar|ainda nao|cancela|desmarca|remarca)\b/.test(pedido)) return false;
  const opcoes = horariosDe(proposta);
  const direto = pediuReserva.test(pedido) && !duvida.test(pedido);
  if (pedido.includes("?") && !direto) return false;
  const informado = horariosDe(texto);
  if (informado.length) return informado.length === 1 && informado[0] === alvo && (direto || opcoes.includes(alvo));
  const ordem = pedido.match(/^(?:(?:pode (?:marcar|agendar)(?: na| a)?|quero|fico com|vou de|opcao|o|a)\s+)*(1|2|primeir[oa]|segund[oa])(?:[ªº]|\s+opcao|\s+horario)?[.!?]?$/);
  if (ordem && opcoes.length === 2) return opcoes[/^(?:1|primeir)/.test(ordem[1]) ? 0 : 1] === alvo;
  return /^(?:sim|fechou|pode(?: marcar| agendar)?|isso|confirmo)(?:,? sim)?[.!]?$/.test(pedido) && opcoes.length === 1 && opcoes[0] === alvo;
}

function respeitaDiaEscrito(texto: string, data: string) {
  const pedido = normalizar(texto);
  if (!pediuReserva.test(pedido) || !horariosDe(texto).length) return true;
  const semana = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  const dia = new Date(data + "T12:00:00Z").getUTCDay();
  const semOrdemDaOpcao = pedido.replace(/\b(?:a segunda(?!-feira)|segunda (?:opcao|alternativa|vaga))\b/g, "");
  const expresso = semOrdemDaOpcao.match(/\b(?:domingo|segunda|terca|quarta|quinta|sexta|sabado)\b/g) ?? [];
  return expresso.every(d => d === semana[dia]) && [...pedido.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)]
    .every(([, d, m, a]) => Number(d) === Number(data.slice(8, 10)) && Number(m) === Number(data.slice(5, 7)) &&
      (!a || a === data.slice(0, 4)));
}

const consultaSchema = z.object({ data: z.string(), servico_id: z.string(), servicos_adicionais: z.array(z.string()).default([]) });
const reservaSchema = consultaSchema.extend({ horario: z.string(), barbeiro_id: z.string() });
const resultadoSchema = z.object({ data: z.string(), opcoes: z.array(z.object({ horario: z.string(), barbeiro_id: z.string() })) });

/** Restringe a escolha ao resultado da agenda que precedeu a proposta entregue ao cliente. */
export function confirmouReserva(texto: string | null, historico: Anthropic.Beta.BetaMessageParam[], entrada: unknown) {
  const reserva = reservaSchema.safeParse(entrada);
  if (!reserva.success) return false;
  const alvo = reserva.data;
  if (texto && !respeitaDiaEscrito(texto, alvo.data)) return false;
  const mensagemDoBot = (m: Anthropic.Beta.BetaMessageParam) => m.role === "assistant" && typeof m.content === "string";
  const consultaDaAgenda = (m: Anthropic.Beta.BetaMessageParam) => m.role === "assistant" && Array.isArray(m.content) &&
    m.content.some(b => b.type === "tool_use" && b.name === "consultar_horarios");
  const falaDoCliente = (m: Anthropic.Beta.BetaMessageParam) => m.role === "user" &&
    (typeof m.content === "string" || m.content.some(b => b.type !== "tool_result"));

  let fim = historico.findLastIndex(mensagemDoBot);
  const ultima = historico[fim]?.content;
  if (texto && typeof ultima === "string" && horariosDe(texto).length === 1 && pediuReserva.test(normalizar(texto)) &&
      /^(?:k{2,}|(?:rs){2,})\b/.test(normalizar(ultima)) && !/[?]|\b(?:nao|cancel\w*|remarc\w*|mud\w*)\b/.test(normalizar(ultima))) {
    const anterior = historico.slice(0, fim);
    const oferta = anterior.findLastIndex(mensagemDoBot);
    if (oferta >= 0 && !anterior.slice(oferta + 1).some(consultaDaAgenda)) fim = oferta;
  }
  const proposta = historico[fim]?.content;
  if (typeof proposta !== "string" || !confirmouHorario(texto, proposta, alvo.horario)) return false;

  const anterior = historico.slice(0, fim);
  const inicio = anterior.findLastIndex(falaDoCliente);
  let turno = anterior.slice(inicio + 1);
  if (!turno.some(consultaDaAgenda) && horariosDe(proposta).length === 1 &&
      /\bposso (?:marcar|agendar|reservar)\s*\?/.test(normalizar(proposta))) {
    // Uma reapresentação do horário pode não precisar chamar a agenda outra vez.
    const ultimaOferta = anterior.findLastIndex(mensagemDoBot);
    const textoOferta = anterior[ultimaOferta]?.content;
    if (typeof textoOferta === "string" && confirmouHorario(alvo.horario, textoOferta, alvo.horario)) {
      const antesDaOferta = anterior.slice(0, ultimaOferta);
      turno = antesDaOferta.slice(antesDaOferta.findLastIndex(falaDoCliente) + 1);
    }
  }
  const consultas = new Map<string, z.infer<typeof consultaSchema>>();
  const candidatos = new Set<string>();
  const chave = (d: z.infer<typeof reservaSchema>) =>
    JSON.stringify([d.data, d.barbeiro_id, d.servico_id, [...d.servicos_adicionais].sort()]);
  for (const m of turno) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (m.role === "assistant" && b.type === "tool_use" && b.name === "consultar_horarios") {
        const consulta = consultaSchema.safeParse(b.input);
        if (consulta.success) consultas.set(b.id, consulta.data);
      }
      if (m.role !== "user" || b.type !== "tool_result" || b.is_error || typeof b.content !== "string") continue;
      const consulta = consultas.get(b.tool_use_id);
      if (!consulta) continue;
      let resultado: unknown;
      try { resultado = JSON.parse(b.content); } catch { continue; }
      const verificado = resultadoSchema.safeParse(resultado);
      if (!verificado.success || verificado.data.data !== consulta.data) continue;
      for (const opcao of verificado.data.opcoes) {
        if (horariosDe(opcao.horario)[0] === horariosDe(alvo.horario)[0]) candidatos.add(chave({ ...consulta, ...opcao }));
      }
    }
  }
  return candidatos.size === 1 && candidatos.has(chave(alvo));
}
