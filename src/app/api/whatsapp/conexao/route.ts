import { NextResponse } from "next/server";
import { z } from "zod";
import { auditar } from "@/lib/auditoria";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";
import { conectarEvolution, desconectarEvolution, estadoEvolution } from "@/lib/whatsapp/evolution";

export const dynamic = "force-dynamic";

/** Como o WhatsApp esta ligado agora (e, no nao oficial, se o celular esta conectado). */
export const GET = rota(async () => {
  await exigirSessao(["DONO"]);
  const modo = provedorWhatsApp();
  return NextResponse.json({
    modo,
    estado: modo === "evolution" ? await estadoEvolution() : null,
    numeroOficial: modo === "cloud" ? (process.env.WHATSAPP_NUMERO_PUBLICO || null) : null,
    temChaveBot: !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN,
  });
});

/** Nao oficial: gerar QR code para conectar, ou desconectar o celular. */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  if (provedorWhatsApp() !== "evolution") throw new ErroNegocio("Só o WhatsApp não oficial conecta pelo QR code.", 409);
  const { acao } = await corpo(req, z.object({ acao: z.enum(["conectar", "desconectar"]) }));
  try {
    if (acao === "conectar") return NextResponse.json(await conectarEvolution());
    await desconectarEvolution();
    await auditar(db, s.usuarioId, "whatsapp_desconectar", "configuracao", "whatsapp", {});
    return NextResponse.json({ estado: "desconectado", qr: null });
  } catch (e) {
    throw new ErroNegocio((e as Error).message, 502);
  }
});
