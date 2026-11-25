import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  cobranca: vi.fn(), assinatura: vi.fn(), clientes: vi.fn(), atual: vi.fn(), upsert: vi.fn(), auditar: vi.fn(), consultar: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const tx = { $executeRaw: vi.fn(), contratoCelcoin: { findUnique: m.atual, upsert: m.upsert } };
  return { db: {
    cobranca: { findUnique: m.cobranca }, assinatura: { findUnique: m.assinatura }, cliente: { findMany: m.clientes },
    $transaction: (f: (t: typeof tx) => unknown) => f(tx),
  } };
});
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
vi.mock("@/lib/pagamentos/celcash", () => ({ PREFIXO: { transacao: "celtx_", assinatura: "celsub_" }, consultarParcelaComContrato: m.consultar }));

import { FalhaSincronizacaoAssinatura } from "@/lib/assinaturas/eventos";
import { atualizarContratoExterno } from "@/lib/pagamentos/celcash-contratos";

const parcela = (extra: object = {}) => ({ id: "celtx_9", valorCentavos: 10800, vencimento: "2026-11-07", vencimentoConfirmado: true, status: "PAGA", pagaEm: Date.parse("2026-11-06T15:00:00Z"), ...extra });
const lida = (extra: object = {}) => ({ parcela: parcela(), statusCelcoin: "payedPix", contratoId: "77", titular: { cpf: "529.982.247-25", telefones: ["47988887777"] }, ...extra });
const salvo = { id: "77", clienteId: "cli", vinculo: "CPF", transacaoId: "9", valorCentavos: 10800, statusCelcoin: "payedPix", situacao: "PAGA", vencimento: new Date("2026-11-07T00:00:00Z"), pagoEm: new Date("2026-11-06T15:00:00Z") };

beforeEach(() => {
  vi.resetAllMocks();
  m.cobranca.mockResolvedValue(null);
  m.assinatura.mockResolvedValue(null);
  m.clientes.mockResolvedValue([{ id: "cli" }]);
  m.atual.mockResolvedValue(null);
  m.consultar.mockResolvedValue(lida());
});

describe("contratos da Celcoin que o BarberOS não emitiu", () => {
  it("grava a posição consultada na API e liga ao cliente pelo CPF", async () => {
    expect(await atualizarContratoExterno("celtx_9")).toBe(true);
    expect(m.clientes.mock.calls[0][0].where).toEqual({ excluidoEm: null, cpf: { in: ["52998224725", "529.982.247-25"] } });
    expect(m.upsert).toHaveBeenCalledWith({ where: { id: "77" }, create: salvo, update: { ...salvo, id: undefined } });
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), null, "contrato_celcoin_atualizado", "contrato_celcoin", "77", expect.objectContaining({ antes: null, vinculo: "CPF" }));
  });

  it("repetição do mesmo aviso não regrava nem registra de novo", async () => {
    m.atual.mockResolvedValue(salvo);
    expect(await atualizarContratoExterno("celtx_9")).toBe(true);
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.auditar).not.toHaveBeenCalled();
  });

  it("aviso de parcela antiga não sobrescreve a mais recente", async () => {
    m.atual.mockResolvedValue({ ...salvo, transacaoId: "10", vencimento: new Date("2026-12-07T00:00:00Z") });
    expect(await atualizarContratoExterno("celtx_9")).toBe(true);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("deixa com o fluxo de assinaturas o que foi emitido pelo BarberOS ou é avulso", async () => {
    m.cobranca.mockResolvedValueOnce({ id: "local" });
    expect(await atualizarContratoExterno("celtx_9")).toBe(false);
    expect(m.consultar).not.toHaveBeenCalled();
    m.assinatura.mockResolvedValueOnce({ id: "assinatura-local" });
    expect(await atualizarContratoExterno("celtx_9")).toBe(false);
    m.consultar.mockResolvedValueOnce(lida({ contratoId: null }));
    expect(await atualizarContratoExterno("celtx_9")).toBe(false);
    expect(await atualizarContratoExterno("pay_9")).toBe(false);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("sem CPF único usa o telefone; titular ambíguo ou desconhecido fica sem cliente", async () => {
    m.consultar.mockResolvedValue(lida({ titular: { cpf: "", telefones: ["4788887777"] } }));
    await atualizarContratoExterno("celtx_9");
    expect(m.clientes.mock.calls[0][0].where).toEqual({ excluidoEm: null, telefone: { in: ["554788887777", "5547988887777"] } });
    expect(m.upsert.mock.calls[0][0].create).toMatchObject({ clienteId: "cli", vinculo: "TELEFONE" });
    m.consultar.mockResolvedValue(lida());
    m.clientes.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await atualizarContratoExterno("celtx_9");
    expect(m.upsert.mock.calls[1][0].create).toMatchObject({ clienteId: null, vinculo: "AMBIGUO" });
    m.clientes.mockResolvedValue([]);
    await atualizarContratoExterno("celtx_9");
    expect(m.upsert.mock.calls[2][0].create).toMatchObject({ clienteId: null, vinculo: "SEM_VINCULO" });
  });

  it("Celcoin indisponível deixa o aviso para nova consulta; dado inconsistente vai para revisão", async () => {
    m.consultar.mockRejectedValueOnce(new Error("HTTP 503"));
    await expect(atualizarContratoExterno("celtx_9")).rejects.toMatchObject({ name: "FalhaSincronizacaoAssinatura", podeRetentar: true });
    m.consultar.mockResolvedValueOnce(lida({ parcela: parcela({ vencimentoConfirmado: false }) }));
    const erro = await atualizarContratoExterno("celtx_9").catch((e) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro).not.toBeInstanceOf(FalhaSincronizacaoAssinatura);
    expect(m.upsert).not.toHaveBeenCalled();
  });
});
