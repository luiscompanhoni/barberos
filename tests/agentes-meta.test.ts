import { describe, expect, it, vi } from "vitest";
import { configurarMeta, consultarInsights, planejarPublicacaoMeta } from "@/lib/agentes/meta";

const env = { META_ADS_API_VERSION: "v25.0", META_ADS_ACCOUNT_ID: "act_123", META_ADS_TOKEN: "token-apenas-para-teste" };
const periodo = { de: "2026-10-01", ate: "2026-10-07" };
const conta = { id: "act_123", currency: "BRL", timezone_name: "America/Sao_Paulo" };
const linha = {
  account_id: "123", account_currency: "BRL", campaign_id: "1", adset_id: "2", ad_id: "3", ad_name: "Campanha fictícia",
  date_start: "2026-10-01", date_stop: "2026-10-01", spend: "118.05", impressions: "1234", clicks: "45",
  actions: [{ action_type: "lead", value: "3" }, { action_type: "onsite_conversion.lead_grouped", value: "3" }],
  action_values: [{ action_type: "purchase", value: "354.15" }],
};
const json = (value: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { status, headers });
function fakeFetch(...responses: Response[]) {
  const f = vi.fn<typeof fetch>();
  for (const r of responses) f.mockResolvedValueOnce(r);
  return f;
}

