import { NextResponse } from "next/server";
import { z } from "zod";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { assinar } from "@/lib/assinaturas/servico";
import { mascararCpf } from "@/lib/assinaturas/regras";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal } from "@/lib/agenda/tempo";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { notificarEmSegundoPlano } from "@/lib/whatsapp/conversas";
import { corpo, parametros } from "@/lib/validacao";

/** Lista de assinaturas + numeros do mes (dono e recepcao). */
export const GET = rota(async (req: Request) => {
  await exigirSessao(BALCAO);
  const { status, busca } = parametros(
    req,
    z.object({ status: z.enum(["PENDENTE", "ATIVA", "ATRASADA", "CANCELADA", "TODAS"]).default("TODAS"), busca: z.string().trim().max(60).optional() }),
  );
  const cfg = await configuracao();
  const inicioMes = new Date(instanteLocal(`${dataLocal(Date.now(), cfg.fuso).slice(0, 8)}01`, 0, cfg.fuso));

  const [lista, contagem, mrr, vendidas, canceladas, motivos] = await Promise.all([
    db.assinatura.findMany({
      where: {
        ...(status !== "TODAS" ? { status } : {}),
        ...(busca ? { cliente: { OR: [{ nome: { contains: busca, mode: "insensitive" } }, { telefone: { contains: busca.replace(/\D/g, "") || busca } }] } } : {}),
      },
      orderBy: [{ status: "asc" }, { criadaEm: "desc" }],
      take: 200,
      include: {
        cliente: { select: { id: true, nome: true, telefone: true, cpf: true } },
        plano: { select: { nome: true } },
        cobrancas: { orderBy: { vencimento: "desc" }, take: 1 },
      },
    }),
    db.assinatura.groupBy({ by: ["status"], _count: true }),
    db.assinatura.aggregate({ where: { status: { in: ["ATIVA", "ATRASADA"] } }, _sum: { precoCentavos: true } }),
    db.assinatura.count({ where: { ativadaEm: { gte: inicioMes } } }),
    db.assinatura.count({ where: { canceladaEm: { gte: inicioMes }, ativadaEm: { not: null } } }),
    db.assinatura.findMany({
      where: { canceladaEm: { gte: new Date(Date.now() - 90 * 86_400_000) }, ativadaEm: { not: null } },
      select: { motivoCancelamento: true },
    }),
  ]);
  const porStatus = Object.fromEntries(contagem.map((c) => [c.status, c._count]));
  return NextResponse.json({
    resumo: {
      ativas: porStatus.ATIVA ?? 0,
      atrasadas: porStatus.ATRASADA ?? 0,
      pendentes: porStatus.PENDENTE ?? 0,
      receitaMensalCentavos: mrr._sum.precoCentavos ?? 0,
      vendidasNoMes: vendidas,
      canceladasNoMes: canceladas,
      motivos: agruparMotivos(motivos.map((m) => m.motivoCancelamento)),
    },
    assinaturas: lista.map((a) => ({ ...a, cliente: { ...a.cliente, cpf: mascararCpf(a.cliente.cpf) } })),
  });
});

/** Venda no balcao: gera a assinatura e manda o link de pagamento pelo WhatsApp. */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(BALCAO);
  const b = await corpo(
    req,
    z.object({
      cliente: z.union([z.object({ id: z.string() }), z.object({ telefone: z.string().max(30), nome: z.string().trim().min(2).max(80) })]),
      planoId: z.string(),
      forma: z.enum(["CARTAO", "PIX", "BOLETO"]),
      cpf: z.string().max(20).optional(),
      email: z.string().trim().max(120).optional(),
      enviarWhatsApp: z.boolean().default(true),
    }),
  );
  let clienteId: string;
  if ("id" in b.cliente) clienteId = b.cliente.id;
  else {
    const tel = normalizarTelefone(b.cliente.telefone);
    if (!tel) throw new ErroNegocio("Telefone inválido.", 400);
    clienteId = (await db.cliente.upsert({ where: { telefone: tel }, create: { telefone: tel, nome: b.cliente.nome }, update: {} })).id;
  }
  const r = await assinar({ clienteId, planoId: b.planoId, forma: b.forma, cpf: b.cpf, email: b.email || undefined, origem: "RECEPCAO", usuarioId: s.usuarioId });
  if (b.enviarWhatsApp && r.link) {
    const c = await db.cliente.findUniqueOrThrow({ where: { id: clienteId } });
    const plano = await db.plano.findUniqueOrThrow({ where: { id: b.planoId } });
    notificarEmSegundoPlano(c.telefone, `Oi, ${c.nome.split(" ")[0]}! Aqui está o link para ativar seu ${plano.nome}: ${r.link} Assim que o pagamento cair, eu te aviso por aqui. 💈`);
  }
  return NextResponse.json({ id: r.assinatura.id, link: r.link }, { status: 201 });
});

/** "Ficou caro: mes apertado" conta como "Ficou caro"; os detalhes ficam de exemplo. */
function agruparMotivos(lista: (string | null)[]) {
  const grupos = new Map<string, { total: number; detalhes: string[] }>();
  for (const m of lista) {
    const [base, ...resto] = (m ?? "Sem motivo").split(":");
    const g = grupos.get(base.trim()) ?? { total: 0, detalhes: [] };
    g.total++;
    if (resto.length && g.detalhes.length < 3) g.detalhes.push(resto.join(":").trim());
    grupos.set(base.trim(), g);
  }
  return [...grupos].map(([motivo, g]) => ({ motivo, ...g })).sort((a, b) => b.total - a.total);
}
