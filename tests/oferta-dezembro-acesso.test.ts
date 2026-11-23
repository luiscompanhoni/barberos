import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as consultarAssinatura } from "@/app/api/cliente/assinatura/route";
import { PATCH, POST } from "@/app/api/cliente/oferta-dezembro/route";
import { vagasRestantes } from "@/lib/assinaturas/vagas";
import { aderirOfertaDezembro } from "@/lib/oferta-dezembro/servico";
import { config, proxy } from "@/proxy";

const m = vi.hoisted(() => ({
  lerToken: vi.fn(), transacao: vi.fn(), situacao: vi.fn(), exigirCliente: vi.fn(), alteracaoAtual: vi.fn(), contarVagas: vi.fn(),
}));
vi.mock("@/lib/auth/token", () => ({ tokenDoCookie: () => undefined, lerToken: m.lerToken }));
vi.mock("@/lib/auth/sessao", () => ({ exigirCliente: m.exigirCliente }));
vi.mock("@/lib/assinaturas/servico", () => ({ situacaoDoCliente: m.situacao }));
vi.mock("@/lib/assinaturas/alteracao-plano", () => ({ alteracaoAtual: m.alteracaoAtual }));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: m.transacao,
  plano: { findMany: async () => [] },
  cliente: { findUniqueOrThrow: async () => ({ cpf: null, email: null }) },
  listaEsperaPlano: { findMany: async () => [] },
  assinatura: { count: m.contarVagas },
} }));

const api = "/api/cliente/oferta-dezembro";
const cliente = "/c/dezembro-gratis";
const equipe = "/assinaturas/dezembro-gratis";
const endereco = "https://site.example";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SITE_URL", endereco);
  vi.stubEnv("PAINEL_URL", "https://painel.example");
  vi.stubEnv("AMBIENTE", "homologacao");
  vi.stubEnv("OFERTA_DEZEMBRO_ATIVA", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("acesso à oferta de dezembro", () => {
  it("inclui apenas a API da oferta no proxy entre as APIs de assinatura", () => {
    for (const url of [api, cliente, equipe]) {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    }
    expect(unstable_doesMiddlewareMatch({ config, url: "/api/cliente/assinatura" })).toBe(false);
  });

  it.each([
    [cliente, "GET"], [equipe, "GET"], [api, "GET"], [api, "HEAD"], [api, "OPTIONS"],
    [api, "POST"], [api, "PATCH"], [api, "PUT"], [api, "DELETE"],
  ])("fecha %s via %s antes do login e dos redirects de domínio", async (caminho, method) => {
    const resposta = await proxy(new NextRequest(endereco + caminho, { method }));
    expect(resposta.status).toBe(404);
    expect(resposta.headers.get("location")).toBeNull();
    expect(m.lerToken).not.toHaveBeenCalled();
  });

  it("exige homologação mesmo que a flag esteja habilitada", async () => {
    vi.stubEnv("OFERTA_DEZEMBRO_ATIVA", "true");
    vi.stubEnv("AMBIENTE", "producao");
    expect((await proxy(new NextRequest(endereco + cliente))).status).toBe(404);
  });

  it("permite que a API habilitada execute suas próprias verificações", async () => {
    vi.stubEnv("OFERTA_DEZEMBRO_ATIVA", "true");
    const resposta = await proxy(new NextRequest(endereco + api, { method: "POST" }));
    expect(resposta.headers.get("x-middleware-next")).toBe("1");
    expect(m.lerToken).not.toHaveBeenCalled();
    expect((await proxy(new NextRequest(endereco + cliente))).status).toBe(307);
  });

  it("handlers fechados retornam 404 mesmo sem origem ou corpo válidos", async () => {
    for (const [metodo, handler] of [["POST", POST], ["PATCH", PATCH]] as const) {
      const resposta = await handler(new Request(endereco + api, {
        method: metodo, headers: { origin: "https://outra.example" }, body: "inválido",
      }));
      expect(resposta.status).toBe(404);
    }
    expect(m.exigirCliente).not.toHaveBeenCalled();
    expect(m.transacao).not.toHaveBeenCalled();
  });

  it("omite o contrato simulado no resumo comum sem liberar outra contratação", async () => {
    m.exigirCliente.mockResolvedValue({ clienteId: "cliente" });
    m.situacao.mockResolvedValue({ assinatura: {
      id: "contrato-simulado", plano: { id: "base", nome: "Plano base" }, ofertaDezembro: {},
    } });
    const resposta = await consultarAssinatura(new Request(endereco + "/api/cliente/assinatura"));
    expect(resposta.status).toBe(200);
    const dados = await resposta.json();
    expect(dados).toMatchObject({ atual: null, assinaturaIndisponivel: true });
    expect(JSON.stringify(dados)).not.toMatch(/dezembro|contrato-simulado/i);
    expect(m.alteracaoAtual).not.toHaveBeenCalled();
  });

  it("rejeita adesão antes de ler dados ou iniciar transação", async () => {
    await expect(aderirOfertaDezembro({ clienteId: "cliente", usuarioId: "usuario", sessaoVersao: 0 }, {
      chave: "c3f44761-a857-4c36-9906-530e409f0950", forma: "CARTAO", cartaoToken: "dezembro_cartao_aprovado",
      aceitaTermos: true, termosVersao: "dezembro-2026-homologacao-v1", planoId: "plano", precoCentavos: 10000, limiteUsos: 2,
    })).rejects.toMatchObject({ status: 404 });
    expect(m.transacao).not.toHaveBeenCalled();
  });

  it("reserva as vagas simuladas somente enquanto a oferta estiver ativa", async () => {
    m.contarVagas.mockResolvedValue(1);
    expect(await vagasRestantes({ id: "plano", vagas: 2 })).toBe(1);
    expect(m.contarVagas).toHaveBeenLastCalledWith({ where: expect.objectContaining({ ofertaDezembro: { is: null } }) });
    vi.stubEnv("OFERTA_DEZEMBRO_ATIVA", "true");
    await vagasRestantes({ id: "plano", vagas: 2 });
    expect(m.contarVagas.mock.lastCall?.[0].where).not.toHaveProperty("ofertaDezembro");
  });
});
