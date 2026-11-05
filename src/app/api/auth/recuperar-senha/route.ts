import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";
import { abrirSessao } from "@/lib/auth/abrir-sessao";
import { solicitarCodigo } from "@/lib/auth/otp";
import { recuperarSenhaCliente } from "@/lib/auth/recuperacao";
import { zTelefoneCadastro } from "@/lib/clientes/perfil-cadastro";
import { json } from "@/lib/estudio/http";
import { rota } from "@/lib/erros";

const schema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("codigo"), telefone: zTelefoneCadastro }).strict(),
  z.object({ acao: z.literal("redefinir"), telefone: zTelefoneCadastro, codigo: z.string().regex(/^\d{6}$/), senha: z.string().min(8).max(128) }).strict(),
]);
export const POST = rota(async (req: Request) => {
  exigirOrigemCliente(req);
  const p = await json(req, schema);
  if (p.acao === "codigo") {
    const codigoTeste = await solicitarCodigo(p.telefone, "cliente", "recuperacao");
    return NextResponse.json({ ok: true, mensagem: "Se o número tiver uma conta de cliente, o código foi enviado.", ...(codigoTeste ? { codigoTeste } : {}) });
  }
  return NextResponse.json(await abrirSessao(await recuperarSenhaCliente(p)));
});
