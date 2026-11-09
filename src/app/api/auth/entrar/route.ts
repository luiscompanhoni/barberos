import { NextResponse } from "next/server";
import { z } from "zod";
import { abrirSessao } from "@/lib/auth/abrir-sessao";
import { verificarCodigo } from "@/lib/auth/otp";
import { ErroNegocio, rota } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { corpoAutenticacao } from "@/lib/auth/http-cliente";

/** Acesso por código a uma conta/ficha existente; número novo passa pelo cadastro completo. */
export const POST = rota(async (req: Request) => {
  const b = await corpoAutenticacao(
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
  return NextResponse.json(await abrirSessao(u));
});
