import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErroNegocio } from "@/lib/erros";
const m = vi.hoisted(() => ({ cliente: vi.fn(), grupo: vi.fn(), remarcar: vi.fn(), cfg: vi.fn(), humano: vi.fn(), nota: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { cliente: { findUnique: m.cliente }, agendamento: { findFirst: m.grupo }, barbeiro: { findUniqueOrThrow: async () => ({ nome: "Profissional" }) },
  $transaction: (fn: (tx: unknown) => unknown) => fn({ conversa: { update: m.humano }, mensagem: { create: m.nota } }),
} }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: m.cfg }));
vi.mock("@/lib/agenda/consultas", () => ({ horariosDisponiveis: vi.fn() }));
vi.mock("@/lib/agenda/cliente", () => ({ agendarPeloCliente: vi.fn(), cancelarPeloCliente: vi.fn(), confirmarPeloCliente: vi.fn(), proximosDoCliente: vi.fn(), remarcarPeloCliente: m.remarcar }));
vi.mock("@/lib/bot/ferramentas-assinatura", () => ({ executarAssinatura: vi.fn(), FERRAMENTAS_ASSINATURA: [], NOMES_ASSINATURA: new Set() }));
vi.mock("@/lib/bot/ferramentas-crescimento", () => ({ executarCrescimento: vi.fn(), FERRAMENTAS_CRESCIMENTO: [], NOMES_CRESCIMENTO: new Set() }));
vi.mock("@/lib/bot/ferramentas-pagamento", () => ({ executarPagamento: vi.fn(), FERRAMENTAS_PAGAMENTO: [], NOMES_PAGAMENTO: new Set() }));
vi.mock("@/lib/dominios", () => ({ urlSite: () => "https://cliente.example.test" }));
import { executarFerramenta } from "@/lib/bot/ferramentas";

const entrada = { agendamento_id: "ag", data: "2030-01-02", horario: "10:00", avulso: true };
const executar = () => executarFerramenta("remarcar_agendamento", entrada, { conversaId: "conversa", telefone: "5511999990000", nomePerfil: "Cliente" });
beforeEach(() => {
  vi.clearAllMocks(); m.cliente.mockResolvedValue({ id: "cliente" }); m.grupo.mockResolvedValue({ id: "ag" });
  m.cfg.mockResolvedValue({ fuso: "America/Sao_Paulo", agendaExternaAtiva: false });
  m.remarcar.mockResolvedValue({ id: "ag", barbeiroId: "b", assinaturaId: null, precoCentavos: 5000 });
});
describe("bot preserva aceite de preço em remarcações de grupo", () => {
  it("encaminha ao app sem inventar aceite ou alterar serviços", async () => {
    const r = await executar();
    expect(r.texto).toContain("conferir o valor total"); expect(r.texto).toContain("https://cliente.example.test/c");
    expect(r.texto).toContain("agendamento atual foi mantido"); expect(r.erro).toBe(true);
    expect(m.remarcar).not.toHaveBeenCalled(); expect(m.humano).not.toHaveBeenCalled();
    expect(m.grupo).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "ag", clienteId: "cliente", adicionalDeId: null }) }));
  });
  it("com Cash Barber ativo mantém encaminhamento à equipe, sem confirmar remarcação", async () => {
    m.cfg.mockResolvedValue({ fuso: "America/Sao_Paulo", agendaExternaAtiva: true });
    const r = await executar();
    expect(r.passouParaHumano).toBe(true); expect(r.texto).toContain("Não confirme reserva, remarcação ou cancelamento");
    expect(m.humano).toHaveBeenCalledWith({ where: { id: "conversa" }, data: { estado: "HUMANO" } });
    expect(m.remarcar).not.toHaveBeenCalled();
  });
  it("preserva remarcação simples sem sessão e sem fabricar preço esperado", async () => {
    m.grupo.mockResolvedValue(null);
    const r = await executar();
    expect(r.texto).toContain("Remarcado");
    expect(m.remarcar).toHaveBeenCalledWith("cliente", "ag", new Date("2030-01-02T13:00:00Z"), undefined, true);
  });
  it("não fornece detalhes ou instrução de grupo de outro titular", async () => {
    m.grupo.mockResolvedValue(null); m.remarcar.mockRejectedValue(new ErroNegocio("Agendamento não encontrado.", 404));
    const r = await executar();
    expect(r.texto).toBe("Agendamento não encontrado."); expect(r.texto).not.toContain("https://");
  });
});
