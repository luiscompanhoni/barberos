import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/auth/permissoes";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { cobrancaEmAberto, cobrarPeloWhatsApp, linkAbsoluto, processarEventoGateway, sincronizarAssinatura } from "@/lib/assinaturas/cobrancas";
import { mascararCpf } from "@/lib/assinaturas/regras";
import { cancelar } from "@/lib/assinaturas/servico";
import { registrarCancelamentoDaEquipe } from "@/lib/assinaturas/retencao";
import { motivoPorTexto } from "@/lib/assinaturas/retencao-regras";
import { ehCashbarber } from "@/lib/pagamentos/retencao-gateway";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, rota } from "@/lib/erros";
import { provedorPagamento } from "@/lib/pagamentos/gateway";
import { atrasarSimulada, gerarProximaSimulada, pagarSimulada } from "@/lib/pagamentos/simulado";
import { corpo } from "@/lib/validacao";

export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/assinaturas/[id]">) => {
  await exigirSessao(BALCAO);
  const { id } = await ctx.params;
  const a = await db.assinatura.findUnique({
    where: { id },
    include: {
      cliente: { select: { id: true, nome: true, telefone: true, cpf: true } },
      plano: { select: { nome: true } },
      cobrancas: { orderBy: { vencimento: "desc" } },
      retencoes: { orderBy: { criadoEm: "desc" }, take: 5, select: { id: true, motivo: true, detalhe: true, desfecho: true, origem: true, criadoEm: true } },
      agendamentos: { orderBy: { inicio: "desc" }, take: 10, select: { id: true, inicio: true, status: true, servico: { select: { nome: true } } } },
    },
  });
  if (!a) throw naoEncontrado("Assinatura");
  return NextResponse.json({
    ...a,
    cliente: { ...a.cliente, cpf: mascararCpf(a.cliente.cpf) },
    cobrancas: a.cobrancas.map((c) => ({ ...c, link: linkAbsoluto(c.link) })),
    simulado: provedorPagamento() === "simulado",
    cashbarber: ehCashbarber(a.gatewayId),
  });
});

/**
 * Acoes da equipe. As de "simular_*" so existem com PAGAMENTOS_PROVIDER=simulado
 * e fazem o papel do gateway (para testar sem Asaas).
 */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/assinaturas/[id]">) => {
  const s = await exigirSessao(BALCAO);
  const { id } = await ctx.params;
  const b = await corpo(
    req,
    z.object({
      acao: z.enum(["cobrar", "sincronizar", "cancelar", "simular_pagamento", "simular_atraso", "simular_proximo_mes"]),
      motivo: z.string().trim().max(200).optional(),
    }),
  );
  const a = await db.assinatura.findUnique({ where: { id } });
  if (!a) throw naoEncontrado("Assinatura");

  switch (b.acao) {
    case "cobrar":
      return NextResponse.json(await cobrarPeloWhatsApp(id));
    case "sincronizar":
      await sincronizarAssinatura(id);
      return NextResponse.json({ ok: true });
    case "cancelar":
      await exigirPermissao(s, "assinatura");
      if (!b.motivo) throw new ErroNegocio("Informe o motivo do cancelamento.");
      await cancelar(id, b.motivo, s.usuarioId);
      await registrarCancelamentoDaEquipe(id, motivoPorTexto(b.motivo), b.motivo.split(":").slice(1).join(":").trim() || (motivoPorTexto(b.motivo) === "OUTRO" ? b.motivo : null), s.usuarioId);
      // CashBarber: a cobranca e la; o BarberOS so registra.
      return NextResponse.json({ ok: true, cashbarber: ehCashbarber(a.gatewayId) });
  }

  if (provedorPagamento() !== "simulado" || !a.gatewayId) throw new ErroNegocio("Simulação disponível só no modo simulado.", 403);
  if (b.acao === "simular_proximo_mes") {
    const c = await gerarProximaSimulada(a.gatewayId);
    await processarEventoGateway(`sim_${c.id}_criada`, "PAYMENT_CREATED", c.id);
  } else {
    const aberta = await cobrancaEmAberto(id);
    if (!aberta) throw new ErroNegocio("Não há cobrança em aberto para simular.");
    if (b.acao === "simular_pagamento") await pagarSimulada(aberta.gatewayId);
    else await atrasarSimulada(aberta.gatewayId);
    await processarEventoGateway(`sim_${aberta.gatewayId}_${b.acao}`, b.acao === "simular_pagamento" ? "PAYMENT_RECEIVED" : "PAYMENT_OVERDUE", aberta.gatewayId);
  }
  return NextResponse.json({ ok: true });
});
