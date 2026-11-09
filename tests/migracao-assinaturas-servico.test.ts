import { createHash } from "node:crypto";
import type { MigracaoAssinatura } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";
import type { AcaoMigracao } from "@/lib/migracao-assinaturas/schemas";

const m = vi.hoisted(() => ({ buscar: vi.fn(), reler: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), auditar: vi.fn(), query: vi.fn(), executar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: async (fn: (tx: unknown) => unknown) => fn({
  $executeRaw: m.executar, $queryRaw: m.query,
  assinatura: { findUnique: m.buscar, findUniqueOrThrow: m.reler }, migracaoAssinatura: { create: m.criar, updateMany: m.atualizar },
}) } }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
import { registrarMigracao } from "@/lib/migracao-assinaturas/servico";

const sessao: Sessao = { usuarioId: "gerente", nome: "Teste", papel: "GERENTE", barbeiroId: null, clienteId: null };
function criarContrato() {
  return {
    id: "assinatura", planoId: "plano", precoCentavos: 11800, cicloInicio: new Date("2026-11-01T00:00:00Z") as Date | null,
    proximoVencimento: new Date("2026-12-01T00:00:00Z"), gatewayId: "celsub_origem", status: "ATIVA",
    plano: { nome: "Plano" }, cliente: { id: "cliente", nome: "Pessoa fictícia", aceitaMensagens: true, excluidoEm: null,
      conversa: null, _count: { assinaturas: 1 } }, migracao: null as MigracaoAssinatura | null,
  };
}
let assinatura = criarContrato();
function controle(estado = "A_CONFERIR"): MigracaoAssinatura {
  return { id: "controle", assinaturaId: "assinatura", fonteGatewayId: "celsub_origem", destinoGatewayId: null,
    estado, versao: 0, responsavelId: "gerente", evidencias: {}, adiadoAte: null,
    criadoEm: new Date("2026-11-08T12:00:00Z"), atualizadoEm: new Date("2026-11-08T12:00:00Z") };
}
function pedido(estado = "PRONTO" as "PRONTO" | "CONCLUIDO"): Extract<AcaoMigracao, { acao: "atualizar" }> {
  return {
    acao: "atualizar", assinaturaId: "assinatura", versao: 0, estado, destinoGatewayId: "sub_destino", adiadoAte: null,
    contrato: { planoId: "plano", precoCentavos: 11800, proximoVencimento: "2026-12-01", cicloInicio: "2026-11-01T00:00:00.000Z" },
    conferencia: { referencia: "REV-2026-001", contratoConciliado: true, rotaVerificada: true, vinculoNovoConfirmado: true,
      legadoInterrompido: true, consentimentoConfirmado: true, proximaCobrancaUnica: true },
  };
}
beforeEach(() => {
  vi.clearAllMocks(); assinatura = criarContrato();
  m.buscar.mockImplementation(async () => assinatura); m.reler.mockImplementation(async () => assinatura);
  m.executar.mockResolvedValue(1); m.query.mockResolvedValue([]); m.atualizar.mockResolvedValue({ count: 1 });
  m.criar.mockImplementation(async () => { assinatura.migracao = controle(); return assinatura.migracao; });
});

describe("controle de migração persistido", () => {
  it("recepção não pode registrar evidência gerencial", async () => {
    await expect(registrarMigracao({ ...sessao, papel: "RECEPCAO" }, { acao: "iniciar", assinaturaId: "assinatura" })).rejects.toMatchObject({ status: 403 });
    expect(m.buscar).not.toHaveBeenCalled();
  });
  it("iniciar repetidamente preserva um controle único e audita só uma criação", async () => {
    await registrarMigracao(sessao, { acao: "iniciar", assinaturaId: "assinatura" });
    await registrarMigracao(sessao, { acao: "iniciar", assinaturaId: "assinatura" });
    expect(m.criar).toHaveBeenCalledTimes(1); expect(m.auditar).toHaveBeenCalledTimes(1);
    expect(m.criar.mock.calls[0][0].data.fonteGatewayId).toBe("celsub_origem");
  });
  it("preserva contrato cancelado como histórico sem atualizar a assinatura", async () => {
    assinatura.status = "CANCELADA";
    const linha = await registrarMigracao(sessao, { acao: "iniciar", assinaturaId: "assinatura" });
    expect(linha.historicoCancelado).toBe(true); expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("versão alterada e ciclo alterado bloqueiam atualização", async () => {
    assinatura.migracao = { ...controle(), versao: 2 };
    await expect(registrarMigracao(sessao, pedido())).rejects.toMatchObject({ codigo: "migracao_alterada" });
    assinatura.migracao = controle(); assinatura.precoCentavos = 17800;
    await expect(registrarMigracao(sessao, pedido())).rejects.toMatchObject({ codigo: "contrato_alterado" });
    expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("atualização concorrente sem linha afetada não audita conclusão", async () => {
    assinatura.migracao = controle(); m.atualizar.mockResolvedValue({ count: 0 });
    await expect(registrarMigracao(sessao, pedido())).rejects.toMatchObject({ codigo: "migracao_alterada" });
    expect(m.auditar).not.toHaveBeenCalled();
  });
  it("múltiplos contratos e ausência de período pago não são concluídos", async () => {
    assinatura.migracao = controle("LEGADO_CONCILIADO"); assinatura.gatewayId = "sub_destino"; assinatura.cliente._count.assinaturas = 2;
    await expect(registrarMigracao(sessao, pedido("CONCLUIDO"))).rejects.toThrow(/mais de um contrato/);
    assinatura.cliente._count.assinaturas = 1;
    assinatura.cicloInicio = null;
    const p = pedido("CONCLUIDO"); p.contrato.cicloInicio = null;
    await expect(registrarMigracao(sessao, p)).rejects.toThrow(/período pago/);
    expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("registra a origem da evidência e aceita retry idêntico sem duplicar auditoria", async () => {
    assinatura.migracao = controle("LEGADO_CONCILIADO"); assinatura.gatewayId = "sub_destino";
    const p = pedido("CONCLUIDO");
    await registrarMigracao(sessao, p);
    const dados = m.atualizar.mock.calls[0][0].data;
    expect(dados.evidencias.modo).toBe("MANUAL_GERENCIA"); expect(dados.fonteGatewayId).toBe("celsub_origem");
    expect(m.auditar).toHaveBeenCalledTimes(1);
    assinatura.migracao = { ...assinatura.migracao!, estado: "CONCLUIDO", versao: 1,
      evidencias: { ...dados.evidencias, pedidoHash: createHash("sha256").update(JSON.stringify(p)).digest("hex") } };
    await registrarMigracao(sessao, p);
    expect(m.atualizar).toHaveBeenCalledTimes(1); expect(m.auditar).toHaveBeenCalledTimes(1);
  });
});
