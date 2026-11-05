import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ ag: vi.fn(), horarios: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirCliente: async () => ({ clienteId: "c" }) }));
vi.mock("@/lib/db", () => ({ db: { agendamento: { findFirst: m.ag } } }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo", janelaAgendamentoDias: 30 }) }));
vi.mock("@/lib/agenda/consultas", () => ({ horariosDisponiveis: m.horarios }));
import { GET } from "@/app/api/cliente/disponibilidade/route";
const req = (params = "") => new Request(`http://localhost/api/cliente/disponibilidade?data=2026-11-05&servicoId=corte&adicionais=barba${params}`);
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T12:00Z"));
  m.ag.mockResolvedValue({ servicoId: "corte", adicionais: [{ servicoId: "barba" }] }); m.horarios.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());
describe("disponibilidade ao remarcar", () => {
  it("exclui apenas agendamento do próprio cliente após conferir serviços", async () => {
    expect((await GET(req("&remarcar=ag"))).status).toBe(200);
    expect(m.ag).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "ag", clienteId: "c", adicionalDeId: null }) }));
    expect(m.horarios).toHaveBeenCalledWith(expect.objectContaining({ ignorarAgendamentoId: "ag", servicosAdicionais: ["barba"] }));
  });
  it("não permite ignorar reserva alheia nem alterar serviços na URL", async () => {
    m.ag.mockResolvedValueOnce(null);
    expect((await GET(req("&remarcar=outro"))).status).toBe(404); expect(m.horarios).not.toHaveBeenCalled();
    m.ag.mockResolvedValueOnce({ servicoId: "corte", adicionais: [] });
    expect((await GET(req("&remarcar=ag"))).status).toBe(409); expect(m.horarios).not.toHaveBeenCalled();
  });
  it("novo agendamento não ignora nenhuma reserva", async () => {
    expect((await GET(req())).status).toBe(200); expect(m.ag).not.toHaveBeenCalled();
    expect(m.horarios).toHaveBeenCalledWith(expect.objectContaining({ ignorarAgendamentoId: undefined }));
  });
});
