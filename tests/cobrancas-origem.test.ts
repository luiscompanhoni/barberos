import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sessao: vi.fn(), permissao: vi.fn(), registrar: vi.fn(), cancelar: vi.fn(), conferir: vi.fn(), simular: vi.fn(), detalhe: vi.fn(), pagamento: vi.fn(), pedir: vi.fn(), decidir: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ BALCAO: ["DONO", "GERENTE", "RECEPCAO"], exigirSessao: m.sessao }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirSessaoCom: m.permissao }));
vi.mock("@/lib/comandas/maquininha", () => ({ registrarPagamento: m.registrar, cancelarPagamento: m.cancelar, sincronizarPedido: m.conferir, simularAprovacao: m.simular }));
vi.mock("@/lib/comandas/servico", () => ({ detalheComanda: m.detalhe }));
vi.mock("@/lib/db", () => ({ db: { pagamentoComanda: { findUnique: m.pagamento } } }));
vi.mock("@/lib/estornos/servico", () => ({ pedirEstorno: m.pedir, decidirEstorno: m.decidir }));

import { POST as cobrar } from "@/app/api/comandas/[id]/pagamentos/route";
import { PATCH as alterarPagamento } from "@/app/api/comandas/pagamentos/[id]/route";
import { POST as pedirEstorno } from "@/app/api/estornos/route";
import { PATCH as decidirEstorno } from "@/app/api/estornos/[id]/route";
import { ErroNegocio } from "@/lib/erros";

const origem = "https://painel.example";
const ctx = { params: Promise.resolve({ id: "registro-sintetico" }) };
const rotas = [
  { nome: "cobrar POS", metodo: "POST", corpo: { forma: "PIX", valorCentavos: 100, naMaquininha: true }, executar: (r: Request) => cobrar(r, ctx), status: 201 },
  { nome: "conferir POS", metodo: "PATCH", corpo: { acao: "conferir" }, executar: (r: Request) => alterarPagamento(r, ctx), status: 200 },
  { nome: "pedir estorno", metodo: "POST", corpo: { tipo: "COMANDA", referenciaId: "pg-sintetico", valorCentavos: 100, motivo: "Motivo sintético" }, executar: (r: Request) => pedirEstorno(r), status: 200 },
  { nome: "decidir estorno", metodo: "PATCH", corpo: { acao: "aprovar" }, executar: (r: Request) => decidirEstorno(r, ctx), status: 200 },
];
const servicos = [m.registrar, m.cancelar, m.conferir, m.simular, m.detalhe, m.pagamento, m.pedir, m.decidir];
const origensRecusadas: Record<string, string>[] = [
  { origin: "https://outro.painel.example", "sec-fetch-site": "same-site" },
  { origin: "https://example", "sec-fetch-site": "same-site" },
  { origin: "null" }, { origin: origem, "sec-fetch-site": "cross-site" },
  { origin: "https://externo.invalid", "content-type": "text/plain" },
];
function request(rota: typeof rotas[number], headers: Record<string, string> = {}, extra = "") {
  return new Request(origem + "/api/sintetico", { method: rota.metodo, headers: { origin: origem, "content-type": "application/json", ...headers }, body: JSON.stringify({ ...rota.corpo, ...(extra ? { extra } : {}) }) });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("PAINEL_URL", origem);
  const dono = { usuarioId: "dono-sintetico", papel: "DONO" };
  m.sessao.mockResolvedValue(dono); m.permissao.mockResolvedValue(dono);
  m.detalhe.mockResolvedValue({ id: "comanda-sintetica" });
  m.pagamento.mockResolvedValue({ comandaId: "comanda-sintetica", gatewayPedidoId: "or_sintetico" });
  m.pedir.mockResolvedValue({ id: "pedido-sintetico" }); m.decidir.mockResolvedValue({ id: "pedido-sintetico" });
});
afterEach(() => vi.unstubAllEnvs());

describe.each(rotas)("origem e limite: $nome", rota => {
  it("aceita a origem exata e preserva a resposta da rota", async () => {
    const r = await rota.executar(request(rota));
    expect(r.status).toBe(rota.status);
    if (rota.nome.includes("POS")) expect(m.sessao).toHaveBeenCalledWith(["DONO", "GERENTE", "RECEPCAO"]);
    if (rota.nome === "decidir estorno") expect(m.permissao).toHaveBeenCalledWith("estorno");
  });
  it.each(origensRecusadas)("rejeita origem indevida antes de consultar ou executar domínio (%j)", async headers => {
    expect((await rota.executar(request(rota, headers))).status).toBe(403);
    for (const servico of servicos) expect(servico).not.toHaveBeenCalled();
  });
  it("rejeita corpo acima de 32 KiB sem depender de Content-Length", async () => {
    const req = request(rota, {}, "x".repeat(33000));
    expect(req.headers.has("content-length")).toBe(false);
    expect((await rota.executar(req)).status).toBe(413);
    for (const servico of servicos) expect(servico).not.toHaveBeenCalled();
  });
  it("conta bytes UTF-8 e mantém validação para JSON inválido", async () => {
    expect((await rota.executar(request(rota, {}, "á".repeat(16500)))).status).toBe(413);
    const req = new Request(origem + "/api/sintetico", { method: rota.metodo, headers: { origin: origem }, body: "{" });
    expect((await rota.executar(req)).status).toBe(400);
    for (const servico of servicos) expect(servico).not.toHaveBeenCalled();
  });
  it("sessão recusada não executa serviços", async () => {
    m.sessao.mockRejectedValue(new ErroNegocio("Sem acesso", 403)); m.permissao.mockRejectedValue(new ErroNegocio("Sem acesso", 403));
    expect((await rota.executar(request(rota))).status).toBe(403);
    for (const servico of servicos) expect(servico).not.toHaveBeenCalled();
  });
});
