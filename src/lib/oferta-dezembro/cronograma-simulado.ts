import { instanteLocal } from "@/lib/agenda/tempo";
import { somarMes } from "@/lib/assinaturas/regras";
import { CRONOGRAMA_DEZEMBRO } from "./regras";

const FUSO = "America/Sao_Paulo";
const inicioDoCiclo = (dia: string) => instanteLocal(dia, 0, FUSO);

/** Ensaia o início futuro da Pagar.me em memória. Não registra faturas ou recebimentos. */
export function projetarRecorrenciaSimuladaDezembro(
  precoCentavos: number,
  agora: Date,
  canceladaEm: Date | null = null,
) {
  const startAt = new Date(inicioDoCiclo(CRONOGRAMA_DEZEMBRO.primeiroDebito));
  const ate = canceladaEm ? Math.min(+agora, +canceladaEm - 1) : +agora;
  const ciclosSimulados = [];
  for (let competencia: string = CRONOGRAMA_DEZEMBRO.primeiroDebito; ; competencia = somarMes(competencia)) {
    const debitoEm = inicioDoCiclo(competencia);
    if (!(debitoEm <= ate)) break;
    ciclosSimulados.push({
      competencia, debitoEm: new Date(debitoEm).toISOString(), valorCentavos: precoCentavos,
      fidelidade: competencia < CRONOGRAMA_DEZEMBRO.fimFidelidade,
    });
  }
  return { start_at: startAt.toISOString(), payment_method: "credit_card" as const, ciclosSimulados };
}
