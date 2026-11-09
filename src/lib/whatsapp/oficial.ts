import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";

/**
 * Conexao com a API oficial pelo cadastro incorporado da Meta (coexistencia: o numero
 * continua no app WhatsApp Business do celular). Toda chamada aqui e servidor -> Meta.
 */

const graph = (caminho: string) => `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION ?? "v23.0"}/${caminho}`;

function chave() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET ausente ou curto (mínimo 32 caracteres).");
  return createHash("sha256").update(`${s}:whatsapp-oficial`).digest();
}

export function cifrarToken(token: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const dados = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), dados].map((b) => b.toString("base64url")).join(".");
}

export function decifrarToken(cifrado: string) {
  const [iv, tag, dados] = cifrado.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", chave(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(dados), d.final()]).toString("utf8");
}

/** Token e numero da API oficial: o .env tem prioridade; senao, o conectado pelo painel. */
export async function credenciaisOficial(): Promise<{ token: string; phoneId: string } | null> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (token && phoneId) return { token, phoneId };
  const c = await db.whatsAppOficial.findUnique({ where: { id: 1 } });
  if (!c || c.desconectadoEm) return null;
  return { token: decifrarToken(c.tokenCifrado), phoneId: c.phoneNumberId };
}

async function meta<T>(url: string, opts: { token?: string; corpo?: Record<string, unknown> } = {}): Promise<T> {
  const r = await fetch(url, {
    method: opts.corpo ? "POST" : "GET",
    headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.corpo ? { "Content-Type": "application/json" } : {}) },
    body: opts.corpo ? JSON.stringify(opts.corpo) : undefined,
  });
  const json = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) throw new Error(`Meta ${r.status}: ${json.error?.message ?? "erro desconhecido"}`);
  return json;
}

const SINCRONIZACOES = ["smb_app_state_sync", "history"] as const;

/**
 * Conclui o cadastro incorporado: troca o codigo (vale 30 s) pelo token comercial, confere que o
 * numero segue no app WhatsApp Business, assina os webhooks da WABA, grava e pede a sincronizacao
 * de contatos e historico (a Meta so aceita uma vez e da 24 h para isso).
 */
export async function conectarOficial(p: { code: string; wabaId: string; phoneNumberId?: string }, usuarioId: string) {
  const appId = process.env.WHATSAPP_APP_ID;
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!appId || !segredo) throw new ErroNegocio("Faltam WHATSAPP_APP_ID e WHATSAPP_APP_SECRET no servidor.", 409);

  let token: string;
  try {
    const q = new URLSearchParams({ client_id: appId, client_secret: segredo, code: p.code });
    token = (await meta<{ access_token: string }>(`${graph("oauth/access_token")}?${q}`)).access_token;
  } catch (e) {
    throw new ErroNegocio(`A Meta recusou o código do cadastro (${(e as Error).message}). Refaça a conexão.`, 502);
  }
  // O evento da coexistência pode vir só com a WABA: o número sai da lista dela.
  type Tel = { id: string; display_phone_number?: string; is_on_biz_app?: boolean };
  const campos = "id,display_phone_number,is_on_biz_app,platform_type";
  const tel = await (p.phoneNumberId
    ? meta<Tel>(graph(`${p.phoneNumberId}?fields=${campos}`), { token })
    : meta<{ data?: Tel[] }>(graph(`${p.wabaId}/phone_numbers?fields=${campos}`), { token }).then((r) => r.data?.find((t) => t.is_on_biz_app) ?? r.data?.[0])
  ).catch((e) => { throw new ErroNegocio(`Não consegui ler o número na Meta (${(e as Error).message}).`, 502); });
  // Só a coexistência está implementada: número novo precisaria de registro com PIN.
  if (!tel?.is_on_biz_app) throw new ErroNegocio("Esse número não está no app WhatsApp Business. Escolha conectar o WhatsApp Business existente.", 409);
  const phoneNumberId = tel.id;
  await meta(graph(`${p.wabaId}/subscribed_apps`), { token, corpo: {} })
    .catch((e) => { throw new ErroNegocio(`Não consegui assinar os avisos da conta (${(e as Error).message}).`, 502); });

  const numero = tel.display_phone_number?.replace(/\D/g, "") || null;
  const dados = {
    wabaId: p.wabaId, phoneNumberId, numero, tokenCifrado: cifrarToken(token), coexistencia: true,
    conectadoEm: new Date(), sincronizacaoEm: null, sincronizacaoErro: null, desconectadoEm: null, motivoDesconexao: null,
  };
  await db.$transaction(async (tx) => {
    await tx.whatsAppOficial.upsert({ where: { id: 1 }, create: { id: 1, ...dados }, update: dados });
    await auditar(tx, usuarioId, "whatsapp_oficial_conectar", "configuracao", "whatsapp", { wabaId: p.wabaId, phoneNumberId, numero });
  });

  const erros: string[] = [];
  for (const sync_type of SINCRONIZACOES) {
    await meta(graph(`${phoneNumberId}/smb_app_data`), { token, corpo: { messaging_product: "whatsapp", sync_type } })
      .catch((e) => erros.push(`${sync_type}: ${(e as Error).message}`));
  }
  const sincronizacaoErro = erros.join("; ").slice(0, 500) || null;
  if (sincronizacaoErro) console.error("[whatsapp] sincronização da coexistência falhou:", sincronizacaoErro);
  await db.whatsAppOficial.update({ where: { id: 1 }, data: { sincronizacaoEm: new Date(), sincronizacaoErro } });
  return { numero, sincronizacaoErro };
}

/** A Meta avisou (account_update) que o numero saiu da API: para de usar o token. */
export async function marcarDesconectado(wabaId: string, motivo: string) {
  const r = await db.whatsAppOficial.updateMany({ where: { wabaId, desconectadoEm: null }, data: { desconectadoEm: new Date(), motivoDesconexao: motivo.slice(0, 200) } });
  if (r.count) console.error(`[whatsapp] número oficial desconectado pela Meta: ${motivo}`);
}

export function estadoOficial() {
  return db.whatsAppOficial.findUnique({
    where: { id: 1 },
    select: { numero: true, coexistencia: true, conectadoEm: true, sincronizacaoEm: true, sincronizacaoErro: true, desconectadoEm: true, motivoDesconexao: true },
  });
}
