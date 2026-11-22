import type { Prisma } from "@prisma/client";
import { idModeloSegmento } from "@/lib/campanhas/modelos-segmento";
import type { SegmentoLeonel } from "./jornada-leonel";
import { ErroNegocio } from "@/lib/erros";
import { noAr } from "@/lib/jogos/motor";

/** Reserva o link individual fora da fila de disparos. Só abre depois que o WhatsApp aceita a mensagem. */
export async function reservarRoletaLeonel(tx: Prisma.TransactionClient, segmento: SegmentoLeonel, clienteId: string, token: string) {
  const campanhaId = idModeloSegmento(segmento);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campanha:${campanhaId}`}))`;
  const campanha = await tx.campanha.findUnique({
    where: { id: campanhaId }, include: { jogo: { include: { premios: { where: { ativo: true, chanceBps: { gt: 0 } } } } } },
  });
  const jogo = campanha?.jogo;
  if (!campanha || campanha.status === "ENCERRADA" || !jogo || jogo.tipo !== "ROLETA" || !noAr(jogo) || jogo.soAssinante) {
    throw new ErroNegocio("Configure uma roleta ativa para este segmento em Campanhas antes de enviar o convite.", 409);
  }
  if (jogo.premios.some(p => p.tipo === "NADA") || !jogo.premios.some(p => p.estoque === null && p.limiteMensal === null)) {
    throw new ErroNegocio("A roleta deste convite precisa ter prêmio em todas as jogadas e uma opção disponível para todos os convidados.", 409);
  }
  if (await tx.campanhaEnvio.findUnique({ where: { campanhaId_clienteId: { campanhaId, clienteId } }, select: { id: true } })) {
    throw new ErroNegocio("Já existe um envio desta campanha para o cliente. Confira o histórico.", 409);
  }
  await tx.campanhaEnvio.create({ data: { campanhaId, clienteId, token, lote: 0, status: "PULADO" } });
}
