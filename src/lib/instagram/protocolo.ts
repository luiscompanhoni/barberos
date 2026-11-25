import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { instanteDaEntradaCloud } from "@/lib/whatsapp/horario-entrada";

export const zIdInstagram = z.string().regex(/^\d{1,32}$/);
export const zMidInstagram = z.string().regex(/^[\w+.=:\/-]{1,512}$/);
const zEnvelope = z.object({ object: z.literal("instagram"), entry: z.array(z.unknown()) });
const zPerfil = z.object({ id: zIdInstagram, messaging: z.array(z.unknown()) });
const zEvento = z.object({
  sender: z.object({ id: zIdInstagram }),
  recipient: z.object({ id: zIdInstagram }),
  timestamp: z.number().int(),
  is_echo: z.boolean().optional(),
  is_self: z.boolean().optional(),
  message: z.object({
    mid: zMidInstagram,
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
    is_self: z.boolean().optional(),
    is_deleted: z.boolean().optional(),
  }),
});

export type EntradaInstagram = { igsid: string; mid: string; timestamp: number; texto: string | null };

export function desafioInstagram(url: URL, token?: string) {
  const p = url.searchParams;
  const unico = (chave: string) => p.getAll(chave).length === 1 ? p.get(chave) : null;
  const recebido = unico("hub.verify_token");
  const desafio = unico("hub.challenge");
  if (!token || !recebido || !desafio || !/^\d{1,32}$/.test(desafio) || unico("hub.mode") !== "subscribe") return null;
  const hash = (entrada: string) => createHash("sha256").update(entrada).digest();
  return timingSafeEqual(hash(token), hash(recebido)) ? desafio : null;
}

export function assinaturaInstagramValida(bytes: Uint8Array, assinatura: string | null, segredo?: string) {
  if (!segredo || !assinatura || !/^sha256=[0-9a-f]{64}$/i.test(assinatura)) return false;
  return timingSafeEqual(Buffer.from(assinatura.slice(7), "hex"), createHmac("sha256", segredo).update(bytes).digest());
}

export function lerEntradasInstagram(payload: unknown, perfil: string, agora = Date.now()): EntradaInstagram[] {
  const entradas: EntradaInstagram[] = [];
  for (const valor of Array.isArray(payload) ? payload : [payload]) {
    const envelope = zEnvelope.safeParse(valor);
    if (!envelope.success) continue;
    for (const item of envelope.data.entry) {
      const registro = zPerfil.safeParse(item);
      if (!registro.success || registro.data.id !== perfil) continue;
      for (const raw of registro.data.messaging) {
        const evento = zEvento.safeParse(raw);
        if (!evento.success) continue;
        const { sender, recipient, timestamp, message, is_echo, is_self } = evento.data;
        if (recipient.id !== perfil || sender.id === perfil || is_echo || is_self || message.is_echo || message.is_self || message.is_deleted || !instanteDaEntradaCloud(timestamp, agora)) continue;
        entradas.push({ igsid: sender.id, mid: message.mid, timestamp, texto: message.text?.trim().slice(0, 4_000) || null });
      }
    }
  }
  return entradas;
}

export type RemocaoInstagram = { igsid: string; mid: string; timestamp: number };

/** Eventos de mensagem desfeita pelo remetente. Não usa a janela de entrada: a remoção vale para mensagem já gravada. */
export function lerRemocoesInstagram(payload: unknown, perfil: string, agora = Date.now()): RemocaoInstagram[] {
  const remocoes: RemocaoInstagram[] = [];
  for (const valor of Array.isArray(payload) ? payload : [payload]) {
    const envelope = zEnvelope.safeParse(valor);
    if (!envelope.success) continue;
    for (const item of envelope.data.entry) {
      const registro = zPerfil.safeParse(item);
      if (!registro.success || registro.data.id !== perfil) continue;
      for (const raw of registro.data.messaging) {
        const evento = zEvento.safeParse(raw);
        if (!evento.success) continue;
        const { sender, recipient, timestamp, message, is_echo, is_self } = evento.data;
        if (recipient.id !== perfil || sender.id === perfil || is_echo || is_self || message.is_echo || message.is_self || !message.is_deleted) continue;
        if (timestamp - agora > 15 * 60_000) continue;
        remocoes.push({ igsid: sender.id, mid: message.mid, timestamp });
      }
    }
  }
  return remocoes;
}
