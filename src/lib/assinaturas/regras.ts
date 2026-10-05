/**
 * Regras do plano de assinatura (funcoes puras, sem banco).
 *
 * Decide se um agendamento entra "pelo plano" (preco zero) ou nao, e por que.
 */

const DIA_MS = 86_400_000;

export type PlanoRegras = {
  nome: string;
  intervaloMinDias: number | null;
  maxAgendamentosAbertos: number;
  diasSemana: number[];
  descontoExtrasPct: number;
  servicos: { servicoId: string; usosPorCiclo: number | null }[];
  barbeiroIds: string[];
};

export type UsoDoPlano = { id: string; inicio: number; servicoId: string; futuro: boolean };

export type Avaliacao =
  | { cobre: true }
  | { cobre: false; motivo: string; codigo: "servico" | "barbeiro" | "dia" | "abertos" | "intervalo" | "limite_ciclo"; aPartirDe?: number };

const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/**
 * @param usos agendamentos ja feitos/marcados pelo plano (sem cancelados/faltas),
 *             exceto o que esta sendo remarcado.
 * @param cicloInicio inicio do ciclo pago atual (para usos por ciclo).
 */
export function avaliarUso(p: {
  plano: PlanoRegras;
  servicoId: string;
  barbeiroId: string;
  inicio: number;
  diaSemana: number;
  usos: UsoDoPlano[];
  cicloInicio: number | null;
}): Avaliacao {
  const { plano } = p;
  const cobertura = plano.servicos.find((s) => s.servicoId === p.servicoId);
  if (!cobertura) return { cobre: false, codigo: "servico", motivo: `Esse serviço não está incluído no ${plano.nome}.` };

  if (plano.barbeiroIds.length && !plano.barbeiroIds.includes(p.barbeiroId)) {
    return { cobre: false, codigo: "barbeiro", motivo: `Esse barbeiro não atende pelo ${plano.nome}.` };
  }

  if (plano.diasSemana.length && !plano.diasSemana.includes(p.diaSemana)) {
    const dias = [...plano.diasSemana].sort().map((d) => NOMES_DIA[d]).join(", ");
    return { cobre: false, codigo: "dia", motivo: `O ${plano.nome} vale só em: ${dias}.` };
  }

  const abertos = p.usos.filter((u) => u.futuro).length;
  if (abertos >= plano.maxAgendamentosAbertos) {
    return {
      cobre: false,
      codigo: "abertos",
      motivo:
        plano.maxAgendamentosAbertos === 1
          ? "Pelo plano dá para ter 1 horário marcado por vez. Depois desse atendimento você marca o próximo."
          : `Pelo plano dá para ter até ${plano.maxAgendamentosAbertos} horários marcados ao mesmo tempo.`,
    };
  }

  if (plano.intervaloMinDias) {
    const minimo = plano.intervaloMinDias * DIA_MS;
    // Distancia para qualquer uso (antes ou depois) precisa respeitar o intervalo.
    const perto = p.usos.find((u) => Math.abs(u.inicio - p.inicio) < minimo);
    if (perto) {
      const aPartirDe = perto.inicio + minimo;
      return {
        cobre: false,
        codigo: "intervalo",
        aPartirDe,
        motivo: `O ${plano.nome} permite um uso a cada ${plano.intervaloMinDias} dias.`,
      };
    }
  }

  if (cobertura.usosPorCiclo !== null && p.cicloInicio !== null) {
    const noCiclo = p.usos.filter((u) => u.servicoId === p.servicoId && u.inicio >= p.cicloInicio!).length;
    if (noCiclo >= cobertura.usosPorCiclo) {
      return { cobre: false, codigo: "limite_ciclo", motivo: `Você já usou os ${cobertura.usosPorCiclo} desse serviço no mês do plano.` };
    }
  }

  return { cobre: true };
}

/** Preco para assinante em servico fora do plano (desconto em extras). */
export function precoComDesconto(precoCentavos: number, descontoPct: number) {
  return Math.round((precoCentavos * (100 - Math.min(100, Math.max(0, descontoPct)))) / 100);
}

/**
 * O assinante pode usar o plano? Ativa, ou atrasada ha menos dias que a tolerancia
 * (contando da cobranca vencida mais antiga ainda em aberto).
 */
export function assinaturaValida(p: {
  status: "PENDENTE" | "ATIVA" | "ATRASADA" | "CANCELADA";
  vencimentoMaisAntigoEmAberto: number | null;
  toleranciaDias: number;
  agora: number;
}) {
  if (p.status === "ATIVA") return true;
  if (p.status !== "ATRASADA" || p.vencimentoMaisAntigoEmAberto === null) return false;
  // vencimento e uma data (00:00 UTC); tolerancia conta dias inteiros depois dele.
  return p.agora < p.vencimentoMaisAntigoEmAberto + (p.toleranciaDias + 1) * DIA_MS;
}

/** Proximo vencimento mensal: mesmo dia do mes seguinte (ou o ultimo dia, se o mes for mais curto). `diaOriginal` evita que 31 vire 28 para sempre. */
export function somarMes(dataIso: string, diaOriginal?: number): string {
  const [a, m, d] = dataIso.split("-").map(Number);
  const dia = diaOriginal ?? d;
  const ultimo = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m, Math.min(dia, ultimo))).toISOString().slice(0, 10);
}

/** Valida CPF (digitos verificadores). */
export function cpfValido(cpf: string) {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base: string, peso: number) => {
    const soma = [...base].reduce((t, c, i) => t + Number(c) * (peso - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10]);
}

export const mascararCpf = (cpf: string | null) => (cpf ? `***.${cpf.slice(3, 6)}.***-${cpf.slice(9)}` : null);
