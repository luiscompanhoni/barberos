import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assinaturaInstagramValida, desafioInstagram, lerEntradasInstagram } from "@/lib/instagram/protocolo";
import { dentroJanelaInstagram, enviarTextoInstagram, partesInstagram } from "@/lib/instagram/canal";
import { pedidoDeNovaReservaDirect, pedidoPrivadoNoDirect, respostaModeloExigeEquipe, telefoneDoDirect, textoDaEquipeNoDirect, textoSeguroDoDirect } from "@/lib/instagram/privacidade";

const perfil = "17841400000001";
const pagina = "887766";
const igsid = "1234567887654321";
const agora = Date.UTC(2026, 10, 22, 14);
const entrada = { sender: { id: igsid }, recipient: { id: perfil }, timestamp: agora, message: { mid: "aWdf:1_-=", text: "Olá!" } };

function payload(...mensagens: unknown[]) {
  return { object: "instagram", entry: [{ id: perfil, messaging: mensagens }] };
}

afterEach(() => vi.unstubAllEnvs());

describe("webhook do Instagram", () => {
  it("responde só ao desafio autenticado e rejeita parâmetros duplicados", () => {
    const url = new URL("https://painel.example/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=teste&hub.challenge=123");
    expect(desafioInstagram(url, "teste")).toBe("123");
    expect(desafioInstagram(url, "outro")).toBeNull();
    expect(desafioInstagram(url, "")).toBeNull();
    url.searchParams.append("hub.verify_token", "teste");
    expect(desafioInstagram(url, "teste")).toBeNull();
  });

  it("assina UTF-8 e espaços do corpo original e rejeita assinaturas malformadas", () => {
    const corpo = Buffer.from(' {"text": "Olá"}\n');
    const assinatura = `sha256=${createHmac("sha256", "segredo-ficticio").update(corpo).digest("hex")}`;
    expect(assinaturaInstagramValida(corpo, assinatura, "segredo-ficticio")).toBe(true);
    expect(assinaturaInstagramValida(Buffer.from(corpo.toString().trim()), assinatura, "segredo-ficticio")).toBe(false);
    expect(assinaturaInstagramValida(corpo, `${assinatura}zz`, "segredo-ficticio")).toBe(false);
    expect(assinaturaInstagramValida(corpo, assinatura, "")).toBe(false);
  });

  it("filtra ecos, remoções, perfis divergentes, mensagens futuras e eventos sem MID", () => {
    expect(lerEntradasInstagram(payload(
      entrada,
      { ...entrada, sender: { id: perfil } },
      { ...entrada, recipient: { id: "987" } },
      { ...entrada, timestamp: agora + 1 },
      { ...entrada, timestamp: String(agora) },
      { ...entrada, message: { mid: "", text: "abc" } },
      { ...entrada, message: { ...entrada.message, is_echo: true } },
      { ...entrada, message: { ...entrada.message, is_self: true } },
      { ...entrada, message: { ...entrada.message, is_deleted: true } },
      { ...entrada, message: undefined, read: { mid: "lida" } },
      { ...entrada, message: { mid: "anexo", attachments: [{ type: "image", payload: { url: "https://example.invalid/arq" } }] } },
    ), perfil, agora)).toEqual([
      { igsid, mid: "aWdf:1_-=", timestamp: agora, texto: "Olá!" },
      { igsid, mid: "anexo", timestamp: agora, texto: null },
    ]);
    expect(lerEntradasInstagram({ object: "instagram", entry: [{ id: "987", messaging: [entrada] }] }, perfil, agora)).toEqual([]);
    expect(lerEntradasInstagram([payload(entrada)], perfil, agora)).toHaveLength(1);
  });
});

