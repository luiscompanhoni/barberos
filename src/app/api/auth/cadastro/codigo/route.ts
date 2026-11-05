import { NextResponse } from "next/server";
import { z } from "zod";
import { ErroNegocio, rota } from "@/lib/erros";
import { json } from "@/lib/estudio/http";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";
import { modoCodigoNaTela, solicitarCodigo } from "@/lib/auth/otp";
import { zTelefoneCadastro } from "@/lib/clientes/perfil-cadastro";

export const POST = rota(async (req: Request) => {
  exigirOrigemCliente(req);
  if (!modoCodigoNaTela() && process.env.OTP_PROVIDER !== "whatsapp") throw new ErroNegocio("A confirmação pelo celular ainda não está disponível. Fale com a recepção.", 503);
  const b = await json(req, z.object({ telefone: zTelefoneCadastro }));
  const codigoTeste = await solicitarCodigo(b.telefone, "cliente");
  return NextResponse.json({ ok: true, ...(codigoTeste ? { codigoTeste } : {}) });
});
