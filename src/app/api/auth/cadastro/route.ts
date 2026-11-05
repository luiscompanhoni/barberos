import { NextResponse } from "next/server";
import { z } from "zod";
import { abrirSessao } from "@/lib/auth/abrir-sessao";
import { criarContaCliente } from "@/lib/auth/acesso";
import { rota } from "@/lib/erros";
import { json } from "@/lib/estudio/http";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";
import { zDadosCadastroCliente } from "@/lib/clientes/perfil-cadastro";

/** Cliente cria a conta no site (nome, celular e senha) e ja entra. */
export const POST = rota(async (req: Request) => {
  exigirOrigemCliente(req);
  const b = await json(req, zDadosCadastroCliente.extend({
    senha: z.string().min(1).max(128),
    codigo: z.string().regex(/^\d{6}$/, "Informe o código recebido no celular."),
    // LGPD: so cria a conta com o aceite dos Termos e da Politica de privacidade.
    aceiteTermos: z.literal(true, { error: "Aceite os Termos de uso e a Política de privacidade para criar a conta." }),
  }));
  const u = await criarContaCliente(b);
  return NextResponse.json({ ...await abrirSessao(u), completarCadastro: true }, { status: 201 });
});
