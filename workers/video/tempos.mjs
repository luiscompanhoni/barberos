/** Mesma regra no aplicativo e no worker. Tolerância só para ponto flutuante. */
export function temposValidos(clipes) {
  const epsilon = 1e-7;
  return Array.isArray(clipes) && clipes.every(c => c && [c.inicio, c.fim].every(Number.isFinite) && c.inicio >= 0 && c.fim - c.inicio >= 0.1 - epsilon)
    && clipes.reduce((total, c) => total + c.fim - c.inicio, 0) <= 120 + epsilon;
}