describe("transporte do Instagram", () => {
  beforeEach(() => {
    vi.stubEnv("AMBIENTE", "teste");
    vi.stubEnv("BARBEROS_QUARENTENA_RESTAURACAO", undefined);
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", "false");
    vi.stubEnv("INSTAGRAM_PROVEDOR", undefined);
    vi.stubEnv("INSTAGRAM_PROFESSIONAL_ACCOUNT_ID", perfil);
    vi.stubEnv("INSTAGRAM_PAGE_ID", pagina);
    vi.stubEnv("INSTAGRAM_PAGE_ACCESS_TOKEN", "pagina-ficticia");
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "instagram-ficticio");
    vi.stubEnv("INSTAGRAM_GRAPH_API_VERSION", undefined);
  });

  it("a janela termina às 24 horas exatas e requer data real já ocorrida", () => {
    expect(dentroJanelaInstagram(new Date(agora - 86_400_000 + 1), agora)).toBe(true);
    expect(dentroJanelaInstagram(new Date(agora - 86_400_000), agora)).toBe(false);
    expect(dentroJanelaInstagram(new Date(agora + 1), agora)).toBe(false);
    expect(dentroJanelaInstagram(null, agora)).toBe(false);
  });

  it("divide texto no limite de 1000 bytes preservando caracteres Unicode e texto", () => {
    const frase = `Oi! ${"💈á ".repeat(500)}Ótimo.`;
    const partes = partesInstagram(frase);
    expect(partes.length).toBeGreaterThan(1);
    expect(partes.every(p => Buffer.byteLength(p) <= 1_000)).toBe(true);
    expect(partes.join("")).toBe(frase);
    const semEspacos = ` ${"x".repeat(999)}💈`;
    expect(partesInstagram(semEspacos)).toEqual([` ${"x".repeat(999)}`, "💈"]);
  });

  it("simula por padrão, com bloqueio explícito, em homologação ou em quarentena", async () => {
    const rede = vi.fn<typeof fetch>();
    const envio = { igsid, texto: "Olá", sinal: new AbortController().signal };
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", undefined);
    expect(await enviarTextoInstagram(envio, rede)).toEqual({ simulado: true, mid: null });
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", "true");
    expect(await enviarTextoInstagram(envio, rede)).toEqual({ simulado: true, mid: null });
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", "false");
    vi.stubEnv("AMBIENTE", "homologacao");
    expect(await enviarTextoInstagram(envio, rede)).toEqual({ simulado: true, mid: null });
    vi.stubEnv("AMBIENTE", "teste");
    vi.stubEnv("BARBEROS_QUARENTENA_RESTAURACAO", "true");
    expect(await enviarTextoInstagram(envio, rede)).toEqual({ simulado: true, mid: null });
    expect(rede).not.toHaveBeenCalled();
  });

  it("usa a página, seu token e a versão padrão do Facebook com o IGSID no corpo", async () => {
    const rede = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ recipient_id: igsid, message_id: "ig:aceito" }));
    const sinal = new AbortController().signal;
    const dados = { igsid, texto: "Olá", sinal };
    expect(await enviarTextoInstagram(dados, rede)).toEqual({ simulado: false, mid: "ig:aceito" });
    expect(rede).toHaveBeenCalledExactlyOnceWith(`https://graph.facebook.com/v26.0/${pagina}/messages`, {
      method: "POST",
      headers: { Authorization: "Bearer pagina-ficticia", "Content-Type": "application/json" },
      redirect: "error",
      signal: sinal,
      body: JSON.stringify({ recipient: { id: igsid }, message: { text: "Olá" } }),
    });
  });

  it("usa o token e o ID profissionais no modo Instagram Login", async () => {
    vi.stubEnv("INSTAGRAM_PROVEDOR", "instagram_login");
    vi.stubEnv("INSTAGRAM_GRAPH_API_VERSION", "v27.0");
    const rede = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ recipient_id: igsid, message_id: "ig:aceito" }));
    const dados = { igsid, texto: "Olá", sinal: new AbortController().signal };
    expect(await enviarTextoInstagram(dados, rede)).toEqual({ simulado: false, mid: "ig:aceito" });
    expect(rede).toHaveBeenCalledExactlyOnceWith(`https://graph.instagram.com/v27.0/${perfil}/messages`, expect.objectContaining({
      headers: { Authorization: "Bearer instagram-ficticio", "Content-Type": "application/json" },
    }));
  });

  it.each([
    ["facebook_login", "INSTAGRAM_PROFESSIONAL_ACCOUNT_ID", undefined],
    ["facebook_login", "INSTAGRAM_PAGE_ID", undefined],
    ["facebook_login", "INSTAGRAM_PAGE_ID", "../../me"],
    ["facebook_login", "INSTAGRAM_PAGE_ACCESS_TOKEN", " "],
    ["facebook_login", "INSTAGRAM_GRAPH_API_VERSION", "v26.0/hub"],
    ["instagram_login", "INSTAGRAM_GRAPH_API_VERSION", undefined],
    ["instagram_login", "INSTAGRAM_ACCESS_TOKEN", undefined],
    ["desconhecido", "INSTAGRAM_GRAPH_API_VERSION", "v25.0"],
  ])("recusa %s com %s=%s sem tentar outro transporte", async (provedor, variavel, valor) => {
    vi.stubEnv("INSTAGRAM_PROVEDOR", provedor);
    vi.stubEnv("INSTAGRAM_GRAPH_API_VERSION", "v25.0");
    vi.stubEnv(variavel, valor);
    const rede = vi.fn<typeof fetch>();
    const dados = { igsid, texto: "Olá", sinal: new AbortController().signal };
    await expect(enviarTextoInstagram(dados, rede)).rejects.toThrow("Credenciais ou versão da API do Instagram indisponíveis.");
    expect(rede).not.toHaveBeenCalled();
  });

  it("respeita a versão configurada e não confirma um IGSID divergente nem expõe o erro da Meta", async () => {
    vi.stubEnv("INSTAGRAM_PROVEDOR", "facebook_login");
    vi.stubEnv("INSTAGRAM_GRAPH_API_VERSION", "v25.0");
    const rede = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ recipient_id: "999", message_id: "ig:aceito" }))
      .mockResolvedValueOnce(Response.json({ error: { message: "Credencial pagina-ficticia" } }, { status: 403 }));
    const dados = { igsid, texto: "Olá", sinal: new AbortController().signal };
    const erro = "O Instagram não confirmou o envio. Confira no Direct antes de reenviar.";
    await expect(enviarTextoInstagram(dados, rede)).rejects.toThrow(new Error(erro));
    await expect(enviarTextoInstagram(dados, rede)).rejects.toThrow(new Error(erro));
    expect(rede).toHaveBeenCalledTimes(2);
    expect(rede).toHaveBeenCalledWith(`https://graph.facebook.com/v25.0/${pagina}/messages`, expect.anything());
  });
});

