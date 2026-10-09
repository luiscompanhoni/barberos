import { NextResponse } from "next/server";
import { z } from "zod";
import { abrirSessao } from "@/lib/auth/abrir-sessao";
import { entrarComSenha } from "@/lib/auth/acesso";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Login com celular (ou usuario, na equipe) e senha. */
export const POST = rota(async (req: Request) => {
  const b = await corpo(req, z.object({
    identificador: z.string().trim().min(3).max(60),
    senha: z.string().min(1).max(128),
    area: z.enum(["equipe", "cliente"]).default("equipe"),
  }));
  const u = await entrarComSenha(b.identificador, b.senha, b.area);
  return NextResponse.json(await abrirSessao(u));
});
