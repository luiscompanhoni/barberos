import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { criarAgendamento } from "@/lib/agenda/agendamentos";
import { rota } from "@/lib/erros";
import { corpo, zId, zInstante } from "@/lib/validacao";

const schema = z.object({
  barbeiroId: zId,
  servicoId: zId,
  inicio: zInstante,
  duracaoMin: z.number().int().min(5).max(480).optional(),
  cliente: z.union([
    z.object({ id: zId }),
    z.object({ telefone: z.string().min(8).max(30), nome: z.string().trim().min(1).max(80) }),
  ]),
  observacao: z.string().max(500).optional(),
  semPreferencia: z.boolean().optional(),
  forcarAvulso: z.boolean().optional(),
});

export const POST = rota(async (req: Request) => {
  const s = await exigirSessao();
  const b = await corpo(req, schema);
  const origem = s.papel === "BARBEIRO" ? "BARBEIRO" : "RECEPCAO";
  const ag = await criarAgendamento({ ...b, origem }, s);
  return NextResponse.json(ag, { status: 201 });
});
