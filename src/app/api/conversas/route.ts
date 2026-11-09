import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { z } from "zod";
import { corpo, parametros } from "@/lib/validacao";
import { exigirOrigemAutenticacao } from "@/lib/auth/http-cliente";
import { cadastrarPelaConversa } from "@/lib/clientes/conversa";

/** Lista de conversas do WhatsApp para a equipe (as que pedem atendente primeiro). */
export const GET = rota(async (req: Request) => {
  await exigirSessao(BALCAO);
  const { busca } = parametros(req, z.object({ busca: z.string().trim().max(100).default("") }));
  const digitos = busca.replace(/\D/g, "");
  const conversas = await db.conversa.findMany({
    where: { AND: [{ OR: [{ clienteId: null }, { cliente: { is: { excluidoEm: null } } }] }, ...(busca ? [{ OR: [
      { nomePerfil: { contains: busca, mode: "insensitive" as const } }, { cliente: { nome: { contains: busca, mode: "insensitive" as const } } },
      ...(digitos ? [{ telefone: { contains: digitos } }] : []),
    ] }] : [])] },
    orderBy: [{ estado: "desc" }, { atualizadoEm: "desc" }, { id: "asc" }],
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

export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(BALCAO);
  exigirOrigemAutenticacao(req);
  const dados = await corpo(req, z.object({ nome: z.string().trim().min(2).max(100), telefone: z.string().min(10).max(30) }).strict(), { maxBytes: 2048, tipoJson: true });
  return NextResponse.json(await cadastrarPelaConversa(dados, s));
});
