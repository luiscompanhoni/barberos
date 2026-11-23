import { zIdInstagram } from "./protocolo";

export function transporteInstagram(): { url: string; token: string } | null {
  const provedor = process.env.INSTAGRAM_PROVEDOR ?? "facebook_login";
  if (provedor !== "facebook_login" && provedor !== "instagram_login") return null;
  const perfil = zIdInstagram.safeParse(process.env.INSTAGRAM_PROFESSIONAL_ACCOUNT_ID);
  if (!perfil.success) return null;

  const facebook = provedor === "facebook_login";
  const host = facebook ? "graph.facebook.com" : "graph.instagram.com";
  const conta = facebook ? zIdInstagram.safeParse(process.env.INSTAGRAM_PAGE_ID).data : perfil.data;
  const token = (facebook ? process.env.INSTAGRAM_PAGE_ACCESS_TOKEN : process.env.INSTAGRAM_ACCESS_TOKEN)?.trim();
  const versao = process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() || (facebook ? "v26.0" : "");
  if (!conta || !token || !/^v[1-9]\d?\.0$/.test(versao)) return null;

  return { url: `https://${host}/${versao}/${conta}/messages`, token };
}