describe("privacidade do Direct", () => {
  it("normaliza um telefone informado sem extrair números de links, documentos ou texto ambíguo", () => {
    expect(telefoneDoDirect("Meu telefone é +55 (47) 99999-8888, obrigado.")).toBe("5547999998888");
    expect(telefoneDoDirect("47999998888")).toBe("5547999998888");
    expect(telefoneDoDirect("https://example.invalid/47999998888")).toBeNull();
    expect(telefoneDoDirect("Meu CPF é 47999998888")).toBeNull();
    expect(telefoneDoDirect("Contato 47999998888 ou 47999997777")).toBeNull();
    expect(telefoneDoDirect("Telefone: 0047999998888")).toBeNull();
    expect(telefoneDoDirect("Exemplo abc47999998888xyz")).toBeNull();
  });

  it("omite identificadores e links do texto de entrada", () => {
    const privado = "Telefone +55 (47) 99999-8888, CPF 123.456.789-09, protocolo 123456, ana@exemplo.com, https://example.invalid/pagar";
    const resultado = textoSeguroDoDirect(privado);
    expect(resultado).toContain("Telefone");
    for (const segredo of ["99999", "123.456", "123456", "ana@", "example.invalid"]) expect(resultado).not.toContain(segredo);
  });

  it("preserva o login público oficial na resposta humana e oculta links pessoais ou de outro domínio", () => {
    vi.stubEnv("SITE_URL", "https://barbearia.exemplo.test");
    const login = "https://barbearia.exemplo.test/c/entrar";
    expect(textoDaEquipeNoDirect(`Acesse ${login}.`)).toBe(`Acesse ${login}.`);
    expect(textoDaEquipeNoDirect(`${login}?convite=particular`)).toBe("[link omitido]");
    expect(textoDaEquipeNoDirect(`${login}.externo.test`)).toBe("[link omitido]");
    expect(textoDaEquipeNoDirect(`https://barbearia.exemplo.test.externo.test/c/entrar`)).toBe("[link omitido]");
  });

  it.each([
    "Minha senha nova é Black.Teste@2026",
    "Meu código temporário de verificação é:\nABC.D123",
    "A senha nova da minha conta seria\nPinDeBrinquedo",
    "Código 123456",
  ])("omite a mensagem de credencial %s e direciona ao acesso autenticado", texto => {
    const guardado = textoSeguroDoDirect(texto);
    expect(guardado).toBe("[credencial omitida]");
    expect(pedidoPrivadoNoDirect(guardado)).toBe(true);
  });

  it("oculta endereço sem esquema e impede links ou confirmações fabricadas pelo modelo", () => {
    expect(textoSeguroDoDirect("Veja loja.exemplo.test/confirmar?id=9")).toBe("Veja [link omitido]");
    expect(textoDaEquipeNoDirect("www.fora.example/conta")).toBe("[link omitido]");
    for (const resposta of ["Entre em loja.exemplo.test/pagar", "Já reservei um horário para você.", "Agendei seu corte.", "Cancelei sua assinatura.", "Cobrei o valor no seu cartão."]) {
      expect(respostaModeloExigeEquipe(resposta)).toBe(true);
    }
    expect(respostaModeloExigeEquipe("O corte custa R$ 60,00. Posso consultar a disponibilidade.")).toBe(false);
  });

  it("distingue uma nova reserva do pedido que envolve uma conta ou horário existente", () => {
    expect(pedidoDeNovaReservaDirect("Quero agendar um corte")).toBe(true);
    expect(pedidoDeNovaReservaDirect("Gostaria de marcar barba e cabelo.")).toBe(true);
    expect(pedidoDeNovaReservaDirect("Quero agendar novamente meu horário")).toBe(false);
    expect(pedidoDeNovaReservaDirect("Quero remarcar meu corte")).toBe(false);
    expect(pedidoDeNovaReservaDirect("Quanto custa o corte?")).toBe(false);
  });
});
