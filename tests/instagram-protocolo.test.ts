import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assinaturaInstagramValida, desafioInstagram, lerEntradasInstagram } from "@/lib/instagram/protocolo";
import { dentroJanelaInstagram, enviarTextoInstagram, partesInstagram } from "@/lib/instagram/canal";
import { pedidoPrivadoNoDirect, respostaModeloExigeEquipe, telefoneDoDirect, textoDaEquipeNoDirect, textoSeguroDoDirect } from "@/lib/instagram/privacidade";

const perfil = "17841400000001";
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

  it("registra simulação por padrão e bloqueia rede mesmo com liberação em homologação", async () => {
    const rede = vi.fn<typeof fetch>();
    const envio = { igsid, texto: "Olá", sinal: new AbortController().signal };
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", undefined);
    expect(await enviarTextoInstagram(envio, rede)).toEqual({ simulado: true, mid: null });
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", "false");
    vi.stubEnv("AMBIENTE", "homologacao");
    expect(await enviarTextoInstagram(envio, rede)).toEqual({ simulado: true, mid: null });
    expect(rede).not.toHaveBeenCalled();
  });

  it("usa a conta profissional na URL, o IGSID no corpo e valida a confirmação sem expor erro da Meta", async () => {
    vi.stubEnv("AMBIENTE", "teste");
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", "false");
    vi.stubEnv("INSTAGRAM_PROFESSIONAL_ACCOUNT_ID", perfil);
    vi.stubEnv("INSTAGRAM_GRAPH_API_VERSION", "v27.0");
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "token-ficticio");
    const rede = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ recipient_id: igsid, message_id: "ig:aceito" }))
      .mockResolvedValueOnce(Response.json({ error: { message: "Credencial token-ficticio" } }, { status: 403 }));
    const dados = { igsid, texto: "Olá", sinal: new AbortController().signal };
    expect(await enviarTextoInstagram(dados, rede)).toEqual({ simulado: false, mid: "ig:aceito" });
    expect(rede).toHaveBeenCalledWith(`https://graph.instagram.com/v27.0/${perfil}/messages`, expect.objectContaining({
      method: "POST", redirect: "error", body: JSON.stringify({ recipient: { id: igsid }, message: { text: "Olá" } }),
    }));
    await expect(enviarTextoInstagram(dados, rede)).rejects.toThrow("O Instagram não confirmou o envio.");
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
});
