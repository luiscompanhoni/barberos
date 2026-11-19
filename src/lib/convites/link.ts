import { urlSite } from "@/lib/dominios";

export const tokenDeConvite = (token: string) => /^app_[a-f0-9]{32}$/.test(token);
export const enderecoDoConvite = (token: string) => `${urlSite()}/c/r/${token}`;
export function linkPublicoApp(texto: string) {
  if (texto === urlSite()) return true;
  const prefixo = urlSite() + "/c/r/";
  return texto.startsWith(prefixo) && tokenDeConvite(texto.slice(prefixo.length));
}
