import { NextResponse } from "next/server";
import { z } from "zod";
import { abrirSessao } from "@/lib/auth/abrir-sessao";
import { verificarCodigo } from "@/lib/auth/otp";
import { ErroNegocio, rota } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { corpo } from "@/lib/validacao";

/** Entrada por codigo (primeiro acesso / esqueci a senha). */
export const POST = rota(async (req: Request) => {
  const b = await corpo(
    req,
    z.object({
      telefone: z.string().max(30),
      codigo: z.string().regex(/^\d{6}$/),
      area: z.enum(["equipe", "cliente"]).default("equipe"),
    }),
  );
  const tel = normalizarTelefone(b.telefone);
  if (!tel) throw new ErroNegocio("Telefone inválido.", 400);
  const u = await verificarCodigo(tel, b.codigo, b.area);
  if (b.area === "equipe" && u.papel === "CLIENTE") {
    throw new ErroNegocio("Esse número é de cliente. Entre pela área do cliente.", 403);
  }
  if (b.area === "cliente" && u.papel !== "CLIENTE") {
    throw new ErroNegocio("Esse número é da equipe. Entre pelo acesso da equipe.", 403);
  }
  return NextResponse.json(await abrirSessao(u));
});
