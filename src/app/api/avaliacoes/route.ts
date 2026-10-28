import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/auth/permissoes";
import { exigirSessao, LIDERANCA } from "@/lib/auth/sessao";
import { resumosPublicados } from "@/lib/avaliacoes/resumos";
import { listarAvaliacoesDono } from "@/lib/avaliacoes/respostas";
import { proibido, rota } from "@/lib/erros";

export const dynamic = "force-dynamic";

export const GET = rota(async () => {
  const s = await exigirSessao();
  const lideranca = LIDERANCA.includes(s.papel);
  if (lideranca) await exigirPermissao(s, "avaliar_equipe");
  else if (!s.barbeiroId) throw proibido();
  const [resumos, avaliacoes] = await Promise.all([
    resumosPublicados(lideranca ? undefined : [s.barbeiroId!]),
    s.papel === "DONO" ? listarAvaliacoesDono(s) : [],
  ]);
  return NextResponse.json({ resumos, avaliacoes, dono: s.papel === "DONO" }, { headers: { "Cache-Control": "private, no-store" } });
});
