import { NextResponse } from "next/server";
import { z } from "zod";
import { ErroNegocio, rota } from "@/lib/erros";
import { json } from "@/lib/estudio/http";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";
import { identidadePendente } from "@/lib/auth/social-cookies";
import { modoCodigoNaTela, solicitarCodigo } from "@/lib/auth/otp";
import { zTelefoneCadastro } from "@/lib/clientes/perfil-cadastro";

export const POST = rota(async (req: Request) => {
  exigirOrigemCliente(req);
  if (!await identidadePendente()) throw new ErroNegocio("Este acesso expirou. Comece novamente.", 401);
  if (!modoCodigoNaTela() && process.env.OTP_PROVIDER !== "whatsapp") throw new ErroNegocio("Confirmação por celular indisponível. Entre com sua senha ou fale com a recepção.", 503);
  const b = await json(req, z.object({ telefone: zTelefoneCadastro }));
  const codigoTeste = await solicitarCodigo(b.telefone, "cliente");
  return NextResponse.json({ ok: true, ...(codigoTeste ? { codigoTeste } : {}) });
});