describe("Meta: configuração e fronteira de leitura", () => {
  it("não expõe segredos e não acessa a rede com configuração ausente ou inválida", async () => {
    expect(configurarMeta({}).disponivel).toBe(false);
    expect(JSON.stringify(configurarMeta(env))).not.toContain(env.META_ADS_TOKEN);
    const f = fakeFetch();
    await expect(consultarInsights(periodo, { env: { ...env, META_ADS_ACCOUNT_ID: "act_123/../me" }, fetch: f })).rejects.toMatchObject({ codigo: "meta_configuracao" });
    await expect(consultarInsights(periodo, { env: { ...env, META_ADS_API_VERSION: "https://invalido.test" }, fetch: f })).rejects.toMatchObject({ codigo: "meta_configuracao" });
    expect(f).not.toHaveBeenCalled();
  });
  it("consulta só GET, mantém token no header e confirma a moeda da conta", async () => {
    const f = fakeFetch(json(conta), json({ data: [linha] }));
    const r = await consultarInsights(periodo, { env, fetch: f, agora: new Date("2026-10-08T12:00:00Z") });
    expect(r.linhas[0].gastoCentavos).toBe(11805);
    expect(r.linhas[0].valoresAcoesCentavos.purchase).toBe(35415);
    expect(r.linhas[0].acoes).toEqual({ lead: 3, "onsite_conversion.lead_grouped": 3 });
    expect(r.moeda).toBe("BRL");
    expect(r.atribuicao).toBe("configuracao_conjunto");
    for (const [url, options] of f.mock.calls) {
      expect(String(url)).not.toContain(env.META_ADS_TOKEN);
      expect(options).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", headers: { Authorization: `Bearer ${env.META_ADS_TOKEN}` } });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
    const query = new URL(String(f.mock.calls[1][0]));
    expect(query.searchParams.get("use_unified_attribution_setting")).toBe("true");
    expect(query.searchParams.get("action_report_time")).toBe("mixed");
  });
  it("não mistura moeda estrangeira com centavos BRL", async () => {
    const f = fakeFetch(json({ ...conta, currency: "USD" }));
    await expect(consultarInsights(periodo, { env, fetch: f })).rejects.toMatchObject({ codigo: "meta_moeda" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("recusa datas impossíveis ou intervalo excessivo antes da rede", async () => {
    const f = fakeFetch();
    await expect(consultarInsights({ de: "2026-02-30", ate: "2026-03-01" }, { env, fetch: f })).rejects.toThrow();
    await expect(consultarInsights({ de: "2025-01-01", ate: "2026-03-01" }, { env, fetch: f })).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("Meta: paginação, quota e integridade", () => {
  it("deduplica anúncio/dia e reconstrói URL sem usar token devolvido pela API", async () => {
    const next = "https://graph.facebook.com/v25.0/act_123/insights?after=abc&access_token=nao-usar&fields=secreto";
    const f = fakeFetch(json(conta), json({ data: [linha], paging: { next } }), json({ data: [linha, { ...linha, ad_id: "4" }] }));
    const r = await consultarInsights(periodo, { env, fetch: f });
    expect(r.linhas).toHaveLength(2);
    const url = new URL(String(f.mock.calls[2][0]));
    expect(url.searchParams.get("after")).toBe("abc");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(url.searchParams.get("fields")).toContain("spend");
  });
  it.each([
    "https://outro.test/v25.0/act_123/insights?after=abc",
    "https://graph.facebook.com/v25.0/act_999/insights?after=abc",
    "https://graph.facebook.com/v25.0/act_123/campaigns?after=abc",
    "https://user:secret@graph.facebook.com/v25.0/act_123/insights?after=abc",
  ])("rejeita próximo link inseguro: %s", async next => {
    const f = fakeFetch(json(conta), json({ data: [linha], paging: { next } }));
    await expect(consultarInsights(periodo, { env, fetch: f })).rejects.toMatchObject({ codigo: "meta_resposta" });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("não aceita páginas divergentes para a mesma chave nem resultado parcial", async () => {
    const next = "https://graph.facebook.com/v25.0/act_123/insights?after=abc";
    const f = fakeFetch(json(conta), json({ data: [linha], paging: { next } }), json({ data: [{ ...linha, spend: "200.00" }] }));
    await expect(consultarInsights(periodo, { env, fetch: f })).rejects.toMatchObject({ codigo: "meta_resposta" });
  });
  it("deduplica as mesmas ações mesmo quando o provedor muda a ordem", async () => {
    const next = "https://graph.facebook.com/v25.0/act_123/insights?after=abc";
    const f = fakeFetch(json(conta), json({ data: [linha], paging: { next } }), json({ data: [{ ...linha, actions: [...linha.actions].reverse() }] }));
    const r = await consultarInsights(periodo, { env, fetch: f });
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].acoes).toEqual({ lead: 3, "onsite_conversion.lead_grouped": 3 });
  });
  it("interrompe cursor repetido sem loop infinito", async () => {
    const next = "https://graph.facebook.com/v25.0/act_123/insights?after=abc";
    const f = fakeFetch(json(conta), json({ data: [linha], paging: { next } }), json({ data: [], paging: { next } }));
    await expect(consultarInsights(periodo, { env, fetch: f })).rejects.toMatchObject({ codigo: "meta_limite" });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it.each([
    { account_id: "999" }, { date_start: "2026-09-30", date_stop: "2026-09-30" }, { spend: "12.345" },
    { actions: [{ action_type: "lead", value: "2" }, { action_type: "lead", value: "3" }] },
  ])("recusa resposta inválida sem ocultar divergência (%j)", async patch => {
    const f = fakeFetch(json(conta), json({ data: [{ ...linha, ...patch }] }));
    await expect(consultarInsights(periodo, { env, fetch: f })).rejects.toMatchObject({ codigo: "meta_resposta" });
  });
  it("respeita utilização elevada sem expor mensagem retornada pela Meta", async () => {
    const f = fakeFetch(json({ error: { message: env.META_ADS_TOKEN } }, 200, { "x-business-use-case-usage": JSON.stringify({ "123": [{ call_count: 96 }] }) }));
    await expect(consultarInsights(periodo, { env, fetch: f })).rejects.toMatchObject({ codigo: "meta_limite", status: 429 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("sanitiza erros e timeouts do transporte", async () => {
    const f = fakeFetch(); f.mockRejectedValueOnce(new Error("falha " + env.META_ADS_TOKEN));
    await expect(consultarInsights(periodo, { env, fetch: f })).rejects.toMatchObject({ codigo: "meta_conexao", message: "Não foi possível concluir a leitura da Meta. Confira a conexão e tente novamente." });
  });
  it("limita o corpo recebido", async () => {
    const f = fakeFetch(json(conta, 200, { "content-length": "2000001" }));
    await expect(consultarInsights(periodo, { env, fetch: f })).rejects.toMatchObject({ codigo: "meta_resposta" });
  });
});

describe("Meta: plano local de publicação", () => {
  const plano = { nome: "Oferta de teste", contaId: "act_123", moeda: "BRL", objetivo: "OUTCOME_LEADS",
    orcamentoDiarioCentavos: 1000, orcamentoTotalCentavos: 10000, conteudoRevisaoHash: "a".repeat(64), publico: "Público local proposto" };
  it("gera apenas prévia pausada, sem autorização ou capacidade de gasto", () => {
    expect(planejarPublicacaoMeta(plano)).toMatchObject({ estado: "RASCUNHO_SEM_ENVIO", permiteGasto: false, campanha: { status: "PAUSED" } });
    expect(planejarPublicacaoMeta(plano).pendencias).not.toHaveLength(0);
  });
  it("recusa injeção de status ativo, valores fracionados e teto inconsistente", () => {
    expect(() => planejarPublicacaoMeta({ ...plano, status: "ACTIVE" })).toThrow();
    expect(() => planejarPublicacaoMeta({ ...plano, orcamentoDiarioCentavos: 10.5 })).toThrow();
    expect(() => planejarPublicacaoMeta({ ...plano, orcamentoTotalCentavos: 1 })).toThrow();
  });
});
