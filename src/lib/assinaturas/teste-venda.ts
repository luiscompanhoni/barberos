/** Homologação nominal: não altera o catálogo nem concede preço promocional à base. */
type Identidade = { clienteId: string; planoId: string; precoCentavos: number };

function configurado() {
  const clienteId = process.env.ASSINATURA_TESTE_CLIENTE_ID?.trim();
  const planoId = process.env.ASSINATURA_TESTE_PLANO_ID?.trim();
  return clienteId && planoId ? { clienteId, planoId } : null;
}

export function ofertaTesteVenda(agora = Date.now()) {
  const cfg = configurado();
  const ate = Date.parse(process.env.ASSINATURA_TESTE_ATE ?? "");
  return cfg && Number.isFinite(ate) && agora < ate ? cfg : null;
}

export function planoReservadoParaTeste(planoId: string) {
  return configurado()?.planoId === planoId;
}

export function autorizaOfertaTeste(plano: { id: string; precoCentavos: number; visivel: boolean } | null, origem?: string, clienteId?: string) {
  const teste = ofertaTesteVenda();
  return !!plano && origem === "BOT" && teste?.clienteId === clienteId && teste?.planoId === plano.id && plano.precoCentavos === 100 && !plano.visivel;
}

/** O limite de um ciclo continua valendo mesmo depois de expirar a oferta. */
export function assinaturaTesteUnico(a: Identidade) {
  const cfg = configurado();
  return !!cfg && a.clienteId === cfg.clienteId && a.planoId === cfg.planoId && a.precoCentavos === 100;
}
