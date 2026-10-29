import { NextResponse } from "next/server";
import { z } from "zod";
import { encerrarSessao, exigirCliente } from "@/lib/auth/sessao";
import { ErroNegocio, rota } from "@/lib/erros";
import { confirmouExclusao } from "@/lib/lgpd/regras";
import { aceitarTermos, excluirConta, mudarMensagens, situacaoPrivacidade } from "@/lib/lgpd/titular";
import { corpo } from "@/lib/validacao";

const SEM_CACHE = { "Cache-Control": "private, no-store" };

/** Situacao da privacidade do cliente: termos aceitos, mensagens e o que impede excluir a conta. */
export const GET = rota(async () => {
  const s = await exigirCliente();
  return NextResponse.json(await situacaoPrivacidade(s.clienteId), { headers: SEM_CACHE });
});

/** Aceitar os termos, ligar/desligar mensagens de divulgacao ou excluir a conta (digitando EXCLUIR). */
export const POST = rota(async (req: Request) => {
  const s = await exigirCliente();
  const b = await corpo(req, z.discriminatedUnion("acao", [
    z.object({ acao: z.literal("aceitar") }).strict(),
    z.object({ acao: z.literal("mensagens"), aceita: z.boolean() }).strict(),
    z.object({ acao: z.literal("excluir"), confirmacao: z.string().max(20) }).strict(),
  ]));
  if (b.acao === "aceitar") await aceitarTermos(s.clienteId, s.usuarioId);
  else if (b.acao === "mensagens") await mudarMensagens(s.clienteId, s.usuarioId, b.aceita);
  else {
    if (!confirmouExclusao(b.confirmacao)) throw new ErroNegocio("Digite EXCLUIR para confirmar.", 422, "confirmacao");
    await excluirConta(s.clienteId, s.usuarioId);
    await encerrarSessao();
    return NextResponse.json({ excluida: true }, { headers: SEM_CACHE });
  }
  return NextResponse.json(await situacaoPrivacidade(s.clienteId), { headers: SEM_CACHE });
});
