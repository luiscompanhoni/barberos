/**
 * Gateway simulado (testes locais). Guarda as cobrancas em `cobrancas_simuladas`
 * e gera links para /c/pagamento-simulado/<id>, onde o pagamento e "aprovado".
 */
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { somarMes } from "@/lib/assinaturas/regras";
import type { CobrancaGateway, Gateway } from "./gateway";

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
