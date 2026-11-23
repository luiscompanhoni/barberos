type AmbienteOferta = Readonly<Record<string, string | undefined>>;

/** Contratos existentes continuam operáveis em homologação quando as adesões são suspensas. */
export function ofertaDezembroEmHomologacao(env: AmbienteOferta = process.env) {
  return env.AMBIENTE === "homologacao";
}

export function planoBaseDezembroEmHomologacao(env: AmbienteOferta = process.env) {
  if (!ofertaDezembroEmHomologacao(env)) return null;
  const id = env.OFERTA_DEZEMBRO_PLANO_ID?.trim();
  return id && /^[a-zA-Z0-9_-]{1,40}$/.test(id) ? id : null;
}

function inteiroPositivo(texto?: string) {
  if (!texto || !/^\d{1,10}$/.test(texto)) return null;
  const valor = Number(texto);
  return valor > 0 && valor <= 2_147_483_647 ? valor : null;
}

export function lerConfigOfertaDezembro(env: AmbienteOferta = process.env) {
  if (env.OFERTA_DEZEMBRO_MODO !== "homologacao") return null;
  const planoId = planoBaseDezembroEmHomologacao(env);
  const vagas = inteiroPositivo(env.OFERTA_DEZEMBRO_VAGAS);
  const limiteUsos = inteiroPositivo(env.OFERTA_DEZEMBRO_LIMITE_USOS);
  if (!planoId || vagas === null || limiteUsos === null) return null;
  return { planoId, vagas, limiteUsos };
}
