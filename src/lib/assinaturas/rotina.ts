/**
 * Rotina das assinaturas (roda de hora em hora no servidor). Necessaria para
 * gateways sem recorrencia de Pix nem aviso de atraso (Pagar.me):
 * - gera o Pix do proximo mes 3 dias antes do vencimento e manda no WhatsApp;
 * - marca como vencida a cobranca que passou do dia sem pagamento;
 * - Celcash: busca o status das assinaturas na API (a conta so tem uma URL de webhook,
 *   que pode estar em uso por outro sistema; a consulta garante que nada se perde).
 *   Continua rodando depois da troca para a Pagar.me enquanto houver assinatura antiga da Celcash.
 * - links de pagamento: confere os em aberto e expira os vencidos.
 */
import { db } from "@/lib/db";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, somarDias } from "@/lib/agenda/tempo";
import { gateway } from "@/lib/pagamentos/gateway";
import { PREFIXO_PIX } from "@/lib/pagamentos/pagarme";
import { notificarEmSegundoPlano } from "@/lib/whatsapp/conversas";
import { linkAbsoluto, sincronizarAssinatura, sincronizarCobranca } from "./cobrancas";
import { gerarPixDoMes } from "./cartao-pix";
import { sincronizarAntecipadosPendentes } from "@/lib/agenda/antecipado";
import { sincronizarLinksPendentes } from "@/lib/links/servico";
import { encerrarCancelados, reativarPausas } from "./retencao-rotina";

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
      encerraEm: null, // cancelado no fim do ciclo: sem proxima mensalidade
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

/** Celcash: atualiza as cobrancas de cada assinatura feita pelo BarberOS (novas mensalidades e pagamentos). */
export async function sincronizarCelcash() {
  const ativas = await db.assinatura.findMany({
    where: { gatewayId: { startsWith: "celsub_" }, status: { not: "CANCELADA" } },
    select: { id: true },
  });
  let ok = 0;
  for (const a of ativas) {
    try {
      await sincronizarAssinatura(a.id);
      ok++;
    } catch (e) {
      console.error(`[rotina] falha ao consultar a Celcash (assinatura ${a.id}):`, e);
    }
  }
  return ok;
}

export async function rodarRotinaDePagamentos() {
  // Cancelamento com retencao: pausas que acabaram e planos no fim do ciclo.
  const reativadas = await reativarPausas().catch((e) => { console.error("[rotina] pausas:", e); return 0; });
  const encerradas = await encerrarCancelados().catch((e) => { console.error("[rotina] encerramentos:", e); return 0; });
  // Horarios pagos antes e links de pagamento (cada um no gateway do seu id).
  await sincronizarAntecipadosPendentes().catch((e) => console.error("[rotina] pagamentos antecipados:", e));
  await sincronizarLinksPendentes().catch((e) => console.error("[rotina] links de pagamento:", e));
  // Assinaturas da Celcash (feitas antes da troca de provedor) seguem sincronizadas pela Celcash.
  const celcash = await sincronizarCelcash();
  const g = await gateway();
  // Pix mensal das assinaturas Pix da Pagar.me (pixrec_), mesmo se o provedor do env mudar.
  const pix = g.pix === "avulso" || (await db.assinatura.count({ where: { gatewayId: { startsWith: PREFIXO_PIX }, status: { not: "CANCELADA" } } }))
    ? await gerarPixDoProximoMes()
    : 0;
  // Asaas avisa o atraso sozinho; Pagar.me e Celcash nao: a rotina marca as vencidas.
  const vencidas = g.nome === "pagarme" || g.nome === "celcash" ? await marcarVencidas() : 0;
  return { pix, vencidas, celcash, reativadas, encerradas };
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
