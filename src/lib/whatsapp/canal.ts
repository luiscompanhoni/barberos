/**
 * Envio de mensagens pelo WhatsApp.
 * - "cloud": WhatsApp Cloud API oficial da Meta (producao).
 * - "evolution": nao oficial, pelo QR code (Evolution API no mesmo servidor).
 * - "simulador": nada sai do servidor; as mensagens ficam no banco e aparecem na
 *   tela /simulador (para testar sem conta na Meta). Na homologacao e sempre ele.
 */

import { linkPublicoApp } from "@/lib/convites/link";
import type { Conversa } from "@prisma/client";
import { campanhaConferida, loteAutorizadoConfirmado, loteAutorizadoDisponivel } from "@/lib/campanhas/lote-autorizado";
import { aberturaReativacao } from "@/lib/automacoes/regras";
import { db } from "@/lib/db";
import { reservarEnvioPiloto } from "./piloto";
import { telefonePiloto } from "./piloto-regras";
import { textoParametroTemplate } from "./template-parametro";
import { ehHomologacao } from "@/lib/ambiente";
import { enviarTextoEvolution } from "./evolution";
import { credenciaisOficial } from "./oficial";
import { envioTesteEquipe, testeEquipeAtivo } from "./teste-equipe";
import { telefoneCanonico } from "./webhook";

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
export function dentroJanela24h(ultimaEntradaEm: Date | null) {
  const tempo = ultimaEntradaEm ? Date.now() - +ultimaEntradaEm : Infinity;
  return tempo >= 0 && tempo < 24 * 3_600_000;
}

async function configCloud() {
  const c = await credenciaisOficial();
  if (!c) throw new Error("API oficial sem número: conecte em WhatsApp no painel ou preencha WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID.");
  const versao = process.env.WHATSAPP_API_VERSION ?? "v23.0";
  return { token: c.token, url: `https://graph.facebook.com/${versao}/${c.phoneId}/messages` };
}

async function postarCloud(corpo: Record<string, unknown>): Promise<ResultadoEnvio> {
  const { token, url } = await configCloud();
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...corpo }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${json.error?.message ?? "erro desconhecido"}`);
  return { wamid: json.messages?.[0]?.id ?? null };
}

/**
 * `digitandoMs`: pausa antes de entregar (resposta do bot em bolhas). Na Evolution aparece
 * "digitando..."; na API oficial so espera; no simulador nao espera (testes rapidos).
 */
export async function enviarTexto(para: string, texto: string, digitandoMs = 0, origem = "PADRAO"): Promise<ResultadoEnvio> {
  const teste = await envioTesteEquipe(para, origem);
  if ((testeEquipeAtivo() || process.env.WHATSAPP_ENVIOS_BLOQUEADOS === "true") && !teste) throw new Error("Envios de mensagens bloqueados nesta publicação.");
  await reservarEnvioPiloto(para, origem);
  return entregarTexto(para, texto, digitandoMs);
}

async function entregarTexto(para: string, texto: string, digitandoMs = 0): Promise<ResultadoEnvio> {
  const p = provedorWhatsApp();
  if (p === "simulador") return { wamid: null };
  if (p === "evolution") return enviarTextoEvolution(para, texto, digitandoMs);
  if (digitandoMs > 0) await new Promise((r) => setTimeout(r, digitandoMs));
  return postarCloud({ to: para, type: "text", text: { preview_url: linkPublicoApp(texto), body: texto.slice(0, 4096) } });
}

/** O desbloqueio vale somente para um envio já reservado da lista conferida. */
export async function enviarTextoLoteAutorizado(envioId: string, conversa: Conversa, texto: string, etapa: 0 | 1) {
  const autorizado = await loteAutorizadoDisponivel();
  const envio = autorizado && await db.campanhaEnvio.findUnique({
    where: { id: envioId }, include: { campanha: true, mensagem: true, cliente: { select: { telefone: true, nome: true, aceitaMensagens: true, excluidoEm: true } } },
  });
  if (!autorizado || !envio?.aberturaIniciadaEm || envio.aberturaConcluidaEm || envio.lote !== 1 || envio.status !== "ENVIADO" || !envio.token ||
      envio.campanha.status !== "ATIVA" || !campanhaConferida(envio.campanha, autorizado) || !autorizado.clienteIds.includes(envio.clienteId) ||
      conversa.clienteId !== envio.clienteId || conversa.telefone !== envio.cliente.telefone ||
      conversa.recusaAutomaticas || conversa.estado === "HUMANO" || !envio.cliente.aceitaMensagens || envio.cliente.excluidoEm) {
    throw new Error("O envio não corresponde ao lote aprovado.");
  }
  if (!await loteAutorizadoConfirmado(autorizado)) throw new Error("O lote aguarda confirmação no painel.");
  const abertura = aberturaReativacao(envio.cliente.nome);
  const primeira = envio.mensagem;
  const etapaCorreta = etapa === 0 ? !envio.mensagemId :
    primeira?.conversaId === conversa.id && primeira.texto === abertura[0] && !primeira.erro;
  if (!etapaCorreta || texto !== abertura[etapa]) throw new Error("O envio não corresponde ao balão autorizado.");
  const destino = conversa.waId && telefoneCanonico(conversa.waId) === telefoneCanonico(conversa.telefone) ? conversa.waId : conversa.telefone;
  return entregarTexto(destino, texto);
}

export async function enviarTemplate(para: string, t: TemplateWhatsApp, origem: "TEMPLATE" | "CAMPANHA" | "PAGAMENTO_CONFIRMADO" = "TEMPLATE"): Promise<ResultadoEnvio> {
  if (testeEquipeAtivo()) throw new Error("Templates bloqueados durante o teste da equipe.");
  if (process.env.WHATSAPP_ENVIOS_BLOQUEADOS === "true") throw new Error("Envios de mensagens bloqueados nesta publicação.");
  await reservarEnvioPiloto(para, origem);
  return entregarTemplate(para, t);
}

/** Conteúdo fixo: não aceita texto, template ou finalidade fornecidos pelo cliente. */
export async function enviarCodigoAcesso(para: string, codigo: string): Promise<ResultadoEnvio> {
  const telefone = telefonePiloto(para);
  if (!telefone || !/^\d{6}$/.test(codigo)) throw new Error("Código ou destinatário de autenticação inválido.");
  // Autenticação solicitada no login tem limites próprios em auth/otp; não reativa o bot.
  if (provedorWhatsApp() !== "cloud") {
    return entregarTexto(telefone, `Seu código de acesso é *${codigo}*.\nVale por 5 minutos. Não passe para ninguém.`);
  }
  const nome = process.env.WHATSAPP_TEMPLATE_CODIGO;
  if (!nome) throw new Error("WHATSAPP_TEMPLATE_CODIGO não configurado.");
  return entregarTemplate(telefone, { nome, parametros: [codigo], botaoCodigo: codigo });
}

async function entregarTemplate(para: string, t: TemplateWhatsApp): Promise<ResultadoEnvio> {
  const p = provedorWhatsApp();
  if (p === "simulador") return { wamid: null };
  if (p === "evolution") throw new Error("Modelos de mensagem só existem na API oficial.");
  const components: Record<string, unknown>[] = t.parametros.length
    ? [{ type: "body", parameters: t.parametros.map((text) => ({ type: "text", text: textoParametroTemplate(text) })) }]
    : [];
  if (t.botaoCodigo) {
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: t.botaoCodigo }] });
  }
  return postarCloud({
    to: para,
    type: "template",
    template: { name: t.nome, language: { code: t.idioma ?? "pt_BR" }, ...(components.length ? { components } : {}) },
  });
}
