import { NextResponse } from "next/server";
import { z } from "zod";
import { solicitarCodigo } from "@/lib/auth/otp";
import { ErroNegocio, rota } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { corpo } from "@/lib/validacao";

export const POST = rota(async (req: Request) => {
  const { telefone, area } = await corpo(
    req,
    z.object({ telefone: z.string().max(30), area: z.enum(["equipe", "cliente"]).default("equipe") }),
  );
  const tel = normalizarTelefone(telefone);
  if (!tel) throw new ErroNegocio("Telefone inválido. Use DDD + número.", 400);
  const codigoTeste = await solicitarCodigo(tel, area);
  return NextResponse.json({
    ok: true,
    mensagem: "Se o número estiver cadastrado, o código foi enviado.",
    // So em teste local (sem WhatsApp): o codigo aparece na tela de login.
    ...(codigoTeste ? { codigoTeste } : {}),
  });
});
