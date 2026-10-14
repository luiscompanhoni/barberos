import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { antecipadoDisponivel } from "@/lib/agenda/antecipado";
import { checkoutProprio } from "@/lib/pagamentos/checkout";
import { agendarPeloCliente, historicoDoCliente, proximosDoCliente } from "@/lib/agenda/cliente";
import { configuracao } from "@/lib/agenda/carregar";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { premiosParaReservar, reservarPremio } from "@/lib/jogos/premios";
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
  const b = await corpo(req, z.object({
    barbeiroId: zId, servicoId: zId, inicio: zInstante, semPreferencia: z.boolean().optional(), forcarAvulso: z.boolean().optional(),
    /** Premio de jogo que o cliente vai usar nesse horario (fica reservado). */
    premioId: zId.optional(),
  }));
  const cliente = await db.cliente.findUniqueOrThrow({ where: { id: s.clienteId } });
  if (!cliente.nome.trim()) throw new ErroNegocio("Informe seu nome no perfil antes de agendar.", 422, "sem_nome");
  const { premioId, ...dados } = b;
  // Confere o premio antes de marcar (vencido/indisponivel nao deixa o horario marcado pela metade).
  const premio = premioId ? (await premiosParaReservar(s.clienteId)).find((p) => p.id === premioId) : null;
  if (premioId && !premio) throw new ErroNegocio("Esse prêmio não está mais disponível. Agende sem ele ou escolha outro.", 409, "premio_indisponivel");
  if (premio?.expiraEm && new Date(premio.expiraEm) < b.inicio) {
    throw new ErroNegocio(`Esse prêmio vale até ${new Date(premio.expiraEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}: escolha um horário até lá.`, 422, "premio_validade");
  }
  const ag = await agendarPeloCliente({ ...dados, telefone: cliente.telefone, nome: cliente.nome, origem: "SITE" });
  if (premioId) await db.$transaction((tx) => reservarPremio(tx, s.clienteId, premioId, ag));
  return NextResponse.json(ag, { status: 201 });
});
