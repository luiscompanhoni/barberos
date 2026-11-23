import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ situacao: vi.fn(), usos: vi.fn() }));
vi.mock("@/lib/assinaturas/servico", () => ({ situacaoDoCliente: m.situacao }));
vi.mock("@/lib/db", () => ({ db: { agendamento: { findMany: m.usos } } }));

import { precificar } from "@/lib/assinaturas/agenda";

const dezembro = Date.parse("2026-12-04T16:00:00-03:00");
const p = { clienteId: "cliente", servicoId: "corte", barbeiroId: "profissional", inicio: dezembro, precoBase: 5000, fuso: "America/Sao_Paulo" };
const avulso = { assinaturaId: null, precoCentavos: 5000, nota: null };

beforeEach(() => {
  vi.stubEnv("AMBIENTE", "homologacao");
  vi.stubEnv("OFERTA_DEZEMBRO_ATIVA", "true");
  vi.stubEnv("OFERTA_DEZEMBRO_MODO", "homologacao");
  m.usos.mockReset().mockResolvedValue([]);
  m.situacao.mockReset().mockResolvedValue({
    valida: false,
    assinatura: {
      id: "assinatura", status: "ATIVA", cicloInicio: new Date("2026-12-01T03:00:00Z"),
      ofertaDezembro: { aceitaEm: new Date("2026-11-22T03:00:00Z"), limiteUsos: 1 },
      plano: {
        nome: "Plano base", maxAgendamentosAbertos: 3, intervaloMinDias: null, diasSemana: [], barbeiros: [],
        descontoExtrasPct: 100,
        servicos: [{ servicoId: "corte", usosPorCiclo: 2 }, { servicoId: "barba", usosPorCiclo: null }],
      },
    },
  });
});

describe("precificação de uma adesão simulada", () => {
  it("permite pré-reservar dezembro e cobra avulso em novembro, janeiro e fora da homologação", async () => {
    expect(await precificar(p)).toMatchObject({ precoCentavos: 0, assinaturaId: "assinatura" });
    expect(await precificar({ ...p, inicio: Date.parse("2026-12-01T02:59:59Z") })).toEqual(avulso);
    expect(await precificar({ ...p, inicio: Date.parse("2027-01-01T03:00:00Z") })).toEqual(avulso);
    vi.stubEnv("OFERTA_DEZEMBRO_ATIVA", "false");
    expect(await precificar(p)).toEqual(avulso);
    vi.stubEnv("OFERTA_DEZEMBRO_ATIVA", "true");
    vi.stubEnv("AMBIENTE", "producao");
    expect(await precificar(p)).toEqual(avulso);
  });

  it("não aplica desconto do plano em serviço extra ou além do limite compartilhado", async () => {
    expect(await precificar({ ...p, servicoId: "extra" })).toEqual(avulso);
    const usosExtras = [{ id: "item-1", inicio: dezembro, servicoId: "barba", futuro: true }];
    await expect(precificar({ ...p, usosExtras })).rejects.toMatchObject({
      codigo: "regra_plano", detalhes: { precoAvulso: 5000, codigoRegra: "limite_oferta" },
    });
    expect(await precificar({ ...p, usosExtras, forcarAvulso: true })).toEqual(avulso);
  });

  it("ignora o próprio horário na remarcação e conta os serviços já vinculados", async () => {
    m.usos.mockResolvedValue([{ id: "usado", inicio: new Date(dezembro), servicoId: "barba", status: "CONCLUIDO" }]);
    await expect(precificar(p)).rejects.toMatchObject({ detalhes: { codigoRegra: "limite_oferta" } });
    m.usos.mockResolvedValue([]);
    expect(await precificar({ ...p, ignorarAgendamentoId: "usado" })).toMatchObject({ assinaturaId: "assinatura" });
    expect(m.usos).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { notIn: ["usado"] }, status: { not: "CANCELADO" } }),
    }));
  });
});
