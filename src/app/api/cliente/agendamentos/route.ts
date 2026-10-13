import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { antecipadoDisponivel } from "@/lib/agenda/antecipado";
import { checkoutProprio } from "@/lib/pagamentos/checkout";
import { agendarPeloCliente, historicoDoCliente, proximosDoCliente } from "@/lib/agenda/cliente";
import { configuracao } from "@/lib/agenda/carregar";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo, zId, zInstante } from "@/lib/validacao";

export const GET = rota(async () => {
  const s = await exigirCliente();
  const [proximos, historico, cfg, pagarAntes] = await Promise.all([
    proximosDoCliente(s.clienteId),
    historicoDoCliente(s.clienteId),
    configuracao(),
    antecipadoDisponivel(),
  ]);
  // checkout: paga na pagina do BarberOS (Pagar.me); senao, pelo link do gateway (Celcash).
  return NextResponse.json({ proximos, historico, prazoAlteracaoMin: cfg.prazoCancelamentoMin, pagarAntes, checkout: pagarAntes && checkoutProprio() });
});

export const POST = rota(async (req: Request) => {
  const s = await exigirCliente();
  const b = await corpo(req, z.object({ barbeiroId: zId, servicoId: zId, inicio: zInstante, semPreferencia: z.boolean().optional(), forcarAvulso: z.boolean().optional() }));
  const cliente = await db.cliente.findUniqueOrThrow({ where: { id: s.clienteId } });
  if (!cliente.nome.trim()) throw new ErroNegocio("Informe seu nome no perfil antes de agendar.", 422, "sem_nome");
  const ag = await agendarPeloCliente({ ...b, telefone: cliente.telefone, nome: cliente.nome, origem: "SITE" });
  return NextResponse.json(ag, { status: 201 });
});
