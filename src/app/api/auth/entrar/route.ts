import { NextResponse } from "next/server";
import { z } from "zod";
import { verificarCodigo } from "@/lib/auth/otp";
import { criarSessao } from "@/lib/auth/sessao";
import { ErroNegocio, rota } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { corpo } from "@/lib/validacao";

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
  await criarSessao({
    usuarioId: u.id,
    papel: u.papel,
    nome: u.nome,
    barbeiroId: u.barbeiro?.ativo ? u.barbeiro.id : null,
    clienteId: u.cliente?.id ?? null,
  });
  return NextResponse.json({ ok: true, papel: u.papel, precisaNome: u.papel === "CLIENTE" && !u.nome.trim() });
});
