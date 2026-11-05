import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), criar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ exigirSessao: m.sessao }));
vi.mock("@/lib/agenda/agendamentos", () => ({ criarAgendamento: m.criar }));
import { POST } from "@/app/api/agendamentos/route";
import { ErroNegocio } from "@/lib/erros";

const ator = { usuarioId: "recepcao-teste", papel: "RECEPCAO" };
const dados = { barbeiroId: "barbeiro", servicoId: "corte", cliente: { id: "cliente" }, inicio: "2031-02-02T12:00:00.000Z" };
const req = (body: unknown) => new Request("http://localhost/api/agendamentos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); m.sessao.mockResolvedValue(ator); m.criar.mockResolvedValue({ id: "agendamento" }); });

describe("conferência de valor e duração do encaixe", () => {
  it("recusa aceite avulso sem valor esperado, antes de reservar", async () => {
    expect((await POST(req({ ...dados, forcarAvulso: true }))).status).toBe(400);
    expect(m.criar).not.toHaveBeenCalled();
  });
  it("preserva o preço consentido e a duração mostrada até a validação transacional", async () => {
    const r = await POST(req({ ...dados, forcarAvulso: true, precoEsperadoCentavos: 4000, duracaoEsperadaMin: 45 }));
    expect(r.status).toBe(201);
    expect(m.criar).toHaveBeenCalledWith({ ...dados, inicio: new Date(dados.inicio), origem: "RECEPCAO",
      forcarAvulso: true, precoEsperadoCentavos: 4000, duracaoEsperadaMin: 45 }, ator);
  });
  it.each([{ precoEsperadoCentavos: -1 }, { precoEsperadoCentavos: 0.5 }, { duracaoEsperadaMin: 0 }, { duracaoEsperadaMin: 481 }])("recusa confirmação inválida %#", async (mudanca) => {
    expect((await POST(req({ ...dados, ...mudanca }))).status).toBe(400); expect(m.criar).not.toHaveBeenCalled();
  });
  it.each(["preco_alterado", "duracao_alterada"])("mudança concorrente %s retorna conflito para nova conferência", async (codigo) => {
    m.criar.mockRejectedValue(new ErroNegocio("Consulte novamente.", 409, codigo));
    const r = await POST(req({ ...dados, forcarAvulso: true, precoEsperadoCentavos: 4000, duracaoEsperadaMin: 45 }));
    expect(r.status).toBe(409); expect((await r.json()).codigo).toBe(codigo);
  });
  it("preserva encaixe comum sem forçar avulso e a origem do barbeiro", async () => {
    m.sessao.mockResolvedValue({ ...ator, papel: "BARBEIRO" });
    expect((await POST(req(dados))).status).toBe(201);
    expect(m.criar).toHaveBeenCalledWith(expect.objectContaining({ origem: "BARBEIRO" }), expect.objectContaining({ papel: "BARBEIRO" }));
  });
});
