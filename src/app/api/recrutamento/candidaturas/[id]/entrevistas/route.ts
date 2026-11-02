import { estadoPiloto } from "@/lib/whatsapp/piloto";
import { permitePiloto } from "@/lib/whatsapp/piloto-regras";
import { NextResponse } from "next/server";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { criarConviteEntrevista } from "@/lib/recrutamento/entrevistas";
import { hashTokenEntrevista, tokenEntrevista } from "@/lib/recrutamento/entrevistas-token";
import { linkEntrevista } from "@/lib/recrutamento/entrevistas-gestao";
import { zConviteEntrevista } from "@/lib/recrutamento/entrevistas-regras";
import { corpoEntrevista } from "@/lib/recrutamento/entrevistas-http";
export const dynamic = "force-dynamic";
type Contexto = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };
export const GET = rota(async (_req: Request, ctx: Contexto) => {
  const s = await exigirSessao(GESTAO);
  const entrevistas = await db.entrevistaRecrutamento.findMany({ where: { candidaturaId: (await ctx.params).id }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 20 });
  const p = await estadoPiloto();
  const c = p?.ativo ? await db.candidaturaRecrutamento.findUnique({where:{id:(await ctx.params).id},select:{candidato:{select:{telefone:true}}}}) : null;
  return NextResponse.json({ podeMarcar: s.papel === "DONO", entrevistas: entrevistas.map(e => ({ id: e.id, podeEnviarPiloto: p?.usuarioId === s.usuarioId && s.papel === "DONO" && e.donoId === s.usuarioId && e.estado === "CONVIDADO" && permitePiloto(p,c?.candidato.telefone ?? "","ENTREVISTA_PILOTO"), versao: e.versao, estado: e.estado, inicio: e.inicio, local: e.local, duracaoMin: e.duracaoMin, expiraEm: e.expiraEm, link: s.papel === "DONO" && e.donoId === s.usuarioId && e.tokenHash === hashTokenEntrevista(tokenEntrevista(e)) && e.estado !== "CANCELADA" && +e.expiraEm > Date.now() ? linkEntrevista(e) : null, podeGerir: e.donoId === s.usuarioId && s.papel === "DONO" })) }, { headers });
});
export const POST = rota(async (req: Request, ctx: Contexto) => {
  const s = await exigirSessao(["DONO"]);
  const e = await criarConviteEntrevista(s.usuarioId, (await ctx.params).id, await corpoEntrevista(req, zConviteEntrevista));
  return NextResponse.json({ id: e.id, link: linkEntrevista(e) }, { status: 201, headers });
});
