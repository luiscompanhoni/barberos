/**
 * Limite de requisicoes em memoria (um servidor so): janela deslizante por chave (cliente, IP...).
 * Protege rotas publicas e de jogo contra repeticao em massa; a regra de negocio continua no banco.
 */
import { ErroNegocio } from "@/lib/erros";

const batidas = new Map<string, number[]>();
let limpeza = 0;

/** Lanca 429 se `chave` passou de `max` chamadas nos ultimos `janelaMs`. */
export function limitar(chave: string, max: number, janelaMs: number, agora = Date.now()) {
  const desde = agora - janelaMs;
  const lista = (batidas.get(chave) ?? []).filter((t) => t > desde);
  if (lista.length >= max) {
    batidas.set(chave, lista);
    throw new ErroNegocio("Muitas tentativas seguidas. Espere um pouco e tente de novo.", 429, "limite");
  }
  lista.push(agora);
  batidas.set(chave, lista);
  // De vez em quando joga fora as chaves paradas (memoria nao cresce sem fim).
  if (agora - limpeza > 60_000) {
    limpeza = agora;
    for (const [k, v] of batidas) if (!v.some((t) => t > agora - 3_600_000)) batidas.delete(k);
  }
}

/** Zera os contadores (testes). */
export const _zerarLimites = () => batidas.clear();
