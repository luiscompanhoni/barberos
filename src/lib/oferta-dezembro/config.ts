import { ehHomologacao } from "@/lib/ambiente";

type AmbienteOferta = Readonly<Record<string, string | undefined>>;

export function ofertaDezembroEmHomologacao(env?: AmbienteOferta) {
  return (env ? env.AMBIENTE === "homologacao" : ehHomologacao()) &&
    (env ?? process.env).OFERTA_DEZEMBRO_MODO === "homologacao";
}

function inteiroPositivo(texto?: string) {
  if (!texto || !/^\d{1,10}$/.test(texto)) return null;
  const valor = Number(texto);
  return valor > 0 && valor <= 2_147_483_647 ? valor : null;
}

export function lerConfigOfertaDezembro(env: AmbienteOferta = process.env) {
  if (!ofertaDezembroEmHomologacao(env)) return null;
  const planoId = env.OFERTA_DEZEMBRO_PLANO_ID?.trim();
  const vagas = inteiroPositivo(env.OFERTA_DEZEMBRO_VAGAS);
  const limiteUsos = inteiroPositivo(env.OFERTA_DEZEMBRO_LIMITE_USOS);
  if (!planoId || !/^[a-zA-Z0-9_-]{1,40}$/.test(planoId) || vagas === null || limiteUsos === null) return null;
  return { planoId, vagas, limiteUsos };
}
