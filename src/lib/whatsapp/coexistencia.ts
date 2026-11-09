import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import { obterConversa } from "./conversas";
import { telefoneCanonico } from "./webhook";

/**
 * Webhooks extras da coexistencia (numero no app WhatsApp Business e na API ao mesmo tempo):
 * - smb_message_echoes: o que a equipe mandou pelo celular;
 * - history: conversas antigas (uma vez, logo depois de conectar);
 * - account_update: o numero saiu da API.
 */

type Msg = { id?: string; from?: string; to?: string; timestamp?: string; type?: string; text?: { body?: string }; image?: { caption?: string } };
type Valor = {
  metadata?: { display_phone_number?: string };
  message_echoes?: Msg[];
  history?: { threads?: { id?: string; messages?: Msg[] }[] }[];
  event?: string;
  waba_info?: { waba_id?: string };
  disconnection_info?: { reason?: string };
};
type Payload = { entry?: { id?: string; changes?: { field?: string; value?: Valor }[] }[] };

/** Mensagem que ja aconteceu e so precisa aparecer na conversa. */
export type MensagemEspelhada = { wamid: string; waId: string; texto: string; quando: Date; daEmpresa: boolean };

const ROTULO: Record<string, string> = { image: "foto", audio: "áudio", video: "vídeo", document: "documento", sticker: "figurinha", media_placeholder: "mídia" };

function texto(m: Msg) {
  if (m.type === "text") return m.text?.body?.trim() || null;
  if (m.type === "image" && m.image?.caption?.trim()) return m.image.caption.trim();
  return `[${ROTULO[m.type ?? ""] ?? "mensagem"}]`;
}

const quando = (ts?: string) => new Date(ts && Number(ts) > 0 ? Number(ts) * 1000 : Date.now());

function* mudancas(payload: unknown, campo: string) {
  for (const entry of (payload as Payload)?.entry ?? []) {
    for (const c of entry.changes ?? []) if (c.field === campo && c.value) yield { entryId: entry.id, v: c.value };
  }
}

/** Mensagens que a equipe enviou pelo app WhatsApp Business do celular. */
export function lerEcos(payload: unknown): MensagemEspelhada[] {
  const out: MensagemEspelhada[] = [];
  for (const { v } of mudancas(payload, "smb_message_echoes")) {
    for (const m of v.message_echoes ?? []) {
      const t = texto(m);
      if (m.id && m.to && t) out.push({ wamid: m.id, waId: m.to, texto: t, quando: quando(m.timestamp), daEmpresa: true });
    }
  }
  return out;
}

/** Historico de conversas 1:1 do app (o id da conversa e o numero do cliente). */
export function lerHistorico(payload: unknown): MensagemEspelhada[] {
  const out: MensagemEspelhada[] = [];
  for (const { v } of mudancas(payload, "history")) {
    const empresa = v.metadata?.display_phone_number?.replace(/\D/g, "");
    for (const h of v.history ?? []) {
      for (const th of h.threads ?? []) {
        for (const m of th.messages ?? []) {
          const t = texto(m);
          if (th.id && m.id && t) out.push({ wamid: m.id, waId: th.id, texto: t, quando: quando(m.timestamp), daEmpresa: !!empresa && m.from === empresa });
        }
      }
    }
  }
  return out;
}

/** Avisos de que o numero saiu da API (desconectado no app, trocou de aparelho...). */
export function lerDesconexoes(payload: unknown): { wabaId: string; motivo: string }[] {
  const out: { wabaId: string; motivo: string }[] = [];
  for (const { entryId, v } of mudancas(payload, "account_update")) {
    if (v.event !== "PARTNER_REMOVED" && v.event !== "ACCOUNT_OFFBOARDED") continue;
    const wabaId = v.waba_info?.waba_id ?? entryId;
    if (wabaId) out.push({ wabaId, motivo: v.disconnection_info?.reason ?? v.event });
  }
  return out;
}

/**
 * Grava as mensagens sem acionar o bot (wamid repetido e ignorado). Eco do celular passa a
 * conversa para a equipe: alguem ja esta respondendo por la.
 */
export async function espelhar(mensagens: MensagemEspelhada[], opts: { equipeAssume: boolean }) {
  const porTelefone = new Map<string, MensagemEspelhada[]>();
  for (const m of mensagens) {
    const tel = telefoneCanonico(m.waId);
    porTelefone.set(tel, [...(porTelefone.get(tel) ?? []), m]);
  }
  for (const [telefone, lista] of porTelefone) {
    const conversa = await obterConversa(telefone, { waId: lista[0].waId });
    await db.mensagem.createMany({
      data: lista.map((m) => ({ conversaId: conversa.id, autor: m.daEmpresa ? "EQUIPE" : "CLIENTE", texto: m.texto, wamid: m.wamid, criadoEm: m.quando })),
      skipDuplicates: true,
    });
    if (opts.equipeAssume && conversa.estado !== "HUMANO") await db.conversa.update({ where: { id: conversa.id }, data: { estado: "HUMANO" } });
    publicar({ tipo: "conversa", conversaId: conversa.id });
  }
}
