import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";

/** Lista de conversas do WhatsApp para a equipe (as que pedem atendente primeiro). */
export const GET = rota(async () => {
  await exigirSessao(["DONO", "RECEPCAO"]);
  const conversas = await db.conversa.findMany({
    orderBy: [{ atualizadoEm: "desc" }],
    take: 100,
    select: {
      id: true,
      telefone: true,
      nomePerfil: true,
      estado: true,
      naoLidas: true,
      atualizadoEm: true,
      cliente: { select: { nome: true } },
      mensagens: { orderBy: { criadoEm: "desc" }, take: 1, select: { texto: true, autor: true, criadoEm: true } },
    },
  });
  conversas.sort((a, b) => Number(b.estado === "HUMANO") - Number(a.estado === "HUMANO"));
  return NextResponse.json(conversas);
});
