import { beforeEach, describe, expect, it } from "vitest";
import { _usarFetch, converterCobranca, descritorFatura, motivoRecusaEstorno, pagarme, telefonePagarme, traduzirStatus } from "@/lib/pagamentos/pagarme";

describe("estorno recusado", () => {
  it("explica saldo insuficiente e repassa outros motivos", () => {
    expect(motivoRecusaEstorno([{ message: "action_forbidden |  | Saldo insuficiente." }])).toMatch(/saldo insuficiente na conta/);
    expect(motivoRecusaEstorno([{ message: "invalid | | Cartão expirado." }])).toBe("Pagar.me recusou o estorno: Cartão expirado.");
    expect(motivoRecusaEstorno()).toBe("Pagar.me recusou o estorno.");
  });
});

type Chamada = { url: string; metodo: string; corpo: unknown; auth: string | null };
let chamadas: Chamada[] = [];
let respostas: unknown[] = [];

beforeEach(() => {
  process.env.PAGARME_SECRET_KEY = "sk_test_abc";
  process.env.COBRANCA_ENDERECO = "50, Rua Teste, Centro"; process.env.COBRANCA_CEP = "89160161"; process.env.COBRANCA_CIDADE = "Rio do Sul"; process.env.COBRANCA_UF = "SC";
  chamadas = [];
  respostas = [];
  _usarFetch((async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    chamadas.push({ url, metodo: init?.method ?? "GET", corpo: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.get("authorization") });
    return new Response(JSON.stringify(respostas.shift() ?? {}), { status: 200 });
  }) as typeof fetch);
});

describe("conversoes", () => {
  it("status da Pagar.me para o interno", () => {
    expect(traduzirStatus("paid")).toBe("PAGA");
    expect(traduzirStatus("pending")).toBe("PENDENTE");
    expect(traduzirStatus("processing")).toBe("PENDENTE");
    expect(traduzirStatus("failed")).toBe("ATRASADA");
    expect(traduzirStatus("canceled")).toBe("CANCELADA");
    expect(traduzirStatus("chargedback")).toBe("ESTORNADA");
  });

  it("cobranca Pix com QR e assinatura via fatura", () => {
    const c = converterCobranca({
      id: "ch_1", amount: 9900, status: "pending", payment_method: "pix", created_at: "2026-10-01T12:00:00Z",
      invoice: { id: "in_1", subscriptionId: "sub_9" },
      last_transaction: { qr_code: "000201...", qr_code_url: "https://api.pagar.me/qr.png", expires_at: "2026-10-05T12:00:00Z" },
    });
    expect(c).toMatchObject({
      id: "ch_1", assinaturaGatewayId: "sub_9", valorCentavos: 9900, status: "PENDENTE", forma: "PIX",
      pixCopiaECola: "000201...", pixQrUrl: "https://api.pagar.me/qr.png", vencimento: "2026-10-01", link: null,
    });
  });

  it("boleto usa o PDF e a linha digitavel", () => {
    const c = converterCobranca({ id: "ch_2", amount: 14900, status: "pending", payment_method: "boleto", due_at: "2026-10-10T00:00:00Z", last_transaction: { url: "u", pdf: "p", line: "3419..." } });
    expect(c).toMatchObject({ forma: "BOLETO", boletoUrl: "p", boletoLinha: "3419...", vencimento: "2026-10-10" });
  });

  it("telefone e nome na fatura", () => {
    expect(telefonePagarme("5511999998888")).toEqual({ country_code: "55", area_code: "11", number: "999998888" });
    expect(descritorFatura("Barbearia São João Ltda")).toBe("Barbearia Sao");
  });
});

describe("chamadas a API", () => {
  it("cria assinatura no cartao com token, mensal, preco em centavos e autenticacao basic", async () => {
    respostas.push({ id: "sub_1" });
    const id = await pagarme.criarAssinatura({
      clienteGatewayId: "cus_1", valorCentavos: 9900, forma: "CARTAO", primeiroVencimento: "2026-10-01",
      descricao: "Plano Corte - Barbearia", referencia: "ass_1", cartaoToken: "token_abc",
    });
    expect(id).toBe("sub_1");
    const c = chamadas[0];
    expect(c.url).toBe("https://api.pagar.me/core/v5/subscriptions");
    expect(c.auth).toBe(`Basic ${Buffer.from("sk_test_abc:").toString("base64")}`);
    expect(c.corpo).toMatchObject({
      customer_id: "cus_1", payment_method: "credit_card", card_token: "token_abc", interval: "month", interval_count: 1,
      // A Pagar.me recusa cartao sem endereco de cobranca ("billing | value is required").
      card: { billing_address: { zip_code: "89160161", city: "Rio do Sul", state: "SC", country: "BR" } },
      items: [{ quantity: 1, pricing_scheme: { price: 9900 } }],
    });
  });

  it("cartao sem token e recusado antes de chamar a API", async () => {
    await expect(pagarme.criarAssinatura({
      clienteGatewayId: "cus_1", valorCentavos: 9900, forma: "CARTAO", primeiroVencimento: "2026-10-01", descricao: "x", referencia: "a",
    })).rejects.toThrow();
    expect(chamadas).toHaveLength(0);
  });

  it("Pix nao cria assinatura no gateway (o BarberOS gera o Pix do mes)", async () => {
    const id = await pagarme.criarAssinatura({
      clienteGatewayId: "cus_1", valorCentavos: 9900, forma: "PIX", primeiroVencimento: "2026-10-01", descricao: "x", referencia: "ass_7",
    });
    expect(id).toBe("pixrec_ass_7");
    expect(chamadas).toHaveLength(0);
    await pagarme.cancelarAssinatura(id);
    expect(chamadas).toHaveLength(0);
  });

  it("gera o Pix do mes como pedido e mantem o vencimento informado", async () => {
    respostas.push({ id: "or_1", charges: [{ id: "ch_9", amount: 9900, status: "pending", payment_method: "pix", created_at: "2026-10-28T10:00:00Z", last_transaction: { qr_code: "abc", qr_code_url: "q" } }] });
    const c = await pagarme.criarCobrancaPix!({
      clienteGatewayId: "cus_1", valorCentavos: 9900, vencimento: "2026-11-01", descricao: "Plano", referencia: "pixrec_ass_7", validadeHoras: 168,
    });
    expect(chamadas[0].url).toContain("/orders");
    expect(chamadas[0].corpo).toMatchObject({ customer_id: "cus_1", payments: [{ payment_method: "pix", pix: { expires_in: 168 * 3600 } }] });
    expect(c).toMatchObject({ id: "ch_9", assinaturaGatewayId: "pixrec_ass_7", vencimento: "2026-11-01", forma: "PIX", pixCopiaECola: "abc" });
  });

  it("busca a assinatura na fatura quando a cobranca nao traz", async () => {
    respostas.push({ id: "ch_5", amount: 9900, status: "paid", payment_method: "credit_card", invoice: { id: "in_5" } });
    respostas.push({ id: "in_5", subscription: { id: "sub_5" } });
    const c = await pagarme.buscarCobranca("ch_5");
    expect(chamadas.map((x) => x.url)).toEqual(["https://api.pagar.me/core/v5/charges/ch_5", "https://api.pagar.me/core/v5/invoices/in_5"]);
    expect(c).toMatchObject({ assinaturaGatewayId: "sub_5", status: "PAGA" });
  });
});
