import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { apagarModelo, criarModelo, listarModelos, NOME_MODELO } from "@/lib/whatsapp/modelos";

export const dynamic = "force-dynamic";

const nome = z.string().regex(NOME_MODELO, "Use só letras minúsculas, números e _.");

/** Modelos de mensagem da conta oficial na Meta (só o dono). */
export const GET = rota(async () => {
  await exigirSessao(["DONO"]);
  return NextResponse.json({ modelos: await listarModelos() });
});

export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const p = await corpo(req, z.object({
    nome,
    categoria: z.enum(["UTILITY", "MARKETING"]),
    texto: z.string().trim().min(1).max(1024),
    exemplos: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  }));
  return NextResponse.json(await criarModelo(p, s.usuarioId));
});

export const DELETE = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const n = nome.safeParse(new URL(req.url).searchParams.get("nome"));
  if (!n.success) throw new ErroNegocio("Nome de modelo inválido.");
  await apagarModelo(n.data, s.usuarioId);
  return NextResponse.json({ ok: true });
});
