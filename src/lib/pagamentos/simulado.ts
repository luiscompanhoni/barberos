/**
 * Gateway simulado (testes locais). Guarda as cobrancas em `cobrancas_simuladas`
 * e gera links para /c/pagamento-simulado/<id>, onde o pagamento e "aprovado".
 */
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { somarMes } from "@/lib/assinaturas/regras";
import type { CobrancaAvulsa, CobrancaGateway, Gateway } from "./gateway";

const novoId = (p: string) => `${p}_${randomBytes(6).toString("hex")}`;
const data = (d: Date) => d.toISOString().slice(0, 10);

function converter(c: { id: string; assinaturaGatewayId: string; valorCentavos: number; vencimento: Date; status: string; pagaEm: Date | null }): CobrancaGateway {
  return {
    id: c.id,
    assinaturaGatewayId: c.assinaturaGatewayId,
    valorCentavos: c.valorCentavos,
    vencimento: data(c.vencimento),
    status: c.status as CobrancaGateway["status"],
    pagaEm: c.pagaEm?.toISOString() ?? null,
    link: `/c/pagamento-simulado/${c.id}`,
  };
}

export const simulado: Gateway = {
  nome: "simulado",
  cartao: "hospedado",
  pix: "nativo",
  exigeEmail: false,

  async criarCliente() {
    return novoId("simcus");
  },

  async criarAssinatura(a) {
    const id = novoId("simsub");
    await db.cobrancaSimulada.create({
      data: { id: novoId("simpay"), assinaturaGatewayId: id, valorCentavos: a.valorCentavos, vencimento: new Date(`${a.primeiroVencimento}T00:00:00Z`) },
    });
    return id;
  },

  async cobrancasDaAssinatura(id) {
    const lista = await db.cobrancaSimulada.findMany({ where: { assinaturaGatewayId: id }, orderBy: { vencimento: "asc" } });
    return lista.map(converter);
  },

  async buscarCobranca(id) {
    return converter(await db.cobrancaSimulada.findUniqueOrThrow({ where: { id } }));
  },

  async cancelarAssinatura(id) {
    await db.cobrancaSimulada.updateMany({ where: { assinaturaGatewayId: id, status: { in: ["PENDENTE", "ATRASADA"] } }, data: { status: "CANCELADA" } });
  },
};

/** "Paga" a cobranca simulada (o que o cliente faria na fatura do Asaas). */
export async function pagarSimulada(id: string) {
  return db.cobrancaSimulada.update({ where: { id }, data: { status: "PAGA", pagaEm: new Date() } });
}

/** Marca como vencida sem pagamento (o que o Asaas faz no dia seguinte ao vencimento). */
export async function atrasarSimulada(id: string) {
  return db.cobrancaSimulada.update({ where: { id }, data: { status: "ATRASADA", vencimento: new Date(Date.now() - 86_400_000) } });
}

/** Gera a cobranca do proximo mes (o Asaas faz isso sozinho nas assinaturas reais). */
export async function gerarProximaSimulada(assinaturaGatewayId: string) {
  const ultima = await db.cobrancaSimulada.findFirstOrThrow({ where: { assinaturaGatewayId }, orderBy: { vencimento: "desc" } });
  return db.cobrancaSimulada.create({
    data: {
      id: novoId("simpay"),
      assinaturaGatewayId,
      valorCentavos: ultima.valorCentavos,
      vencimento: new Date(`${somarMes(data(ultima.vencimento))}T00:00:00Z`),
    },
  });
}

// Cobranca avulsa simulada (horario pago antes, link de pagamento): mesma tabela, sem assinatura.
// Pix: codigo falso + pagina de teste. Cartao com token de teste (checkout em modo teste):
// "token_recusado" e recusado, qualquer outro e aprovado na hora.
export const TOKEN_TESTE_RECUSADO = "token_recusado";
const avulsa = (c: Parameters<typeof converter>[0]): CobrancaAvulsa => {
  const x = converter(c);
  const recusada = x.status === "ATRASADA";
  return {
    id: x.id, status: x.status, pagaEm: x.pagaEm, link: x.link,
    pixCopiaECola: c.id.startsWith("simpix") ? `00020126SIMULADO${c.id}` : null,
    erro: recusada ? "O cartão não foi aceito (cartão de teste recusado)." : null,
  };
};
simulado.criarCobrancaAvulsa = async (c) => {
  const comToken = c.forma === "CARTAO" && !!c.cartaoToken;
  if (comToken && process.env.NODE_ENV === "production") throw new Error("Cartão de teste não é aceito em produção.");
  const recusado = comToken && c.cartaoToken === TOKEN_TESTE_RECUSADO;
  const criada = avulsa(await db.cobrancaSimulada.create({
    data: {
      id: novoId(c.forma === "PIX" ? "simpix" : "simchg"), assinaturaGatewayId: `avulsa:${c.referencia}`, valorCentavos: c.valorCentavos,
      vencimento: new Date(`${c.vencimento}T00:00:00Z`),
      ...(comToken ? (recusado ? { status: "ATRASADA" as const } : { status: "PAGA" as const, pagaEm: new Date() }) : {}),
    },
  }));
  // Validade do Pix (a tela de teste mostra a contagem como na Pagar.me).
  return c.forma === "PIX" && c.pixValidadeSeg ? { ...criada, expiraEm: new Date(Date.now() + c.pixValidadeSeg * 1000).toISOString() } : criada;
};
simulado.buscarCobrancaAvulsa = async (id) => avulsa(await db.cobrancaSimulada.findUniqueOrThrow({ where: { id } }));
simulado.cancelarCobrancaAvulsa = async (id) => {
  await db.cobrancaSimulada.updateMany({ where: { id, status: "PENDENTE" }, data: { status: "CANCELADA" } });
};
