import { normalizarTelefone } from "@/lib/telefone";
import { urlSite } from "@/lib/dominios";

const CONTATO = /\b(?:telefone|whats(?:app)?|celular|n[uú]mero|contato|fone)\b(?:\s+é)?\s*[:=]?$/iu;
const LINK = /(?:\b[a-z][\w+.-]*:\/\/[^\s<>()]+|(?<![\p{L}\p{N}@_.-])(?:[\p{L}\p{N}][\p{L}\p{N}-]*\.)+[\p{L}]{2,}(?![\p{L}\p{N}_-])(?::\d{1,5})?(?:[/?#][^\s<>()]*)?)/giu;
const EMAIL = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu;
const TELEFONE = /(?<![\p{L}\p{N}_+./-])(?:\+?55[ .-]?)?(?:\([1-9]\d\)|[1-9]\d)[ .-]?(?:9\d{4}|[2-9]\d{3})[ .-]?\d{4}(?![\p{L}\p{N}_]|[.\/-]\d)/gu;
const CREDENCIAL = /\b(?:senhas?|passwords?|passcode|tokens?|pin|otp)\b|\bc[oó]digo\b(?:\s+(?:tempor[aá]rio|novo|secreto)\b|\s+de\s+(?:acesso|verifica[cç][aã]o|login|autentica[cç][aã]o|seguran[cç]a|confirma[cç][aã]o)\b|\s+\d{4,}|\s+é(?:\s|$)|\s*[=:])/iu;
const CREDENCIAL_OMITIDA = "[credencial omitida]";
const temCredencial = (texto: string) => CREDENCIAL.test(texto.normalize("NFC"));
const normalizarTexto = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const ASSUNTO_PESSOAL = /\b(?:me[us]s?|minhas?)\s+(?:agendamentos?|planos?|horarios?|reservas?|comandas?|compras?|assinaturas?|pagamentos?|cobrancas?|dados|cadastro|perfil|conta|beneficios?|presentes?)\b/;
const OPERACAO_NA_CONTA = /\b(?:remarc(?:ar|a|acao|e)|cancel(?:ar|a|amento|e)|pag(?:ar|ue)|pix|boleto|cobranca|reembolso|status|segunda via|excluir conta|senha|codigo de acesso)\b/;

export function telefoneDoDirect(texto: string) {
  if (temCredencial(texto)) return null;
  const limpo = texto.replace(EMAIL, " ").replace(LINK, " ").trim();
  const candidatos = [...limpo.matchAll(TELEFONE)];
  if (candidatos.length !== 1) return null;
  const { 0: candidato, index } = candidatos[0];
  if (limpo !== candidato && !CONTATO.test(limpo.slice(0, index).trimEnd())) return null;
  return normalizarTelefone(candidato);
}

function ocultarDados(texto: string, trocarLink: (link: string) => string) {
  // O valor pode vir depois de palavras, pontuação ou em outra linha.
  if (temCredencial(texto)) return CREDENCIAL_OMITIDA;
  return texto
    .replace(EMAIL, "[e-mail omitido]")
    .replace(LINK, trocarLink)
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
  if (texto === CREDENCIAL_OMITIDA) return true;
  const simples = normalizarTexto(texto);
  return ASSUNTO_PESSOAL.test(simples) || OPERACAO_NA_CONTA.test(simples) || /\b(?:agend(?:e|a|ar)|reserv(?:e|a|ar))\b/.test(simples);
}

export function pedidoDeNovaReservaDirect(texto: string) {
  const simples = normalizarTexto(texto);
  if (ASSUNTO_PESSOAL.test(simples) || OPERACAO_NA_CONTA.test(simples) || /\b(?:reagend\w*|confirm\w*)\b/.test(simples)) return false;
  return /\b(?:quero|queria|gostaria de|preciso|posso|consigo|como faco (?:pra|para))\s+(?:agendar|marcar|reservar)\b/.test(simples) ||
    /^\s*(?:agende|marque|reserve)\s+(?:um|uma)\b/.test(simples);
}

export function respostaModeloExigeEquipe(texto: string) {
  if (texto.search(LINK) >= 0 || temCredencial(texto) || /\[\w+\]/u.test(texto)) return true;
  const simples = normalizarTexto(texto);
  return /\b(?:agendei|agendamos|reservei|reservamos|remarquei|reagendei|cancelei|cancelamos|cobrei|paguei|estornei|reembolsei|cadastrei)\b/.test(simples) ||
    /\b(?:confirmei|confirmamos|efetuei|realizei|atualizei|alterei|ativei|troquei|conclui)\s+(?:o|a|seu|sua)\s+(?:horario|reserva|agendamento|assinatura|pagamento|cadastro|conta)\b/.test(simples) ||
    /\b(?:horario|reserva|agendamento|pagamento|assinatura)\s+(?:ja )?(?:(?:esta|foi) )?(?:confirmad[oa]|marcad[oa]|reservad[oa]|cancelad[oa]|aprovad[oa]|efetuad[oa])\b/.test(simples);
}
