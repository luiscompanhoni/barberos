import { describe, expect, it } from "vitest";
import { assinaturaValida, avaliarUso, cpfValido, mascararCpf, precoComDesconto, somarMes, type PlanoRegras } from "@/lib/assinaturas/regras";

const DIA = 86_400_000;
const base = Date.parse("2026-10-06T13:00:00Z"); // terca

// Parecido com o plano Corte + Barba do CashBarber
const plano: PlanoRegras = {
  nome: "Plano Corte + Barba",
  intervaloMinDias: 15,
  maxAgendamentosAbertos: 1,
  diasSemana: [1, 2, 3, 4, 5, 6],
  descontoExtrasPct: 10,
  servicos: [
    { servicoId: "corte", usosPorCiclo: null },
    { servicoId: "barba", usosPorCiclo: 2 },
  ],
  barbeiroIds: [],
};
const ok = { plano, servicoId: "corte", barbeiroId: "joao", inicio: base, diaSemana: 2, usos: [], cicloInicio: base - 5 * DIA };

describe("avaliarUso", () => {
  it("cobre servico incluido em dia permitido sem usos", () => {
    expect(avaliarUso(ok)).toEqual({ cobre: true });
  });

  it("servico fora do plano nao cobre", () => {
    expect(avaliarUso({ ...ok, servicoId: "luzes" })).toMatchObject({ cobre: false, codigo: "servico" });
  });

  it("domingo fora dos dias do plano", () => {
    expect(avaliarUso({ ...ok, diaSemana: 0 })).toMatchObject({ cobre: false, codigo: "dia" });
  });

  it("barbeiro que nao atende o plano", () => {
    expect(avaliarUso({ ...ok, plano: { ...plano, barbeiroIds: ["pedro"] } })).toMatchObject({ codigo: "barbeiro" });
  });

  it("so um agendamento aberto por vez", () => {
    const usos = [{ id: "a", inicio: base + 20 * DIA, servicoId: "corte", futuro: true }];
    expect(avaliarUso({ ...ok, usos })).toMatchObject({ cobre: false, codigo: "abertos" });
  });

  it("respeita o intervalo minimo e diz a partir de quando pode", () => {
    const usos = [{ id: "a", inicio: base - 10 * DIA, servicoId: "corte", futuro: false }];
    const r = avaliarUso({ ...ok, usos });
    expect(r).toMatchObject({ cobre: false, codigo: "intervalo" });
    if (!r.cobre) expect(r.aPartirDe).toBe(base + 5 * DIA);
    // 15 dias depois ja pode
    expect(avaliarUso({ ...ok, usos: [{ ...usos[0], inicio: base - 15 * DIA }] })).toEqual({ cobre: true });
  });

  it("limite de usos por ciclo so conta o ciclo atual", () => {
    const planoSemIntervalo = { ...plano, intervaloMinDias: null, maxAgendamentosAbertos: 5 };
    const usos = [
      { id: "1", inicio: base - 40 * DIA, servicoId: "barba", futuro: false }, // ciclo anterior
      { id: "2", inicio: base - 3 * DIA, servicoId: "barba", futuro: false },
      { id: "3", inicio: base - 1 * DIA, servicoId: "barba", futuro: false },
    ];
    expect(avaliarUso({ ...ok, plano: planoSemIntervalo, servicoId: "barba", usos })).toMatchObject({ codigo: "limite_ciclo" });
    expect(avaliarUso({ ...ok, plano: planoSemIntervalo, servicoId: "barba", usos: usos.slice(0, 2) })).toEqual({ cobre: true });
  });
});

describe("assinaturaValida", () => {
  const venc = Date.parse("2026-10-05T00:00:00Z");
  it("ativa vale; pendente e cancelada nao", () => {
    expect(assinaturaValida({ status: "ATIVA", vencimentoMaisAntigoEmAberto: null, toleranciaDias: 3, agora: base })).toBe(true);
    expect(assinaturaValida({ status: "PENDENTE", vencimentoMaisAntigoEmAberto: null, toleranciaDias: 3, agora: base })).toBe(false);
    expect(assinaturaValida({ status: "CANCELADA", vencimentoMaisAntigoEmAberto: null, toleranciaDias: 3, agora: base })).toBe(false);
  });
  it("atrasada vale ate o fim da tolerancia", () => {
    const at = (agora: number) => assinaturaValida({ status: "ATRASADA", vencimentoMaisAntigoEmAberto: venc, toleranciaDias: 3, agora });
    expect(at(Date.parse("2026-10-08T23:00:00Z"))).toBe(true);
    expect(at(Date.parse("2026-10-09T00:00:01Z"))).toBe(false);
  });
});

describe("utilitarios", () => {
  it("desconto em extras", () => {
    expect(precoComDesconto(6500, 10)).toBe(5850);
    expect(precoComDesconto(6500, 0)).toBe(6500);
  });
  it("proximo vencimento mensal mantem o dia ou usa o ultimo do mes", () => {
    expect(somarMes("2026-10-15")).toBe("2026-11-15");
    expect(somarMes("2026-01-31")).toBe("2026-02-28");
    expect(somarMes("2026-02-28", 31)).toBe("2026-03-31");
    expect(somarMes("2026-12-10")).toBe("2027-01-10");
  });
  it("CPF", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("529.982.247-24")).toBe(false);
    expect(mascararCpf("52998224725")).toBe("***.982.***-25");
  });
});
