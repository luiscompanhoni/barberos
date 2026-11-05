import { beforeEach, expect, it, vi } from "vitest";
import type { Agendamento, Prisma } from "@prisma/client";
const m = vi.hoisted(() => ({ servico: vi.fn(), precificar: vi.fn() }));
vi.mock("@/lib/agenda/carregar", () => ({ servicoDoBarbeiro: m.servico }));
vi.mock("@/lib/assinaturas/agenda", () => ({ precificar: m.precificar }));
import { revalidarCoberturaEquipe } from "@/lib/agenda/cobertura-equipe";
const tx = {} as Prisma.TransactionClient;
const ag = { id: "ag", clienteId: "c", servicoId: "corte", assinaturaId: "assinatura", precoCentavos: 0 } as Agendamento;
const destino = { barbeiroId: "b", inicio: Date.now() + 86_400_000, fuso: "America/Sao_Paulo" };
beforeEach(() => { vi.clearAllMocks(); m.servico.mockResolvedValue({ precoCentavos: 5000 }); m.precificar.mockResolvedValue({ assinaturaId: "assinatura", precoCentavos: 0 }); });
it("revalida cobertura no destino, dentro da transação e sem aceite avulso inventado", async () => {
  await revalidarCoberturaEquipe(tx, ag, destino);
  expect(m.precificar).toHaveBeenCalledWith({ clienteId: "c", servicoId: "corte", barbeiroId: "b", inicio: destino.inicio,
    precoBase: 5000, fuso: destino.fuso, ignorarAgendamentoId: "ag", c: tx });
});
it.each([{ assinaturaId: null, precoCentavos: 5000 }, { assinaturaId: "outra", precoCentavos: 0 }])("cobertura alterada não vira nova cobrança silenciosa %#", async (p) => {
  m.precificar.mockResolvedValue(p);
  await expect(revalidarCoberturaEquipe(tx, ag, destino)).rejects.toMatchObject({ codigo: "cobertura_alterada" });
});
it("regra de uso esgotada continua bloqueando a reativação", async () => {
  m.precificar.mockRejectedValue(new Error("Limite de usos"));
  await expect(revalidarCoberturaEquipe(tx, ag, destino)).rejects.toThrow("Limite de usos");
});
