export const ATRASO_LEMBRETE_MS = 2 * 60 * 60 * 1000;
export const VALIDADE_LEMBRETE_MS = 24 * 60 * 60 * 1000;
export const INTERVALO_NOVO_LEMBRETE_MS = 7 * 24 * 60 * 60 * 1000;

export function lembreteAgendamentoDevido(
  registro: { consentiuEm: Date; ultimaAcaoEm: Date; canceladoEm: Date | null },
  agora: number,
) {
  const atraso = agora - +registro.ultimaAcaoEm;
  return !registro.canceladoEm &&
    +registro.consentiuEm <= +registro.ultimaAcaoEm &&
    atraso >= ATRASO_LEMBRETE_MS && atraso <= VALIDADE_LEMBRETE_MS;
}
