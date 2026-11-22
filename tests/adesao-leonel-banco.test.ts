import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as assinar } from "@/app/api/cliente/assinatura/route";
import { GET as checkout, POST as pagar } from "@/app/api/pagamentos/assinatura/[token]/route";
import { conviteDeAdesaoLeonelValido, ehCheckoutLeonel, linkDeAdesaoLeonel } from "@/lib/assinaturas/adesao-leonel";
import { db } from "@/lib/db";
import { _usarFetch } from "@/lib/pagamentos/pagarme";
import { exigirEmissaoDeCobranca, naEmissaoDeAdesaoLeonel } from "@/lib/pagamentos/bloqueio-cobranca";

const { exigirCliente } = vi.hoisted(() => ({ exigirCliente: vi.fn() }));
vi.mock("@/lib/auth/sessao", async original => ({ ...await original<typeof import("@/lib/auth/sessao")>(), exigirCliente }));

const local = process.env.TESTE_CONVITE_APP_LOCAL === "1";
if (local) {
  const banco = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(banco.hostname) || !banco.pathname.includes("teste")) throw new Error("Use um banco de teste local.");
}
const site = "https://black.exemplo.test";
const telefone = "5547999000101";
const ambiente = () => {
  for (const [k, v] of Object.entries({
    SITE_URL: site, PAINEL_URL: site, AMBIENTE: "teste", PAGAMENTOS_PROVIDER: "pagarme",
    LEONEL_CHECKOUT_ADESAO_ATIVO: "true", PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS: "true", SESSION_SECRET: "fixture-de-adesao-do-leonel".repeat(2),
    PAGARME_SECRET_KEY: "sk_test_adesao", COBRANCA_ENDERECO: "50, Rua Teste, Centro",
    COBRANCA_CEP: "89160161", COBRANCA_CIDADE: "Rio do Sul", COBRANCA_UF: "SC",
  })) vi.stubEnv(k, v);
};
const post = (path: string, body: Record<string, unknown>) => new Request(site + path, {
  method: "POST", headers: { origin: site, "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("convite assinado para aderir com o Leonel", () => {
  beforeAll(ambiente);
  afterAll(() => vi.unstubAllEnvs());

  it("vincula número, plano, valor e validade ao link", () => {
    const agora = Date.parse("2026-11-22T17:00:00Z");
    const plano = { id: "plano", precoCentavos: 11800 };
    const endereco = new URL(linkDeAdesaoLeonel(telefone, plano, agora)!);
    const token = endereco.searchParams.get("leonel")!;
    expect(endereco.pathname).toBe("/c/planos");
    expect(endereco.searchParams.get("plano")).toBe(plano.id);
    expect(endereco.href).not.toContain(telefone);
    expect(conviteDeAdesaoLeonelValido(token, telefone, plano, agora)).toBe(true);
    expect(conviteDeAdesaoLeonelValido(token, "5547999000199", plano, agora)).toBe(false);
    expect(conviteDeAdesaoLeonelValido(token, telefone, { ...plano, id: "outro" }, agora)).toBe(false);
    expect(conviteDeAdesaoLeonelValido(token, telefone, { ...plano, precoCentavos: 10900 }, agora)).toBe(false);
    expect(conviteDeAdesaoLeonelValido(token, telefone, plano, agora + 86_400_000)).toBe(false);
  });

  it("deixa outras emissões bloqueadas durante o checkout e encerra o escopo ao voltar", async () => {
    await naEmissaoDeAdesaoLeonel("primeiroCartao", async () => {
      expect(() => exigirEmissaoDeCobranca("pagarme", { metodo: "POST", caminho: "/subscriptions" })).not.toThrow();
      expect(() => exigirEmissaoDeCobranca("pagarme", { metodo: "POST", caminho: "/orders" })).toThrow();
      expect(() => exigirEmissaoDeCobranca("pagarme", { metodo: "PATCH", caminho: "/subscriptions/sub_teste/card" })).toThrow();
      expect(() => exigirEmissaoDeCobranca("stone")).toThrow();
    });
    expect(() => exigirEmissaoDeCobranca("pagarme", { metodo: "POST", caminho: "/subscriptions" })).toThrow();
  });
});

describe.skipIf(!local)("checkout pelo app com Pagar.me interceptada", () => {
  beforeAll(ambiente);
  afterAll(async () => { vi.unstubAllEnvs(); await db.$disconnect(); });

  it("cobra o titular uma vez após confirmação e preserva o bloqueio geral", async () => {
    const destino = "55479" + Date.now().toString().slice(-8);
    const outroNumero = "55488" + Date.now().toString().slice(-8);
    const cliente = async (numero: string) => {
      const u = await db.usuario.create({ data: { nome: "Titular teste", papel: "CLIENTE", telefone: numero, telefoneVerificadoEm: new Date() } });
      const c = await db.cliente.create({ data: { telefone: numero, nome: "Titular teste", usuarioId: u.id } });
      return { usuarioId: u.id, clienteId: c.id, sessaoVersao: u.sessaoVersao };
    };
    const titular = await cliente(destino), outro = await cliente(outroNumero);
    const plano = await db.plano.create({ data: { nome: "Plano teste " + randomUUID(), precoCentavos: 11800, formasPagamento: ["CARTAO", "PIX"] } });
    await db.configuracao.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const gatewayId = "sub_" + randomUUID().replaceAll("-", "");
    const escritas: string[] = [];
    _usarFetch(async (url, init) => {
      const caminho = new URL(String(url)).pathname;
      if (init?.method === "POST") escritas.push(caminho.split("/").at(-1)!);
      if (caminho.endsWith("/customers")) return Response.json({ id: "cus_fixture" });
      if (caminho.endsWith("/subscriptions")) return Response.json({ id: gatewayId });
      if (caminho.endsWith("/invoices")) return Response.json({ data: [] });
      throw new Error("Chamada inesperada no ambiente sem rede.");
    });
    const leonel = new URL(linkDeAdesaoLeonel(destino, plano)!).searchParams.get("leonel");
    const documento = { planoId: plano.id, forma: "CARTAO", cpf: "52998224725", email: "fixture@example.test" };
    exigirCliente.mockResolvedValue(titular);
    expect((await assinar(post("/api/cliente/assinatura", documento))).status).toBe(503);
    exigirCliente.mockResolvedValue(outro);
    expect((await assinar(post("/api/cliente/assinatura", { ...documento, leonel }))).status).toBe(409);
    expect(escritas).toEqual([]);
    exigirCliente.mockResolvedValue(titular);
    const r = await assinar(post("/api/cliente/assinatura", { ...documento, leonel }));
    expect(r.status).toBe(201);
    const token = (new URL((await r.json()).link).pathname.split("/").at(-1))!;
    expect(ehCheckoutLeonel(token)).toBe(true);
    expect(escritas).toEqual(["customers"]);
    const path = "/api/pagamentos/assinatura/" + token;
    const ctx = { params: Promise.resolve({ token }) };
    exigirCliente.mockResolvedValue(outro);
    expect((await checkout(new Request(site + path), ctx)).status).toBe(404);
    expect((await pagar(post(path, { forma: "CARTAO", cartaoToken: "token_fixture" }), ctx)).status).toBe(404);
    exigirCliente.mockResolvedValue(titular);
    expect((await pagar(post(path, { forma: "PIX" }), ctx)).status).toBe(409);
    expect((await pagar(post(path, { forma: "CARTAO", cartaoToken: "token_fixture" }), ctx)).status).toBe(201);
    expect((await pagar(post(path, { forma: "CARTAO", cartaoToken: "token_fixture" }), ctx)).status).toBe(409);
    expect(escritas).toEqual(["customers", "subscriptions"]);
    expect(await db.assinatura.findUnique({ where: { tokenPublico: token } })).toMatchObject({ origem: "BOT", gatewayId, operacaoInicial: null });
  });
});
