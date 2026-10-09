/**
 * Cancelamento do plano pelo bot: mesmo servico (e mesmas ofertas) da area do cliente.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { aceitarDesconto, cancelarPeloCliente, falarComGerente, pausar, previaCancelamento } from "@/lib/assinaturas/retencao";
import { MOTIVOS } from "@/lib/assinaturas/retencao-regras";
import { situacaoDoCliente } from "@/lib/assinaturas/servico";
import type { ContextoBot, ResultadoFerramenta } from "./ferramentas";

const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;

const OFERTA = z.object({ motivo: z.enum(MOTIVOS) });
const DECISAO = z.object({
  motivo: z.enum(MOTIVOS),
  decisao: z.enum(["aceitar_desconto", "pausar", "falar_com_gerente", "cancelar"]),
  dias: z.number().int().min(1).max(365).optional(),
  detalhe: z.string().max(200).optional(),
});

export async function executarCancelamento(nome: string, entrada: unknown, ctx: ContextoBot): Promise<ResultadoFerramenta> {
  const c = await db.cliente.findUnique({ where: { telefone: ctx.telefone } });
  const sit = c ? await situacaoDoCliente(c.id) : null;
  if (!sit) return { texto: "O cliente não tem assinatura para cancelar.", erro: true };
  const assinaturaId = sit.assinatura.id;

  if (nome === "oferta_cancelamento") {
    const e = OFERTA.parse(entrada);
    const p = await previaCancelamento(assinaturaId, e.motivo);
    const o = p.oferta;
    const oferta =
      o.tipo === "DESCONTO"
        ? `Ofereça ${o.pct}% de desconto nas próximas ${o.meses} mensalidade(s): ${reais(Math.round((p.mensalidadeCentavos * (100 - o.pct)) / 100))} em vez de ${reais(p.mensalidadeCentavos)}. Se aceitar, decisao=aceitar_desconto.`
        : o.tipo === "PAUSA"
          ? `Ofereça pausar o plano (sem cobrança durante a pausa; os dias já pagos ficam guardados). Opções de dias: ${o.opcoesDias.join(", ")}. Se aceitar, decisao=pausar com dias.`
          : o.tipo === "GERENTE"
            ? "Ofereça falar com o gerente para resolver. Se aceitar, decisao=falar_com_gerente."
            : "Sem oferta para esse motivo: confirme se ele quer mesmo cancelar.";
    const se = p.cancelamento.imediato
      ? "Se cancelar: cancela na hora, sem novas cobranças."
      : `Se cancelar: o mês já pago continua valendo até ${dataBr(p.cancelamento.ultimoDia!)}, sem novas cobranças.`;
    return { texto: `${oferta} ${se}${p.cancelamento.cashbarber ? " (Cobrança no sistema antigo: a equipe confirma o cancelamento por lá.)" : ""}` };
  }

  const e = DECISAO.parse(entrada);
  const pedido = { assinaturaId, motivo: e.motivo, detalhe: e.detalhe, origem: "BOT" as const, usuarioId: null };
  switch (e.decisao) {
    case "aceitar_desconto": {
      const r = await aceitarDesconto(pedido);
      return { texto: `Desconto aplicado: ${r.pct}% nas próximas ${r.meses} mensalidade(s), ${reais(r.valorCentavos)} cada. Confirme para o cliente.` };
    }
    case "pausar": {
      if (!e.dias) return { texto: "Pergunte por quantos dias ele quer pausar (use uma das opções da oferta).", erro: true };
      const r = await pausar({ ...pedido, dias: e.dias });
      return { texto: `Plano pausado. Volta sozinho em ${dataBr(r.volta)}; a próxima mensalidade passou para ${dataBr(r.proximoVencimento)}. Nada é cobrado na pausa.` };
    }
    case "falar_com_gerente":
      await falarComGerente(pedido);
      return { texto: "Conversa passada para o gerente. Avise o cliente que o gerente vai responder por aqui em breve e que o plano continua valendo.", passouParaHumano: true };
    default: {
      const r = await cancelarPeloCliente(pedido);
      return {
        texto: r.ultimoDia
          ? `Plano cancelado. Continua valendo até ${dataBr(r.ultimoDia)}, sem novas cobranças. Horários depois disso continuam, como avulsos.`
          : "Plano cancelado, sem novas cobranças. Horários já marcados continuam, como avulsos.",
      };
    }
  }
}
