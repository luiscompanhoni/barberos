import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Partes puras do webhook do WhatsApp Cloud API (assinatura e leitura do payload),
 * separadas para teste.
 */

/** Confere o cabecalho X-Hub-Signature-256 ("sha256=<hex>") contra o corpo bruto. */
export function assinaturaValida(corpoBruto: string, cabecalho: string | null, segredo: string): boolean {
  if (!cabecalho?.startsWith("sha256=") || !segredo) return false;
  const esperado = createHmac("sha256", segredo).update(corpoBruto, "utf8").digest();
  const recebido = Buffer.from(cabecalho.slice(7), "hex");
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export type MensagemRecebida = {
  wamid: string;
  waId: string;
  nomePerfil: string | null;
  /** Texto digitado, ou titulo do botao/lista clicado. null = tipo nao suportado (audio, foto...). */
  texto: string | null;
  tipo: string;
  timestamp: number;
};

type Payload = {
  entry?: {
    changes?: {
      value?: {
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        statuses?: { id?: string; status?: string; timestamp?: string; errors?: { title?: string; message?: string }[] }[];
        messages?: {
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
        }[];
      };
    }[];
  }[];
};

/** Extrai as mensagens de clientes de um POST do webhook (ignora status de entrega). */
export function lerMensagens(payload: unknown): MensagemRecebida[] {
  const out: MensagemRecebida[] = [];
  for (const entry of (payload as Payload)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      for (const m of v?.messages ?? []) {
        if (!m.id || !m.from) continue;
        const contato = v?.contacts?.find((c) => c.wa_id === m.from) ?? v?.contacts?.[0];
        const texto =
          m.type === "text" ? (m.text?.body ?? null)
          : m.type === "button" ? (m.button?.text ?? null)
          : m.type === "interactive" ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null)
          : null;
        out.push({
          wamid: m.id,
          waId: m.from,
          nomePerfil: contato?.profile?.name ?? null,
          texto: texto?.trim() || null,
          tipo: m.type ?? "desconhecido",
          timestamp: Number(m.timestamp ?? 0) * 1000,
        });
      }
    }
  }
  return out;
}

/**
 * Numero canonico (com o 9) a partir do wa_id. Celulares brasileiros antigos
 * chegam do WhatsApp com 12 digitos (55 + DDD + 8); o cadastro usa 13.
 */
export function telefoneCanonico(waId: string): string {
  const d = waId.replace(/\D/g, "");
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return `${d.slice(0, 4)}9${d.slice(4)}`;
  return d;
}

type ConteudoEvolution = {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  buttonsResponseMessage?: { selectedDisplayText?: string };
  listResponseMessage?: { title?: string };
  templateButtonReplyMessage?: { selectedDisplayText?: string };
};
type DadoEvolution = {
  key?: { id?: string; remoteJid?: string; remoteJidAlt?: string; senderPn?: string; fromMe?: boolean };
  pushName?: string;
  message?: ConteudoEvolution;
  messageType?: string;
  messageTimestamp?: number | string;
};

/**
 * Mensagens de clientes num POST da Evolution API (evento messages.upsert).
 * Ignora as enviadas pelo proprio numero, grupos, status e canais.
 */
export function lerMensagensEvolution(payload: unknown): MensagemRecebida[] {
  const p = payload as { event?: string; data?: DadoEvolution | DadoEvolution[] };
  if (!p?.event || p.event.toLowerCase().replace("_", ".") !== "messages.upsert") return [];
  const out: MensagemRecebida[] = [];
  for (const d of Array.isArray(p.data) ? p.data : p.data ? [p.data] : []) {
    const k = d.key;
    if (!k?.id || k.fromMe) continue;
    // Contas novas chegam com "@lid" (id interno); o numero vem em remoteJidAlt/senderPn.
    let jid = k.remoteJid ?? "";
    if (jid.endsWith("@lid")) jid = k.remoteJidAlt ?? k.senderPn ?? "";
    if (!jid.endsWith("@s.whatsapp.net")) continue;
    const m = d.message ?? {};
    const texto =
      m.conversation ?? m.extendedTextMessage?.text ?? m.buttonsResponseMessage?.selectedDisplayText ??
      m.listResponseMessage?.title ?? m.templateButtonReplyMessage?.selectedDisplayText ?? null;
    out.push({
      wamid: k.id,
      waId: jid.split("@")[0].split(":")[0],
      nomePerfil: d.pushName?.trim() || null,
      texto: texto?.trim() || null,
      tipo: d.messageType ?? "desconhecido",
      timestamp: Number(d.messageTimestamp ?? 0) * 1000,
    });
  }
  return out;
}

/** Confirmacao do WhatsApp sobre uma mensagem que a barbearia mandou. */
export type StatusMensagem = { wamid: string; status: "ENTREGUE" | "LIDA" | "FALHOU"; quando: number | null; erro: string | null };

const STATUS_CLOUD: Record<string, StatusMensagem["status"]> = { delivered: "ENTREGUE", read: "LIDA", failed: "FALHOU" };

/** Entrega/leitura/falha num POST da Cloud API (value.statuses). "sent" nao muda nada. */
export function lerStatus(payload: unknown): StatusMensagem[] {
  const out: StatusMensagem[] = [];
  for (const entry of (payload as Payload)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const st of change.value?.statuses ?? []) {
        const status = STATUS_CLOUD[st.status ?? ""];
        if (!st.id || !status) continue;
        const e = st.errors?.[0];
        out.push({ wamid: st.id, status, quando: st.timestamp ? Number(st.timestamp) * 1000 : null, erro: e ? (e.message || e.title || "Falha no envio").slice(0, 300) : null });
      }
    }
  }
  return out;
}

// Evolution: v2 manda o texto ("DELIVERY_ACK"); a v1 manda o numero (3 entregue, 4 lida, 5 ouvida, 0 erro).
const STATUS_EVOLUTION: Record<string, StatusMensagem["status"]> = {
  DELIVERY_ACK: "ENTREGUE", READ: "LIDA", PLAYED: "LIDA", ERROR: "FALHOU", "3": "ENTREGUE", "4": "LIDA", "5": "LIDA", "0": "FALHOU",
};
type AtualizacaoEvolution = { keyId?: string; messageId?: string; fromMe?: boolean; status?: string | number; key?: { id?: string; fromMe?: boolean }; update?: { status?: string | number } };

/** Entrega/leitura num POST da Evolution (evento messages.update), so das mensagens que sairam do proprio numero. */
export function lerStatusEvolution(payload: unknown): StatusMensagem[] {
  const p = payload as { event?: string; data?: AtualizacaoEvolution | AtualizacaoEvolution[] };
  if (!p?.event || p.event.toLowerCase().replace("_", ".") !== "messages.update") return [];
  const out: StatusMensagem[] = [];
  for (const d of Array.isArray(p.data) ? p.data : p.data ? [p.data] : []) {
    const wamid = d.keyId ?? d.key?.id ?? d.messageId;
    const status = STATUS_EVOLUTION[String(d.status ?? d.update?.status ?? "")];
    if (!wamid || !status || (d.fromMe ?? d.key?.fromMe) === false) continue;
    out.push({ wamid, status, quando: null, erro: status === "FALHOU" ? "O WhatsApp não entregou a mensagem." : null });
  }
  return out;
}
