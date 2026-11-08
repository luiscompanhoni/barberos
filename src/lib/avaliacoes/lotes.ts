import { competenciaResposta, MINIMO_AVALIACOES, quantidadePublicavel, type NotaCliente } from "./regras";

export type Periodos = Record<string, { quantidade: number; soma: number }>;
type Resposta = NotaCliente & { id: string; criadaEm: Date; publicada: boolean };

/** O histórico publicado é irreversível: não redistribui lotes nem reabre competências antigas. */
export function planejarLotes(respostas: Resposta[], periodosAnteriores: unknown) {
  const ordenadas = [...respostas].sort((a, b) => +a.criadaEm - +b.criadaEm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pendentes = ordenadas.filter(r => !r.publicada);
  const novas = pendentes.slice(0, quantidadePublicavel(pendentes.length));
  if (!novas.length) return null;
  const periodos: Periodos = {};
  if (!periodosAnteriores || typeof periodosAnteriores !== "object" || Array.isArray(periodosAnteriores)) {
    throw new Error("Histórico de avaliações inválido; a publicação requer conferência.");
  }
  for (const [mes, valor] of Object.entries(periodosAnteriores)) {
    const v = valor as Partial<Periodos[string]> | null;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || !v || typeof v.quantidade !== "number" || typeof v.soma !== "number"
      || !Number.isSafeInteger(v.quantidade) || !Number.isSafeInteger(v.soma) || v.quantidade < 0 || v.quantidade % MINIMO_AVALIACOES
      || v.soma < v.quantidade || v.soma > v.quantidade * 5) {
      throw new Error("Histórico de avaliações inválido; a publicação requer conferência.");
    }
    periodos[mes] = { quantidade: v.quantidade, soma: v.soma };
  }
  for (let i = 0; i < novas.length; i += MINIMO_AVALIACOES) {
    const lote = novas.slice(i, i + MINIMO_AVALIACOES);
    // As respostas de meses com pouca participação esperam juntas. A quinta libera o lote inteiro.
    const mes = competenciaResposta(lote[MINIMO_AVALIACOES - 1].criadaEm);
    const anterior = periodos[mes] ?? { quantidade: 0, soma: 0 };
    periodos[mes] = { quantidade: anterior.quantidade + lote.length, soma: anterior.soma + lote.reduce((s, r) => s + r.nota, 0) };
  }
  const ids = new Set(novas.map(r => r.id));
  return { ids: [...ids], periodos, publicadas: ordenadas.filter(r => r.publicada || ids.has(r.id)) };
}
