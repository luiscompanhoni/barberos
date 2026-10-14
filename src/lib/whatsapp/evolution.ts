import { createHmac } from "node:crypto";

/**
 * WhatsApp nao oficial pela Evolution API (roda no mesmo servidor, conecta pelo QR code
 * como o WhatsApp Web). Sem custo por mensagem e sem modelos aprovados, mas sem garantia
 * da Meta: o numero pode ser bloqueado se mandar mensagem em massa.
 */

const instancia = () => process.env.EVOLUTION_INSTANCIA || "barberos";

function config() {
  const url = process.env.EVOLUTION_URL;
  const chave = process.env.EVOLUTION_API_KEY;
  if (!url || !chave) throw new Error("EVOLUTION_URL e EVOLUTION_API_KEY são obrigatórios com WHATSAPP_PROVIDER=evolution.");
  return { url: url.replace(/\/$/, ""), chave };
}

/** Senha que a Evolution manda no webhook (derivada do SESSION_SECRET, nao precisa configurar). */
export function tokenWebhookEvolution() {
  return process.env.EVOLUTION_WEBHOOK_TOKEN || createHmac("sha256", process.env.SESSION_SECRET ?? "").update("evolution-webhook").digest("hex");
}

async function chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<{ status: number; json: T }> {
  const { url, chave } = config();
  const r = await fetch(`${url}${caminho}`, {
    method: metodo,
    headers: { apikey: chave, "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await r.json().catch(() => ({}))) as T;
  return { status: r.status, json };
}

function erroDe(json: unknown) {
  const r = (json as { response?: { message?: unknown } })?.response?.message;
  return Array.isArray(r) ? r.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("; ") : JSON.stringify(json).slice(0, 300);
}

export async function enviarTextoEvolution(para: string, texto: string) {
  const { status, json } = await chamar<{ key?: { id?: string } }>("POST", `/message/sendText/${instancia()}`, {
    number: para.replace(/\D/g, ""),
    text: texto.slice(0, 4096),
  });
  if (status >= 300) throw new Error(`WhatsApp (Evolution) ${status}: ${erroDe(json)}`);
  return { wamid: json.key?.id ?? null };
}

export type EstadoConexao = "conectado" | "conectando" | "desconectado" | "sem_instancia" | "fora_do_ar";

export async function estadoEvolution(): Promise<EstadoConexao> {
  try {
    const { status, json } = await chamar<{ instance?: { state?: string } }>("GET", `/instance/connectionState/${instancia()}`);
    if (status === 404) return "sem_instancia";
    const s = json.instance?.state;
    return s === "open" ? "conectado" : s === "connecting" ? "conectando" : "desconectado";
  } catch {
    return "fora_do_ar";
  }
}

/** Aponta o webhook da instancia para o sistema (rede interna do Docker): mensagens novas e entregue/lida. */
async function configurarWebhook() {
  const url = process.env.EVOLUTION_WEBHOOK_URL || "http://app:3000/api/whatsapp/evolution";
  const { status, json } = await chamar("POST", `/webhook/set/${instancia()}`, {
    webhook: { enabled: true, url, headers: { "x-barberos-token": tokenWebhookEvolution() }, byEvents: false, base64: false, events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE"] },
  });
  if (status >= 300) throw new Error(`Evolution (webhook) ${status}: ${erroDe(json)}`);
}

/** Cria a instancia se preciso e devolve o QR code (imagem base64) para ler no celular. */
export async function conectarEvolution(): Promise<{ estado: EstadoConexao; qr: string | null }> {
  let estado = await estadoEvolution();
  if (estado === "fora_do_ar") throw new Error("O serviço do WhatsApp (Evolution) não está respondendo.");
  if (estado === "sem_instancia") {
    const { status, json } = await chamar("POST", "/instance/create", {
      instanceName: instancia(), integration: "WHATSAPP-BAILEYS", qrcode: true, groupsIgnore: true, rejectCall: false, readMessages: false,
    });
    if (status >= 300) throw new Error(`Evolution (criar) ${status}: ${erroDe(json)}`);
  }
  await configurarWebhook();
  estado = await estadoEvolution();
  if (estado === "conectado") return { estado, qr: null };
  const { json } = await chamar<{ base64?: string }>("GET", `/instance/connect/${instancia()}`);
  return { estado: "conectando", qr: json.base64 ?? null };
}

export async function desconectarEvolution() {
  const { status, json } = await chamar("DELETE", `/instance/logout/${instancia()}`);
  if (status >= 300 && status !== 404) throw new Error(`Evolution (sair) ${status}: ${erroDe(json)}`);
}
