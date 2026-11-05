import { NextResponse } from "next/server";
import { encerrarSessao } from "@/lib/auth/sessao";
import { revogarDispositivoAtual } from "@/lib/notificacoes/inscricoes";
import { exigirOrigemAutenticacao } from "@/lib/auth/http-cliente";
import { rota } from "@/lib/erros";

export const POST = rota(async (req: Request) => {
  exigirOrigemAutenticacao(req);
  await revogarDispositivoAtual();
  await encerrarSessao();
  return NextResponse.json({ ok: true });
});
