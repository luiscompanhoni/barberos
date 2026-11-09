import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ cliente: vi.fn(), premios: vi.fn(), convite: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { cliente: { findUnique: m.cliente }, premioGanho: { findMany: m.premios }, campanhaEnvio: { findFirst: m.convite } } }));
vi.mock("@/lib/dominios", () => ({ urlSite: () => "https://cliente.example.test" }));
import { presentesDaConversa } from "@/lib/bot/presentes";
const agora = Date.parse("2026-11-08T15:00:00Z");
beforeEach(() => {
  vi.clearAllMocks(); m.cliente.mockResolvedValue({ id: "proprio", excluidoEm: null }); m.premios.mockResolvedValue([]); m.convite.mockResolvedValue(null);
});
describe("presentes no atendimento", () => {
  it("consulta somente o cliente identificado pelo telefone, sem aceitar outro ID", async () => {
    m.premios.mockResolvedValue([{ rotulo: "Presente real", codigo: "BB-TESTE", status: "DISPONIVEL", expiraEm: new Date(agora + 1000), agendamentoId: null }]);
    const r = await presentesDaConversa("telefone-do-teste", agora);
    expect(m.cliente).toHaveBeenCalledWith({ where: { telefone: "telefone-do-teste" }, select: { id: true, excluidoEm: true } });
    expect(m.premios.mock.calls[0][0].where).toEqual({ clienteId: "proprio" });
    expect(m.convite.mock.calls[0][0].where.clienteId).toBe("proprio");
    expect(r.premios[0].rotulo).toBe("Presente real"); expect(r.convite).toBeNull();
  });
  it("não oferece presente vencido nem transforma utilizado em disponível", async () => {
    m.premios.mockResolvedValue([
      { rotulo: "Antigo", status: "DISPONIVEL", expiraEm: new Date(agora - 1) },
      { rotulo: "Resgatado", status: "UTILIZADO", expiraEm: new Date(agora - 1) },
    ]);
    expect((await presentesDaConversa("t", agora)).premios.map(p => p.status)).toEqual(["EXPIRADO", "UTILIZADO"]);
  });
  it("não consulta prêmios de cadastro excluído", async () => {
    m.cliente.mockResolvedValue({ id: "excluido", excluidoEm: new Date() });
    expect((await presentesDaConversa("t", agora)).premios).toEqual([]); expect(m.premios).not.toHaveBeenCalled();
  });
  it("oferece apenas convite vigente já enviado, sem gerar outra jogada", async () => {
    const convite = { token: "teste", jogadaId: "ja-jogou", enviadoEm: new Date(agora), campanha: { nome: "Piloto", jogo: { ativo: true, inicioEm: null, fimEm: null, validadeDias: 2 } } };
    m.convite.mockResolvedValue(convite);
    expect((await presentesDaConversa("t", agora)).convite).toEqual({ campanha: "Piloto", link: "https://cliente.example.test/c/r/teste", ja_jogou: true });
    m.convite.mockResolvedValue({ ...convite, enviadoEm: new Date(agora - 3 * 86_400_000) });
    expect((await presentesDaConversa("t", agora)).convite).toBeNull();
  });
});
