/** A janela oficial começa no envio do cliente, mesmo se o webhook chegar depois. */
export function instanteDaEntradaCloud(timestamp: number, agora = Date.now()) {
  return Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= agora ? new Date(timestamp) : null;
}
