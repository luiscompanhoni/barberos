import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";

/** Registra dinheiro já devolvido no POS, sem emitir nenhuma ordem de estorno. */
export async function conciliarEstornoPOS(pagamentoId: string, comandaId: string, pedidoId: string, total: number, recebido: number, quando: Date, recebidoEm?: Date) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${comandaId} FOR UPDATE`;
    const pg = await tx.pagamentoComanda.findUniqueOrThrow({ where: { id: pagamentoId } });
    if (pg.gatewayPedidoId !== pedidoId || pg.comandaId !== comandaId || recebido !== pg.valorCentavos) {
      throw new ErroNegocio("Devolução POS exige conferência do valor originalmente recebido.", 409, "maquininha_divergente");
    }
    const efetivos = await tx.pedidoEstorno.aggregate({
      where: { tipo: "COMANDA", referenciaId: pg.id, status: { in: ["EXECUTADO", "MANUAL"] } }, _sum: { valorCentavos: true },
    });
    const registrado = efetivos._sum.valorCentavos ?? 0;
    if (total > pg.valorCentavos || registrado > pg.valorCentavos) throw new ErroNegocio("Estorno POS acima do recebimento original.", 409, "maquininha_divergente");
    if (pg.estornadoCentavos > Math.max(total, registrado)) throw new ErroNegocio("Há estorno local sem conciliação correspondente. Confira o histórico com a gerência.", 409, "maquininha_divergente");
    const delta = total - registrado;
    if (delta > 0) {
      const referencia = `pos:${pedidoId}:devolvido:${total}`;
      const aprovado = await tx.pedidoEstorno.findFirst({
        where: { tipo: "COMANDA", referenciaId: pg.id, meio: "MAQUININHA", status: "APROVADO", valorCentavos: delta }, orderBy: { criadoEm: "asc" },
      });
      let estornoId: string;
      if (aprovado) {
        await tx.pedidoEstorno.update({ where: { id: aprovado.id }, data: {
          status: "EXECUTADO", executadoEm: quando, gatewayEstornoId: referencia, erro: null,
          instrucao: "Devolução na Stone confirmada por consulta ao provedor.",
        } });
        estornoId = aprovado.id;
      } else {
        const novo = await tx.pedidoEstorno.create({ data: {
          tipo: "COMANDA", referenciaId: pg.id, valorCentavos: delta, valorOriginalCentavos: pg.valorCentavos,
          motivo: "Devolução feita na maquininha/portal e confirmada pela Stone.", status: "EXECUTADO",
          meio: "MAQUININHA", forma: pg.forma, descricao: `Estorno POS · ${pedidoId}`, comandaId,
          gatewayEstornoId: referencia, executadoEm: quando,
        } });
        estornoId = novo.id;
      }
      await auditar(tx, null, "maquininha_estorno_conciliado", "estorno", estornoId,
        { pagamentoId, pedidoId, valorCentavos: delta, estornadoTotalCentavos: total });
    }
    if (Math.max(total, registrado) === pg.valorCentavos) {
      const encerrados = await tx.pedidoEstorno.updateMany({
        where: { tipo: "COMANDA", referenciaId: pg.id, meio: "MAQUININHA", status: { in: ["PENDENTE", "APROVADO", "FALHOU"] } },
        data: { status: "RECUSADO", motivoDecisao: "Conciliado por devoluções da Stone; não realizar nova devolução.", decididoEm: quando },
      });
      if (encerrados.count) await auditar(tx, null, "maquininha_estorno_pedidos_encerrados", "comanda", comandaId, { pagamentoId, pedidoId, quantidade: encerrados.count });
    }
    // O provedor pode devolver snapshot antigo. Nunca reduz valor já conciliado.
    const estornado = Math.max(pg.estornadoCentavos, total, registrado);
    // Primeiro retorno pode ser a devolução: o financeiro também precisa conservar o recebimento bruto.
    const pagoEm = pg.pagoEm ?? recebidoEm ?? quando;
    await tx.pagamentoComanda.update({ where: { id: pg.id }, data: {
      estornadoCentavos: estornado, estornadoEm: pg.estornadoEm ?? quando, pagoEm,
      ...(estornado === pg.valorCentavos ? { status: "CANCELADO" }
        : pg.status === "AGUARDANDO" ? { status: "PAGO" } : {}),
    } });
    if (!pg.pagoEm) await auditar(tx, null, "maquininha_recebimento_reconstituido", "comanda", comandaId,
      { pagamentoId, pedidoId, pagoEm: pagoEm.toISOString(), origemData: recebidoEm ? "PROVEDOR" : "DATA_DEVOLUCAO" });
  });
}
