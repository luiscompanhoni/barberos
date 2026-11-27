import type { TEMPERATURAS } from "@/lib/clientes/segmentos";

export type SegmentoLeonel = (typeof TEMPERATURAS)[number];
export type EtapaJornadaLeonel = "link" | "roleta" | "cadastro" | "agenda";

const mensagens: Record<Exclude<SegmentoLeonel, "quente">, string> = {
  morno: "A Black tá com um app novo. Quando quiser voltar, por lá tu consegue escolher teu barbeiro e ver os horários. Entra com teu número e confirma o código no app. Se precisar, te ajudo por aqui.",
  frio: "Faz tempo que tu não passa por aqui! Tem um presente pra tua volta. Abre o link e gira a roleta da Black. 🎁",
  muitoFrio: "Já faz um bom tempo desde tua última visita e a gente quer te convidar pra voltar. Preparamos uma jogada de presente pra ti. Abre o link e gira a roleta da Black. Depois tu entra com teu número pra agendar e usar o que sair.",
};

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0];

export function aberturaDaJornada(segmento: SegmentoLeonel, nome: string, link: string) {
  const primeiro = primeiroNome(nome);
  const saudacao = primeiro ? `Fala, ${primeiro}, tudo bem? Aqui é o Leonel da Black.` : "Fala, tudo bem? Aqui é o Leonel da Black.";
  if (segmento === "quente") return [
    saudacao,
    "Tem uma notícia boa pra ti! A Black tá mudando pro próprio app. Por lá tu marca e acompanha teus horários.",
    "Testa e me dá um feedback? Abre o link, entra com teu número e confirma o código no app.",
    link,
  ] as const;
  if (segmento === "frio" || segmento === "muitoFrio") return [saudacao, mensagens[segmento], link] as const;
  return [saudacao, `${mensagens[segmento]}\n\n${link}`] as const;
}

export function instanteDeRetomada(ultimaAtividade: Date | number) {
  return new Date(+ultimaAtividade + 5 * 3_600_000);
}

export function instanteDeAjudaAposLeitura(envio: Date, leitura: Date) {
  return new Date(Math.max(+envio, +leitura) + 3_600_000);
}

export const AJUDA_APOS_LEITURA = [
  "Opa! Conseguiu abrir o link que te mandei?",
  "Se precisar de ajuda, me chama por aqui.",
] as const;

export function mensagemDaRetomada(nome: string, etapa: EtapaJornadaLeonel): readonly [string, string] {
  const primeiro = primeiroNome(nome);
  const oi = primeiro ? `Oi, ${primeiro}!` : "Oi!";
  switch (etapa) {
    case "link": return [`${oi} Conseguiu abrir o link que te mandei?`, "Se quiser, te ajudo por aqui."];
    case "roleta": return [`${oi} Conseguiu girar a roleta da Black?`, "Se a tela travou, me diz o que apareceu."];
    case "cadastro": return [`${oi} Conseguiu terminar o cadastro?`, "Se travou em alguma etapa, me diz o que apareceu que eu te ajudo por aqui."];
    case "agenda": return [`${oi} Quer uma mão pra marcar teu próximo horário?`, "Me diz o serviço e o dia que fica bom pra ti."];
  }
}

export function recusouJornada(texto: string) {
  const limpo = texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[.!?,]+/g, " ").trim().replace(/\s+/g, " ");
  return /^(?:nao (?:quero|tenho interesse|obrigad[oa])|agora nao(?: obrigad[oa])?|sem interesse|deixa (?:pra|para) depois)$/.test(limpo);
}
