export const REGRA_INDICACAO_ASSINATURA = "ASSINATURA_V2";
export const PREMIO_INDICADOR = 2000;
export const PREMIO_INDICADO = 1000;
export const VALIDADE_INDICACAO_DIAS = 30;
const DIA = 86_400_000;

export function indicacaoAssinaturaHabilitada() {
  return process.env.INDICACAO_ASSINATURA_V2_ATIVA === "true";
}

/** O teto é financeiro, não autorização. Sem valor explícito não se assume verba. */
export function limiteIndicacaoAssinatura() {
  const raw = process.env.INDICACAO_ASSINATURA_LIMITE_CENTAVOS;
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const valor = Number(raw);
  return Number.isSafeInteger(valor) ? valor : 0;
}

export type ContratoElegibilidade = {
  status: string; canceladaEm: Date | null; encerraEm: Date | null;
};

/** Não ter visita não prova que nunca assinou; falta de data exige conferência. */
export function elegivelIndicacaoAssinatura(contratos: ContratoElegibilidade[], agora: Date) {
  if (!Number.isFinite(+agora)) return false;
  return contratos.every((a) => {
    if (a.status !== "CANCELADA") return false;
    const datas = [a.canceladaEm, a.encerraEm].filter((d): d is Date => d !== null).map((d) => +d);
    const fim = datas.length ? Math.max(...datas) : NaN;
    return Number.isFinite(fim) && fim <= +agora - 90 * DIA;
  });
}

export function validadeIndicacao(agora: Date) {
  return new Date(+agora + VALIDADE_INDICACAO_DIAS * DIA);
}
