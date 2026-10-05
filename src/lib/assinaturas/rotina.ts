/**
 * Rotina das assinaturas (roda de hora em hora no servidor). Necessaria para
 * gateways sem recorrencia de Pix nem aviso de atraso (Pagar.me):
 * - gera o Pix do proximo mes 3 dias antes do vencimento e manda no WhatsApp;
 * - marca como vencida a cobranca que passou do dia sem pagamento.
 */
import { db } from "@/lib/db";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, somarDias } from "@/lib/agenda/tempo";
import { gateway, provedorPagamento } from "@/lib/pagamentos/gateway";
import { PREFIXO_PIX } from "@/lib/pagamentos/pagarme";
import { notificarEmSegundoPlano } from "@/lib/whatsapp/conversas";
import { linkAbsoluto, sincronizarCobranca } from "./cobrancas";
import { gerarPixDoMes } from "./cartao-pix";

const DIAS_ANTES_PIX = 3;
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function gerarPixDoProximoMes() {
  const cfg = await configuracao();
  const limite = somarDias(dataLocal(Date.now(), cfg.fuso), DIAS_ANTES_PIX);
  const assinaturas = await db.assinatura.findMany({
    where: {
      formaPagamento: "PIX",
      status: { in: ["ATIVA", "ATRASADA"] },
      gatewayId: { startsWith: PREFIXO_PIX },
      proximoVencimento: { lte: new Date(`${limite}T00:00:00Z`) },
    },
    include: { cliente: true, plano: true },
  });
  let geradas = 0;
  for (const a of assinaturas) {
    const venc = a.proximoVencimento!.toISOString().slice(0, 10);
    const ja = await db.cobranca.findFirst({
      where: { assinaturaId: a.id, vencimento: a.proximoVencimento!, status: { not: "CANCELADA" } },
    });
    if (ja) continue;
    try {
      const c = await gerarPixDoMes(a.id, venc);
      geradas++;
      notificarEmSegundoPlano(
        a.cliente.telefone,
        `Oi, ${a.cliente.nome.split(" ")[0]}! A mensalidade do ${a.plano.nome} (${reais(c.valorCentavos)}) vence em ${venc.split("-").reverse().join("/")}. ` +
          `Pix para pagar: ${linkAbsoluto(c.link)} 💈`,
      );
    } catch (e) {
      console.error(`[rotina] falha ao gerar Pix da assinatura ${a.id}:`, e);
    }
  }
  return geradas;
}

/** Cobranca em aberto que passou do vencimento vira "vencida" (dispara o aviso). */
export async function marcarVencidas() {
  const cfg = await configuracao();
  const hoje = new Date(`${dataLocal(Date.now(), cfg.fuso)}T00:00:00Z`);
  const vencidas = await db.cobranca.findMany({
    where: { status: "PENDENTE", vencimento: { lt: hoje }, assinatura: { status: { not: "CANCELADA" } } },
  });
  for (const c of vencidas) {
    await sincronizarCobranca({
      id: c.gatewayId, assinaturaGatewayId: null, valorCentavos: c.valorCentavos,
      vencimento: c.vencimento.toISOString().slice(0, 10), status: "ATRASADA",
      pagaEm: null, link: null,
    });
  }
  return vencidas.length;
}

export async function rodarRotinaDePagamentos() {
  if (provedorPagamento() !== "pagarme") return { pix: 0, vencidas: 0 };
  const g = await gateway();
  const pix = g.pix === "avulso" ? await gerarPixDoProximoMes() : 0;
  const vencidas = await marcarVencidas();
  return { pix, vencidas };
}

/** Liga a rotina uma vez por processo (chamado do instrumentation). */
export function agendarRotina() {
  const g = globalThis as unknown as { rotinaPagamentos?: boolean };
  if (g.rotinaPagamentos) return;
  g.rotinaPagamentos = true;
  const rodar = () =>
    rodarRotinaDePagamentos()
      .then((r) => (r.pix || r.vencidas) && console.log(`[rotina] Pix gerados: ${r.pix}, cobranças vencidas: ${r.vencidas}`))
      .catch((e) => console.error("[rotina] falhou:", e));
  setTimeout(rodar, 30_000);
  setInterval(rodar, 60 * 60_000);
}
