/** A janela oficial começa no envio do cliente, mesmo se o webhook chegar depois. */
export function instanteDaEntradaCloud(timestamp: number, agora = Date.now()) {
  return Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= agora ? new Date(timestamp) : null;
}

/** Um webhook fora de ordem não toma o turno de uma mensagem mais nova. */
export function entradaCloudSuperada(timestamp: number, ultimaEntradaEm: Date | null) {
  return !!ultimaEntradaEm && (instanteDaEntradaCloud(timestamp)?.getTime() ?? 0) < +ultimaEntradaEm;
}
