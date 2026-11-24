import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/clientes/[id]/conferencia-plano/route";
import { consultarConferenciaPlano } from "@/lib/clientes/conferencia-plano";
import { proibido } from "@/lib/erros";

const m = vi.hoisted(() => ({ cliente: vi.fn(), registro: vi.fn(), sessao: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { cliente: { findFirst: m.cliente }, auditoria: { findFirst: m.registro } } }));
vi.mock("@/lib/auth/sessao", () => ({ BALCAO: ["DONO", "GERENTE", "RECEPCAO"], exigirSessao: m.sessao }));
const foto = { dataCorte: "2025-11-24", contratos: [{ plano: "Corte", valorCentavos: 10800, vencimento: "2025-11-07", proximoVencimento: "2025-12-07", situacao: "PAGO_CELCOIN" }] };
const requisitar = () => GET(new Request("http://localhost/api/clientes/titular/conferencia-plano"), { params: Promise.resolve({ id: "titular" }) });

beforeEach(() => {
  vi.resetAllMocks();
  m.cliente.mockResolvedValue({ id: "titular" });
  m.registro.mockResolvedValue({ dados: foto });
});

describe("histórico de conciliação da recepção", () => {
  it("expõe o fato com seu corte, sem acesso, cobrança ou alteração de assinatura", async () => {
    const r = await requisitar();
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await r.json()).toEqual({ conferencia: foto });
    expect(m.sessao).toHaveBeenCalledWith(["DONO", "GERENTE", "RECEPCAO"]);
    expect(m.cliente).toHaveBeenCalledWith({ where: { id: "titular", excluidoEm: null }, select: { id: true } });
    expect(m.registro.mock.calls[0][0].where).toEqual({ entidade: "cliente", entidadeId: "titular", acao: "conferir_planos_celcoin" });
  });
  it("preserva a data de fim histórica mesmo depois do encerramento do ciclo", async () => {
    const dados = { ...foto, confirmacaoGerencial: { plano: "Corte", acessoAteInclusive: "2025-12-06" } };
    m.registro.mockResolvedValue({ dados });
    expect(await consultarConferenciaPlano("titular", "2026-01-10")).toEqual(dados);
  });
  it("bloqueia quem não tem acesso de balcão antes de consultar dados", async () => {
    m.sessao.mockRejectedValue(proibido());
    expect((await requisitar()).status).toBe(403);
    expect(m.cliente).not.toHaveBeenCalled();
    expect(m.registro).not.toHaveBeenCalled();
  });
  it("omite o histórico de cadastro excluído e trata a ausência de evento", async () => {
    m.cliente.mockResolvedValue(null);
    expect((await requisitar()).status).toBe(404);
    expect(m.registro).not.toHaveBeenCalled();
    m.registro.mockResolvedValue(null);
    expect(await consultarConferenciaPlano("titular", "2025-11-24")).toBeNull();
  });
  it("descarta corte futuro e registros que tentem declarar cobertura ou contrabando de campos", async () => {
    expect(await consultarConferenciaPlano("titular", "2025-11-23")).toBeNull();
    m.registro.mockResolvedValue({ dados: { ...foto, contratos: [{ ...foto.contratos[0], valida: true }] } });
    expect(await consultarConferenciaPlano("titular", "2025-12-01")).toBeNull();
  });
});
