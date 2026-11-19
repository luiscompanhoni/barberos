const g = globalThis as unknown as { filaConversas?: Map<string, Promise<unknown>> };
const filas = (g.filaConversas ??= new Map());

export const temTurnoNaFila = (telefone: string) => filas.has(telefone);

export function naFila<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const anterior = filas.get(chave) ?? Promise.resolve();
  const atual = anterior.catch(() => {}).then(fn);
  filas.set(chave, atual);
  atual.finally(() => { if (filas.get(chave) === atual) filas.delete(chave); }).catch(() => {});
  return atual;
}
