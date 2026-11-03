import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { checarConfirmacaoAutomatica, checarTransicaoNaReserva, contatoParaConfirmacao } from "@/lib/agenda/transicao";
import { promptSistema } from "@/lib/bot/prompt";

describe("convivência com a agenda externa", () => {
  it("não apresenta disponibilidade local como confirmação da agenda externa", () => {
    expect(() => checarConfirmacaoAutomatica({ agendaExternaAtiva: true })).toThrow(expect.objectContaining({ codigo: "confirmacao_equipe", status: 409 }));
    expect(() => checarConfirmacaoAutomatica({ agendaExternaAtiva: false })).not.toThrow();
  });
  it("relê a decisão dentro da transação, depois da trava compartilhada", async () => {
    const ordem: string[] = [];
    const tx = {
      $executeRaw: vi.fn(async () => { ordem.push("trava"); }),
      configuracao: { findUnique: vi.fn(async () => { ordem.push("configuracao"); return { agendaExternaAtiva: true }; }) },
    } as unknown as Prisma.TransactionClient;
    await expect(checarTransicaoNaReserva(tx)).rejects.toMatchObject({ codigo: "confirmacao_equipe" });
    expect(ordem).toEqual(["trava", "configuracao"]);
  });
  it("mantém o modo local sem transição ativada", async () => {
    const tx = { $executeRaw: vi.fn(async () => 1), configuracao: { findUnique: vi.fn(async () => ({ agendaExternaAtiva: false })) } } as unknown as Prisma.TransactionClient;
    await expect(checarTransicaoNaReserva(tx)).resolves.toBeUndefined();
  });
  it("orienta o bot a encaminhar a confirmação, sem alegar uma integração ativa", () => {
    const p = promptSistema({ nomeBarbearia: "Black", endereco: null, antecedenciaMinimaMin: 60, prazoCancelamentoMin: 120, janelaAgendamentoDias: 30, agendaExternaAtiva: true });
    expect(p).toContain("Para qualquer pedido de agenda, use chamar_atendente");
    expect(p).toContain("Não diga que houve sincronização automática.");
  });
  it("não cria um contato falso quando não há número público configurado", () => {
    expect(contatoParaConfirmacao(undefined)).toBeNull();
    expect(contatoParaConfirmacao("javascript:alert(1)")).toBeNull();
    expect(contatoParaConfirmacao("+55 (11) 90000-0000")).toMatch(/^https:\/\/wa.me\/5511900000000\?text=/);
  });
});
