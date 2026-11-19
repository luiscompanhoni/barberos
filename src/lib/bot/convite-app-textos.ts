import { urlSite } from "@/lib/dominios";

export const AVISO_TROCA_APP = "A gente está trocando o aplicativo da Black. Tu já pode instalar o novo app no celular e pedir teu próximo horário por lá. Aqui está o link 👇";
export const continuacaoConviteApp = (endereco = urlSite()) => [AVISO_TROCA_APP, endereco];

// Somente respostas completas e inequívocas seguem sem interpretação pelo modelo.
export function respostaAoConvite(texto: string, endereco?: string): string[] | null {
  const normal = texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[!?,.]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:nao(?: (?:quero|preciso|tenho interesse))?(?: obrigad[oa])?|agora nao(?: obrigad[oa])?|deixa pra depois|sem interesse)$/.test(normal)) {
    return ["Tranquilo! Se precisar da Black, é só chamar por aqui."];
  }
  const saudacao = /^(?:oi+|ola|opa|e ai|fala|bom dia|boa tarde|boa noite)(?: leonel)?(?: (?:bom dia|boa tarde|boa noite|tudo bem|tudo certo|beleza))?(?: e (?:tu|contigo|voce))?$/;
  const aceite = /^(?:(?:oi+|ola|opa|sim) )?(?:tudo bem|tudo certo|beleza|sim|diga|pode (?:falar|mandar|enviar)(?: o link)?|(?:manda|envia) o link)$/;
  return saudacao.test(normal) || aceite.test(normal) ? continuacaoConviteApp(endereco) : null;
}
