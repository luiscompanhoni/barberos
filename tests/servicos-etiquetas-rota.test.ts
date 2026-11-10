import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), consultar: vi.fn(), salvar: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ GESTAO: ["DONO", "GERENTE"], exigirSessao: m.sessao }));
vi.mock("@/lib/servicos/etiquetas-servico", () => ({ consultarEtiquetasServico: m.consultar, salvarEtiquetasServico: m.salvar }));
import { GET, PATCH } from "@/app/api/servicos/[id]/etiquetas/route";
import { ErroNegocio } from "@/lib/erros";

const origem = "https://painel.example.test", ctx = { params: Promise.resolve({ id: "servico" }) };
const dados = { versao: 0, etiquetas: [{ texto: "Destaque", cor: "#f9cb30", formato: "PILULA" }] };
const origensInvalidas: Record<string, string>[] = [{ origin: "https://externo.test" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }];
const req = (body: unknown = dados, headers: Record<string, string> = {}) => new Request(`${origem}/api/servicos/servico/etiquetas`, { method: "PATCH", headers: { origin: origem, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("PAINEL_URL", origem);
  m.sessao.mockResolvedValue({ usuarioId: "gerente", papel: "GERENTE" });
  m.consultar.mockResolvedValue({ etiquetas: [], versao: 0 }); m.salvar.mockResolvedValue({ etiquetas: dados.etiquetas, versao: 1 });
});
afterEach(() => vi.unstubAllEnvs());

describe("rota protegida de etiquetas", () => {
  it.each([401, 403])("recusa leitura e escrita sem gestão autorizada: %s", async status => {
    m.sessao.mockRejectedValue(new ErroNegocio("Acesso recusado", status));
    expect((await GET(req(), ctx)).status).toBe(status); expect((await PATCH(req(), ctx)).status).toBe(status);
    expect(m.consultar).not.toHaveBeenCalled(); expect(m.salvar).not.toHaveBeenCalled();
  });
  it("usa identidade da sessão e resposta privada sem cache", async () => {
    const consulta = await GET(req(), ctx), salvo = await PATCH(req(), ctx);
    expect(consulta.status).toBe(200); expect(consulta.headers.get("cache-control")).toBe("private, no-store");
    expect(salvo.status).toBe(200); expect(m.sessao).toHaveBeenCalledWith(["DONO", "GERENTE"]);
    expect(m.salvar).toHaveBeenCalledWith("servico", "gerente", { versao: 0, etiquetas: [{ ...dados.etiquetas[0], cor: "#F9CB30" }] });
  });
  it.each(origensInvalidas)("recusa origem externa: %j", async headers => {
    expect((await PATCH(req(dados, headers), ctx)).status).toBe(403); expect(m.salvar).not.toHaveBeenCalled();
  });
  it("recusa identidade, preço, corpo grande e tipo inesperado antes da persistência", async () => {
    expect((await PATCH(req({ ...dados, usuarioId: "dono" }), ctx)).status).toBe(400);
    expect((await PATCH(req({ ...dados, precoCentavos: 0 }), ctx)).status).toBe(400);
    expect((await PATCH(req({ ...dados, texto: "x".repeat(9000) }), ctx)).status).toBe(413);
    expect((await PATCH(req(dados, { "content-type": "text/plain" }), ctx)).status).toBe(415);
    expect(m.salvar).not.toHaveBeenCalled();
  });
  it("preserva conflito como 409 para exigir recarga explícita no editor", async () => {
    m.salvar.mockRejectedValue(new ErroNegocio("Recarregue", 409, "etiquetas_desatualizadas"));
    const resposta = await PATCH(req(), ctx);
    expect(resposta.status).toBe(409); expect((await resposta.json()).codigo).toBe("etiquetas_desatualizadas");
  });
});
