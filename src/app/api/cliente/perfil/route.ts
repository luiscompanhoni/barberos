import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { dataParaTexto, zPerfilCliente } from "@/lib/validacao-cliente";
import { cadastroCompleto, seletorPerfilCliente, zAtualizacaoCadastroCliente } from "@/lib/clientes/perfil-cadastro";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";
import { json } from "@/lib/estudio/http";
import { atualizarPerfilTitular } from "@/lib/clientes/perfil-mutacao";

export const GET = rota(async () => {
  const s = await exigirCliente();
  const c = await db.cliente.findUniqueOrThrow({
    where: { id: s.clienteId },
    select: seletorPerfilCliente,
  });
  const { cpf, ...perfil } = c;
  return NextResponse.json({ ...perfil, cpfMascarado: cpf ? `***.***.***-${cpf.slice(-2)}` : null,
    completo: cadastroCompleto(c), dataNascimento: dataParaTexto(c.dataNascimento) }, { headers: { "Cache-Control": "private, no-store" } });
});

/** Nome, preferencias ("maquina 2 nas laterais"), nascimento e como conheceu. */
export const PATCH = rota(async (req: Request) => {
  const s = await exigirCliente();
  exigirOrigemCliente(req);
  const b = await json(req, zAtualizacaoCadastroCliente.extend({ observacoes: z.string().trim().max(300).optional() })
    .merge(zPerfilCliente.omit({ dataNascimento: true })).strict());
  const c = await atualizarPerfilTitular(s, b);
  return NextResponse.json(c);
});
