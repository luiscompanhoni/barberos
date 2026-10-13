import { NextResponse } from "next/server";
import { z } from "zod";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { exigirSessao } from "@/lib/auth/sessao";
import { enviarLista, enviarResumo, novoLink } from "@/lib/checklist/servico";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Enviar agora pelo WhatsApp (lista de uma pessoa ou o resumo), ou gerar link novo. */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO", "RECEPCAO"]);
  const b = await corpo(req, z.discriminatedUnion("acao", [
    z.object({ acao: z.literal("lista"), pessoaId: z.string() }),
    z.object({ acao: z.literal("resumo") }),
    z.object({ acao: z.literal("novo_link"), pessoaId: z.string() }),
  ]));
  if (b.acao === "novo_link") {
    await novoLink(s, b.pessoaId);
    return NextResponse.json({ ok: true });
  }
  const hoje = dataLocal(Date.now(), (await configuracao()).fuso);
  if (b.acao === "lista") {
    if (!(await enviarLista(b.pessoaId, hoje, true))) throw new ErroNegocio("Não enviado: a pessoa não tem tarefas pendentes hoje (ou o WhatsApp falhou).", 409);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ enviados: await enviarResumo(hoje, true) });
});
