/**
 * Envio de mensagens pelo WhatsApp.
 * - "cloud": WhatsApp Cloud API oficial da Meta (producao).
 * - "evolution": nao oficial, pelo QR code (Evolution API no mesmo servidor).
 * - "simulador": nada sai do servidor; as mensagens ficam no banco e aparecem na
 *   tela /simulador (para testar sem conta na Meta). Na homologacao e sempre ele.
 */

import { ehHomologacao } from "@/lib/ambiente";
import { enviarTextoEvolution } from "./evolution";

export type ResultadoEnvio = { wamid: string | null };

export type TemplateWhatsApp = {
  nome: string;
  idioma?: string;
  /** Parametros do corpo, na ordem {{1}}, {{2}}... */
  parametros: string[];
  /** Template de autenticacao (codigo de acesso) com botao "copiar codigo". */
  botaoCodigo?: string;
};

export type ProvedorWhatsApp = "cloud" | "evolution" | "simulador";

export function provedorWhatsApp(): ProvedorWhatsApp {
  if (ehHomologacao()) return "simulador";
  const p = process.env.WHATSAPP_PROVIDER;
  return p === "cloud" || p === "evolution" ? p : "simulador";
}

/** So a API oficial tem a janela de 24h (fora dela, so modelo aprovado pela Meta). */
export const temJanela24h = () => provedorWhatsApp() === "cloud";

function configCloud() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error("WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID são obrigatórios com WHATSAPP_PROVIDER=cloud.");
  const versao = process.env.WHATSAPP_API_VERSION ?? "v23.0";
  return { token, url: `https://graph.facebook.com/${versao}/${phoneId}/messages` };
}

async function postarCloud(corpo: Record<string, unknown>): Promise<ResultadoEnvio> {
  const { token, url } = configCloud();
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...corpo }),
  });
  const json = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${json.error?.message ?? "erro desconhecido"}`);
  return { wamid: json.messages?.[0]?.id ?? null };
}

export async function enviarTexto(para: string, texto: string): Promise<ResultadoEnvio> {
  const p = provedorWhatsApp();
  if (p === "simulador") return { wamid: null };
  if (p === "evolution") return enviarTextoEvolution(para, texto);
  return postarCloud({ to: para, type: "text", text: { preview_url: false, body: texto.slice(0, 4096) } });
}

export async function enviarTemplate(para: string, t: TemplateWhatsApp): Promise<ResultadoEnvio> {
  const p = provedorWhatsApp();
  if (p === "simulador") return { wamid: null };
  if (p === "evolution") throw new Error("Modelos de mensagem só existem na API oficial.");
  const components: Record<string, unknown>[] = [
    { type: "body", parameters: t.parametros.map((text) => ({ type: "text", text })) },
  ];
  if (t.botaoCodigo) {
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: t.botaoCodigo }] });
  }
  return postarCloud({
    to: para,
    type: "template",
    template: { name: t.nome, language: { code: t.idioma ?? "pt_BR" }, components },
  });
}
