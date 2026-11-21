import { enderecoDoConvite } from "@/lib/convites/link";

export const AVISO_TROCA_APP = "A gente está trocando o aplicativo da Black. Tu já pode instalar o novo app no celular e pedir teu próximo horário por lá. Aqui está o link 👇";
export const continuacaoConviteApp = (endereco = enderecoDoConvite()) => [AVISO_TROCA_APP, endereco];
export const RECUSA_CONVITE = "Tranquilo! Se precisar da Black, é só chamar por aqui.";

// Somente respostas completas e inequívocas seguem sem interpretação pelo modelo.
export function classificarRespostaAbertura(texto: string) {
  const normal = texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[!?,.]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:nao(?: (?:quero|preciso|tenho interesse))?(?: obrigad[oa])?|agora nao(?: obrigad[oa])?|deixa pra depois|sem interesse)$/.test(normal)) {
    return "recusa";
  }
  const saudacao = /^(?:oi+|ola|opa|e ai|fala|bom dia|boa tarde|boa noite)(?: leonel)?(?: (?:bom dia|boa tarde|boa noite|tudo bem|tudo certo|beleza))?(?: e (?:tu|contigo|voce))?$/;
  const aceite = /^(?:(?:oi+|ola|opa|sim) )?(?:tudo bem|tudo certo|beleza|sim|diga|pode (?:falar|mandar|enviar)(?: o link)?|(?:manda|envia) o link)$/;
  return saudacao.test(normal) || aceite.test(normal) ? "acolheu" : null;
}

export function respostaAoConvite(texto: string, endereco?: string): string[] | null {
  const resposta = classificarRespostaAbertura(texto);
  return resposta === "recusa" ? [RECUSA_CONVITE] : resposta === "acolheu" ? continuacaoConviteApp(endereco) : null;
}
