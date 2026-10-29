import { NextResponse } from "next/server";
import { z } from "zod";
import { abrirSessao } from "@/lib/auth/abrir-sessao";
import { criarContaCliente } from "@/lib/auth/acesso";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Cliente cria a conta no site (nome, celular e senha) e ja entra. */
export const POST = rota(async (req: Request) => {
  const b = await corpo(req, z.object({
    nome: z.string().trim().min(2).max(60),
    telefone: z.string().max(30),
    senha: z.string().min(1).max(128),
    // LGPD: so cria a conta com o aceite dos Termos e da Politica de privacidade.
    aceiteTermos: z.literal(true, { error: "Aceite os Termos de uso e a Política de privacidade para criar a conta." }),
  }));
  const u = await criarContaCliente(b);
  return NextResponse.json(await abrirSessao(u), { status: 201 });
});
