import { normalizarTelefone } from "@/lib/telefone";
import { urlSite } from "@/lib/dominios";

const CONTATO = /\b(?:telefone|whats(?:app)?|celular|n[uú]mero|contato|fone)\b(?:\s+é)?\s*[:=]?$/iu;
const LINK = /(?:https?:\/\/|www\.)[^\s<>()]+/giu;
const EMAIL = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu;
const TELEFONE = /(?<![\p{L}\p{N}_+./-])(?:\+?55[ .-]?)?(?:\([1-9]\d\)|[1-9]\d)[ .-]?(?:9\d{4}|[2-9]\d{3})[ .-]?\d{4}(?![\p{L}\p{N}_]|[.\/-]\d)/gu;

export function telefoneDoDirect(texto: string) {
  const limpo = texto.replace(LINK, " ").replace(EMAIL, " ").trim();
  const candidatos = [...limpo.matchAll(TELEFONE)];
  if (candidatos.length !== 1) return null;
  const { 0: candidato, index } = candidatos[0];
  if (limpo !== candidato && !CONTATO.test(limpo.slice(0, index).trimEnd())) return null;
  return normalizarTelefone(candidato);
}

function ocultarDados(texto: string, trocarLink: (link: string) => string) {
  return texto
    .replace(LINK, trocarLink)
    .replace(EMAIL, "[e-mail omitido]")
    .replace(/\b(?:senha|c[oó]digo(?: de acesso)?|token|pin)\s*(?:(?:[=:]|é)\s*[^\s,]+|\s+\d{4,})/giu, "[credencial omitida]")
    .replace(TELEFONE, "[telefone omitido]")
    .replace(/(?<!\d)\d(?:[\d .-]*\d)?(?!\d)/gu, (numero) => numero.replace(/\D/g, "").length >= 6 ? "[número omitido]" : numero);
}

export function textoSeguroDoDirect(texto: string) {
  return ocultarDados(texto, () => "[link omitido]");
}

const CAMINHOS_PUBLICOS = new Set(["/", "/entrar", "/c/entrar", "/c/agendar", "/assine", "/privacidade", "/termos"]);

export function textoDaEquipeNoDirect(texto: string) {
  return ocultarDados(texto, link => {
    const url = URL.parse(link.replace(/[!?.,]+$/, ""));
    const site = URL.parse(urlSite());
    return url && site && url.origin === site.origin && url.protocol === "https:" && !url.username && !url.password &&
      !url.search && !url.hash && CAMINHOS_PUBLICOS.has(url.pathname) ? link : "[link omitido]";
  });
}

export function pedidoPrivadoNoDirect(texto: string) {
  const simples = texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return /\b(?:me[us]s?|minhas?)\s+(?:agendamentos?|planos?|horarios?|reservas?|comandas?|compras?|assinaturas?|pagamentos?|cobrancas?|dados|cadastro|perfil|conta|beneficios?|presentes?)\b/.test(simples) ||
    /\b(?:agend(?:e|a|ar)|reserv(?:e|a|ar)|remarc(?:ar|a|a[r]?cao|e)|cancel(?:ar|a|amento|e)|pag(?:ar|ue)|pix|boleto|cobranca|reembolso|status|segunda via|excluir conta|senha|codigo de acesso)\b/.test(simples);
}
