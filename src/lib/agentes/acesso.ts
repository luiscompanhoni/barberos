import { exigirSessao, type Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { urlPainel } from "@/lib/dominios";
import { ErroNegocio, proibido } from "@/lib/erros";

export const agentesHabilitados = () => process.env.AGENTES_HABILITADOS === "true";
export const execucaoHabilitada = () => agentesHabilitados() && process.env.AGENTES_EXECUCAO_ATIVA === "true" && !!process.env.ANTHROPIC_API_KEY;
export async function conferirDono(s: Pick<Sessao, "usuarioId">) {
  const u = await db.usuario.findUnique({ where: { id: s.usuarioId }, select: { ativo: true, papel: true } });
  if (!u?.ativo || u.papel !== "DONO") throw proibido();
}
export async function exigirAgentes(req?: Request) {
  const s = await exigirSessao(["DONO"]);
  if (!agentesHabilitados()) throw new ErroNegocio("Central de agentes desabilitada neste ambiente.", 503);
  if (req && !["GET", "HEAD"].includes(req.method)) {
    const origin = req.headers.get("origin");
    if (req.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(urlPainel()).origin)) throw proibido();
  }
  return s;
}
