import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ ler: vi.fn(), atualizar: vi.fn(), auditar: vi.fn(), transacao: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { servico: { findUnique: m.ler }, $transaction: m.transacao } }));
vi.mock("@/lib/auditoria", () => ({ auditarMudanca: m.auditar }));
import { consultarEtiquetasServico, salvarEtiquetasServico } from "@/lib/servicos/etiquetas-servico";

const etiquetas = [{ texto: "Destaque", cor: "#F9CB30", formato: "PILULA" }];
const tx = { servico: { findUnique: m.ler, updateMany: m.atualizar } };
beforeEach(() => {
  vi.clearAllMocks();
  m.ler.mockResolvedValue({ nome: "Corte", etiquetas: [], etiquetasVersao: 3 });
  m.atualizar.mockResolvedValue({ count: 1 }); m.auditar.mockResolvedValue(undefined);
  m.transacao.mockImplementation(fn => fn(tx));
});

describe("persistência auditável das etiquetas", () => {
  it("altera só etiquetas e versão, com auditoria na mesma transação", async () => {
    expect(await salvarEtiquetasServico("corte", "gerente", { etiquetas, versao: 3 })).toEqual({ etiquetas, versao: 4 });
    expect(m.atualizar).toHaveBeenCalledWith({ where: { id: "corte", etiquetasVersao: 3 }, data: { etiquetas, etiquetasVersao: { increment: 1 } } });
    expect(m.auditar).toHaveBeenCalledWith(tx, "gerente", "alterar_etiquetas", "servico", "corte", { etiquetas: [] }, { etiquetas }, { servico: "Corte" });
  });
  it("recusa editor desatualizado antes da escrita", async () => {
    await expect(salvarEtiquetasServico("corte", "gerente", { etiquetas, versao: 2 })).rejects.toMatchObject({ status: 409, codigo: "etiquetas_desatualizadas" });
    expect(m.atualizar).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });
  it("recusa corrida concorrente entre leitura e escrita sem auditar alteração inexistente", async () => {
    m.atualizar.mockResolvedValue({ count: 0 });
    await expect(salvarEtiquetasServico("corte", "gerente", { etiquetas, versao: 3 })).rejects.toMatchObject({ status: 409 });
    expect(m.auditar).not.toHaveBeenCalled();
  });
  it("propaga falha de auditoria para impedir commit da transação", async () => {
    m.auditar.mockRejectedValue(new Error("Auditoria indisponível"));
    await expect(salvarEtiquetasServico("corte", "gerente", { etiquetas, versao: 3 })).rejects.toThrow("Auditoria indisponível");
  });
  it("permite remover todas e mantém serviço inexistente como 404", async () => {
    m.ler.mockResolvedValueOnce({ nome: "Corte", etiquetas, etiquetasVersao: 3 });
    expect(await salvarEtiquetasServico("corte", "gerente", { etiquetas: [], versao: 3 })).toEqual({ etiquetas: [], versao: 4 });
    m.ler.mockResolvedValue(null);
    await expect(consultarEtiquetasServico("ausente")).rejects.toMatchObject({ status: 404 });
    await expect(salvarEtiquetasServico("ausente", "gerente", { etiquetas, versao: 3 })).rejects.toMatchObject({ status: 404 });
  });
  it("consulta contrato editável e não grava nem audita quando nada mudou", async () => {
    expect(await consultarEtiquetasServico("corte")).toEqual({ etiquetas: [], versao: 3 });
    expect(await salvarEtiquetasServico("corte", "gerente", { etiquetas: [], versao: 3 })).toEqual({ etiquetas: [], versao: 3 });
    expect(m.atualizar).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
  });
  it("permite limpar um valor inválido sem preservá-lo como se fosse uma lista vazia", async () => {
    m.ler.mockResolvedValue({ nome: "Corte", etiquetas: { invalido: true }, etiquetasVersao: 3 });
    expect(await salvarEtiquetasServico("corte", "gerente", { etiquetas: [], versao: 3 })).toEqual({ etiquetas: [], versao: 4 });
    expect(m.atualizar).toHaveBeenCalled(); expect(m.auditar).toHaveBeenCalled();
  });
  it("recusa campos financeiros e versão ausente antes do banco", async () => {
    await expect(salvarEtiquetasServico("corte", "gerente", { etiquetas, versao: 3, precoCentavos: 0 })).rejects.toThrow();
    await expect(salvarEtiquetasServico("corte", "gerente", { etiquetas })).rejects.toThrow();
    expect(m.transacao).not.toHaveBeenCalled();
  });
});
