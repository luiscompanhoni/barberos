import type { Metadata } from "next";
import { urlSite } from "@/lib/dominios";
import type { SegmentoLeonel } from "./jornada-leonel";

const prefixos = { quente: "appq", morno: "appm", frio: "rotf", muitoFrio: "rotm" } as const;
export const tokenDaJornada = (segmento: SegmentoLeonel, sufixo: string) => `${prefixos[segmento]}_${sufixo}`;
export const tokenDeConvite = (token: string) => /^(?:app|appq|appm|rotf|rotm)_[a-f0-9]{32}$/.test(token);
export const ehJornadaComRoleta = (token: string) => /^rot[fm]_[a-f0-9]{32}$/.test(token);
export const ehJornadaLeonel = (token: string) => tokenDeConvite(token) && !token.startsWith("app_");

export function destinoDaJornada(token: string) {
  return ehJornadaComRoleta(token) ? new URL(`/c/r/${token}`, urlSite()).href : enderecoDoConvite(token);
}

export function enderecoDoConvite(token?: string, voltar?: string) {
  const url = new URL("/c/entrar", urlSite());
  if (token) url.searchParams.set("convite", token);
  else url.searchParams.set("confirmar", "1");
  if (voltar) url.searchParams.set("voltar", voltar);
  return url.href;
}

export function linkPublicoApp(texto: string) {
  if (texto === urlSite() || texto === enderecoDoConvite()) return true;
  return [urlSite() + "/c/entrar?convite=", urlSite() + "/c/r/"]
    .some(prefixo => texto.startsWith(prefixo) && tokenDeConvite(texto.slice(prefixo.length)));
}

export function previaConvite(token?: string): Metadata {
  const url = enderecoDoConvite(token);
  return { title: "App da Black Barber", robots: { index: false, follow: false }, alternates: { canonical: url }, openGraph: {
    url,
    title: "App da Black Barber", description: "Escolha seu barbeiro e peça seu próximo horário pelo celular.",
    images: [{ url: urlSite() + "/brand/black/previa-app-v1.png", width: 1200, height: 630, type: "image/png", alt: "Black Barber" }],
  } };
}
