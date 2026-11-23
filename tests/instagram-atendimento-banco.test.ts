import { createHmac, randomInt, randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { Modelo } from "@/lib/bot/agente";
import { concluirEntradaInstagram, enviarRespostaEquipeInstagram, registrarEntradaInstagram } from "@/lib/instagram/persistencia";
import { processarEntradaInstagram } from "@/lib/instagram/processar";
import { recuperarEntradasInstagramPendentes } from "@/lib/instagram/recuperacao";
import { ENVIO_INSTAGRAM_SIMULADO } from "@/lib/instagram/status";
import { excluirConta, exportarDados } from "@/lib/lgpd/titular";
import { obterConversa } from "@/lib/whatsapp/conversas";
import { GET as detalhes } from "@/app/api/conversas/[id]/route";
import { POST as receberDirect } from "@/app/api/instagram/webhook/route";

const depoisDaResposta = vi.hoisted(() => vi.fn<(processar: () => Promise<void>) => void>());
vi.mock("next/server", async importOriginal => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: depoisDaResposta,
}));
vi.mock("@/lib/auth/sessao", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth/sessao")>(),
  exigirSessao: async () => ({ usuarioId: "recepcao-teste", papel: "RECEPCAO" }),
}));

const habilitado = process.env.TESTE_INSTAGRAM_LOCAL === "1";
if (habilitado) {
  const banco = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(banco.hostname) || !banco.pathname.includes("teste")) {
    throw new Error("Use um banco de testes local descartável.");
  }
}

const igsid = () => `271${randomInt(100_000_000, 999_999_999)}`;
const mensagem = (id: string, texto: string, timestamp = Date.now()) => ({ igsid: id, mid: randomUUID(), texto, timestamp });

describe.skipIf(!habilitado)("conversas do Instagram Direct no banco", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  afterAll(() => db.$disconnect());

  it("aceita a entrega concorrente pelo login do Facebook e processa uma entrada sem eco", async () => {
    const perfil = "17841400000001";
    const segredoFicticio = randomUUID();
    vi.stubEnv("INSTAGRAM_PROVEDOR", "facebook_login");
    vi.stubEnv("INSTAGRAM_PAGE_ID", "887766");
    vi.stubEnv("INSTAGRAM_PROFESSIONAL_ACCOUNT_ID", perfil);
    vi.stubEnv("INSTAGRAM_APP_SECRET", segredoFicticio);
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", "true");
    vi.stubEnv("INSTAGRAM_ATENDIMENTO_IA_PAGA", "false");
    vi.stubEnv("SITE_URL", "https://barbearia.exemplo.test");
    const rede = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", rede);
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, botAtivo: true }, update: { botAtivo: true } });

    const entrada = mensagem(igsid(), "Quero agendar um corte", Date.now() - 1_000);
    const ecoMid = randomUUID();
    const corpo = JSON.stringify({ object: "instagram", entry: [{ id: perfil, time: entrada.timestamp, messaging: [
      { sender: { id: entrada.igsid }, recipient: { id: perfil }, timestamp: entrada.timestamp,
        message: { mid: entrada.mid, text: entrada.texto } },
      { sender: { id: perfil }, recipient: { id: entrada.igsid }, timestamp: entrada.timestamp,
        message: { mid: ecoMid, text: "Resposta anterior da equipe", is_echo: true } },
    ] }] });
    const assinatura = `sha256=${createHmac("sha256", segredoFicticio).update(corpo).digest("hex")}`;
    const requisicao = () => new Request("https://painel.exemplo.test/api/instagram/webhook", {
      method: "POST", body: corpo, headers: { "content-type": "application/json", "x-hub-signature-256": assinatura },
    });

    depoisDaResposta.mockClear();
    const respostas = await Promise.all([receberDirect(requisicao()), receberDirect(requisicao())]);
    expect(respostas.map(resposta => resposta.status)).toEqual([200, 200]);
    expect(depoisDaResposta).toHaveBeenCalledOnce();
    const conversa = await db.conversa.findUniqueOrThrow({ where: { instagramIgsid: entrada.igsid }, include: { mensagens: true } });
    expect(conversa.naoLidas).toBe(1);
    expect(conversa.mensagens).toMatchObject([
      { autor: "CLIENTE", wamid: `instagram:${entrada.mid}`, texto: entrada.texto, instagramPendenteEm: expect.any(Date) },
    ]);
    expect(await db.mensagem.findUnique({ where: { wamid: `instagram:${ecoMid}` } })).toBeNull();

    await depoisDaResposta.mock.calls[0][0]();
    const mensagens = await db.mensagem.findMany({ where: { conversaId: conversa.id }, orderBy: { criadoEm: "asc" } });
    expect(mensagens).toMatchObject([
      { autor: "CLIENTE", wamid: `instagram:${entrada.mid}`, instagramPendenteEm: null },
      { autor: "BOT", wamid: null, erro: ENVIO_INSTAGRAM_SIMULADO, texto: expect.stringContaining("https://barbearia.exemplo.test/c/agendar") },
    ]);
    expect(rede).not.toHaveBeenCalled();
  });

  it("deduplica o mesmo MID em requisições concorrentes e preserva a janela mais recente", async () => {
    const id = igsid();
    const agora = Date.now();
    const entrada = mensagem(id, "Oi", agora - 1_000);
    const resultados = await Promise.all([registrarEntradaInstagram(entrada), registrarEntradaInstagram(entrada)]);
    expect(resultados.filter(Boolean)).toHaveLength(1);
    await registrarEntradaInstagram(mensagem(id, "mais antiga", agora - 2_000));
    const conversa = await db.conversa.findUniqueOrThrow({ where: { instagramIgsid: id }, include: { mensagens: true } });
    expect(conversa.telefone).toBe(`instagram:${id}`);
    expect(conversa.naoLidas).toBe(2);
    expect(+conversa.ultimaEntradaEm!).toBe(agora - 1_000);
    expect(conversa.mensagens.map(m => m.wamid)).toContain(`instagram:${entrada.mid}`);
  });

  it("encaminha uma entrada abandonada após cinco minutos uma única vez e sem resposta", async () => {
    const agora = new Date();
    const e = mensagem(igsid(), "Quero saber o preço de um corte", +agora - 9 * 60_000);
    const entrada = (await registrarEntradaInstagram(e))!;
    const where = { wamid: `instagram:${e.mid}` };
    const antes = await db.mensagem.findUniqueOrThrow({ where });
    expect(+antes.instagramPendenteEm!).toBeGreaterThanOrEqual(+agora);
    expect(await registrarEntradaInstagram(e)).toBeNull();
    expect(await db.mensagem.findUnique({ where })).toMatchObject({ instagramPendenteEm: antes.instagramPendenteEm });

    const rede = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", rede);
    await recuperarEntradasInstagramPendentes(agora);
    expect(await db.conversa.findUnique({ where: { id: entrada.conversaId } })).toMatchObject({ estado: "BOT" });
    await db.mensagem.update({ where, data: { instagramPendenteEm: new Date(+agora - 5 * 60_000) } });
    await Promise.all([recuperarEntradasInstagramPendentes(agora), recuperarEntradasInstagramPendentes(agora)]);
    await recuperarEntradasInstagramPendentes(agora);
    expect(await registrarEntradaInstagram(e)).toBeNull();
    const c = await db.conversa.findUniqueOrThrow({ where: { id: entrada.conversaId }, include: { mensagens: true } });
    expect(c.estado).toBe("HUMANO");
    expect(c.mensagens.map(m => m.autor).sort()).toEqual(["CLIENTE", "NOTA"]);
    expect(c.mensagens.find(m => m.autor === "NOTA")?.texto).toContain("A equipe");
    expect(c.mensagens.find(m => m.autor === "CLIENTE")?.instagramPendenteEm).toBeNull();
    expect(rede).not.toHaveBeenCalled();
  });

  it("limpa por MID e deixa o turno mais recente sob controle do bot", async () => {
    const id = igsid();
    const agora = new Date();
    const velha = (await registrarEntradaInstagram(mensagem(id, "primeira", +agora - 2_000)))!;
    const pendente = (await registrarEntradaInstagram(mensagem(id, "segunda", +agora - 1_000)))!;
    const recente = (await registrarEntradaInstagram(mensagem(id, "terceira", +agora)))!;
    await concluirEntradaInstagram(velha);
    const where = (mid: string) => ({ wamid: `instagram:${mid}` });
    expect(await db.mensagem.findUnique({ where: where(recente.mid) })).toMatchObject({ instagramPendenteEm: expect.any(Date) });
    await db.mensagem.update({ where: where(pendente.mid), data: { instagramPendenteEm: new Date(+agora - 6 * 60_000) } });
    await recuperarEntradasInstagramPendentes(agora);
    expect(await db.mensagem.findUnique({ where: where(velha.mid) })).toMatchObject({ instagramPendenteEm: null });
    expect(await db.mensagem.findUnique({ where: where(pendente.mid) })).toMatchObject({ instagramPendenteEm: null });
    expect(await db.mensagem.findUnique({ where: where(recente.mid) })).toMatchObject({ instagramPendenteEm: expect.any(Date) });
    expect(await db.conversa.findUnique({ where: { id: recente.conversaId } })).toMatchObject({ estado: "BOT" });
    await concluirEntradaInstagram(recente);
  });

  it("vincula só ao CRM, conserva WhatsApp e redireciona dados privados ao login sem modelo", async () => {
    const id = igsid();
    const telefone = `55479${randomInt(10_000_000, 99_999_999)}`;
    const cliente = await db.cliente.create({ data: { nome: "Cliente de terceiro", telefone } });
    const whatsapp = await obterConversa(telefone);
    vi.stubEnv("SITE_URL", "https://barbearia.exemplo.test");
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", "true");
    const criar = vi.fn<Modelo["criar"]>();
    const entrada = mensagem(id, `Qual o status da minha assinatura? Meu WhatsApp é ${telefone}.`);
    const registrada = (await registrarEntradaInstagram(entrada))!;
    await processarEntradaInstagram(registrada, { modelo: { criar } });
    const conversa = await db.conversa.findUniqueOrThrow({ where: { instagramIgsid: id }, include: { mensagens: true } });
    expect(conversa.clienteId).toBeNull();
    expect(conversa.instagramClienteId).toBe(cliente.id);
    expect(whatsapp.clienteId).toBe(cliente.id);
    expect(conversa.mensagens).toEqual(expect.arrayContaining([
      expect.objectContaining({ autor: "BOT", texto: expect.stringContaining("https://barbearia.exemplo.test/c/entrar"), wamid: null }),
    ]));
    expect(conversa.mensagens.find(m => m.autor === "CLIENTE")?.instagramPendenteEm).toBeNull();
    expect(conversa.mensagens.map(m => m.texto).join(" ")).not.toContain(telefone);
    expect(conversa.mensagens.map(m => m.texto).join(" ")).not.toContain(cliente.nome);
    expect(criar).not.toHaveBeenCalled();
  });

  it("a equipe assume pelo Direct simulado e a resposta do bot em andamento é descartada", async () => {
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", "true");
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, botAtivo: true }, update: { botAtivo: true } });
    const entrada = (await registrarEntradaInstagram(mensagem(igsid(), "Quanto custa o corte?")))!;
    const criar: Modelo["criar"] = async () => {
      await enviarRespostaEquipeInstagram(entrada.conversaId, "Olá, aqui é da equipe.", "teste-equipe");
      return { content: [{ type: "text", text: "Resposta atrasada do modelo", citations: null }], stop_reason: "end_turn" } as Awaited<ReturnType<Modelo["criar"]>>;
    };
    await processarEntradaInstagram(entrada, { modelo: { criar } });
    const conversa = await db.conversa.findUniqueOrThrow({ where: { id: entrada.conversaId }, include: { mensagens: true } });
    expect(conversa.estado).toBe("HUMANO");
    expect(conversa.mensagens.some(m => m.autor === "EQUIPE" && m.wamid === null)).toBe(true);
    expect(conversa.mensagens.some(m => m.autor === "BOT")).toBe(false);
  });

  it("usa uma chave por envio humano e aplica a janela mesmo quando o transporte está simulado", async () => {
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", "true");
    const entrada = (await registrarEntradaInstagram(mensagem(igsid(), "Olá")))!;
    const envioId = randomUUID();
    await Promise.all([
      enviarRespostaEquipeInstagram(entrada.conversaId, "Oi, aqui é da equipe.", "teste-equipe", envioId),
      enviarRespostaEquipeInstagram(entrada.conversaId, "Oi, aqui é da equipe.", "teste-equipe", envioId),
    ]);
    expect(await db.mensagem.count({ where: { conversaId: entrada.conversaId, autor: "EQUIPE" } })).toBe(1);
    await expect(enviarRespostaEquipeInstagram(entrada.conversaId, "Uma resposta diferente.", "teste-equipe", envioId))
      .rejects.toMatchObject({ status: 409 });
    const antiga = (await registrarEntradaInstagram(mensagem(igsid(), "Olá", Date.now() - 24 * 3_600_000)))!;
    await expect(enviarRespostaEquipeInstagram(antiga.conversaId, "Oi", "teste-equipe")).rejects.toThrow("A janela de 24h do Instagram fechou");
    expect(await db.mensagem.count({ where: { conversaId: antiga.conversaId, autor: "EQUIPE" } })).toBe(0);
  });

  it("redige credencial em várias linhas e usa o acesso autenticado sem chamar o modelo", async () => {
    vi.stubEnv("SITE_URL", "https://barbearia.exemplo.test");
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", "true");
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, botAtivo: true }, update: { botAtivo: true } });
    const criar = vi.fn<Modelo["criar"]>();
    const entrada = (await registrarEntradaInstagram(mensagem(igsid(), "Minha senha nova é:\nBlack.Ficticia-ABC")))!;
    await processarEntradaInstagram(entrada, { modelo: { criar } });
    const mensagens = await db.mensagem.findMany({ where: { conversaId: entrada.conversaId }, orderBy: { criadoEm: "asc" } });
    expect(mensagens.map(m => m.texto)).toEqual(["[credencial omitida]", expect.stringContaining("https://barbearia.exemplo.test/c/entrar")]);
    expect(criar).not.toHaveBeenCalled();
  });

  it("orienta uma nova reserva pelo caminho oficial da agenda sem chamar o modelo ou reservar", async () => {
    vi.stubEnv("SITE_URL", "https://barbearia.exemplo.test");
    vi.stubEnv("INSTAGRAM_ENVIOS_BLOQUEADOS", "true");
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, botAtivo: true }, update: { botAtivo: true } });
    const criar = vi.fn<Modelo["criar"]>();
    const entrada = (await registrarEntradaInstagram(mensagem(igsid(), "Quero agendar um corte")))!;
    await processarEntradaInstagram(entrada, { modelo: { criar } });
    const respostas = await db.mensagem.findMany({ where: { conversaId: entrada.conversaId, autor: "BOT" } });
    expect(respostas).toHaveLength(1);
    expect(respostas[0].texto).toContain("https://barbearia.exemplo.test/c/agendar");
    expect(respostas[0].texto).not.toContain("/c/entrar");
    expect(criar).not.toHaveBeenCalled();
  });

  it("exibe as 300 mensagens recentes em ordem cronológica antes de marcar como lido", async () => {
    const base = Date.now() - 1_000;
    const entrada = (await registrarEntradaInstagram(mensagem(igsid(), "primeira", base)))!;
    await db.mensagem.createMany({ data: Array.from({ length: 305 }, (_, i) => ({
      autor: "CLIENTE", texto: `mensagem ${i + 1}`, criadoEm: new Date(base + i + 1), conversaId: entrada.conversaId,
    })) });
    const resposta = await detalhes(new Request("http://localhost/api/conversas"), { params: Promise.resolve({ id: entrada.conversaId }) });
    expect(resposta.status).toBe(200);
    const { mensagens: recentes } = await resposta.json();
    expect(recentes).toHaveLength(300);
    expect(recentes[0].texto).toBe("mensagem 6");
    expect(recentes.at(-1).texto).toBe("mensagem 305");
    expect(await db.conversa.findUnique({ where: { id: entrada.conversaId } })).toMatchObject({ naoLidas: 0 });
  });

  it("exporta o próprio aceite, desvincula o Direct e remove IP e navegador na exclusão", async () => {
    const telefone = `55479${randomInt(10_000_000, 99_999_999)}`;
    const usuario = await db.usuario.create({ data: { telefone, nome: "Titular de teste", papel: "CLIENTE" } });
    const cliente = await db.cliente.create({ data: { telefone, nome: usuario.nome, usuarioId: usuario.id } });
    const entrada = (await registrarEntradaInstagram(mensagem(igsid(), `Contato: ${telefone}. Mensagem do perfil que informou o número.`)))!;
    const plano = await db.plano.create({ data: { nome: "Plano de teste LGPD", precoCentavos: 1_000, ativo: false } });
    const assinatura = await db.assinatura.create({ data: {
      clienteId: cliente.id, planoId: plano.id, precoCentavos: 1_000, origem: "SITE", formaPagamento: "CARTAO", status: "CANCELADA",
      ofertaDezembro: { create: {
        chaveIdempotencia: randomUUID(), termosVersao: "teste-lgpd", precoCentavos: 1_000, limiteUsos: 2, aceitaEm: new Date(), ip: "192.0.2.20", agenteUsuario: "Navegador fictício",
      } },
    } });
    const exportacao = await exportarDados(cliente.id);
    expect(exportacao.dados.assinaturas[0].ofertaDezembro).toMatchObject({ termosVersao: "teste-lgpd", ip: "192.0.2.20", agenteUsuario: "Navegador fictício" });
    expect(JSON.stringify(exportacao)).not.toContain("chaveIdempotencia");
    expect(JSON.stringify(exportacao)).not.toContain("Mensagem do perfil");
    await excluirConta(cliente.id, usuario.id);
    expect(await db.conversa.findUnique({ where: { id: entrada.conversaId } })).toMatchObject({ instagramClienteId: null });
    expect(await db.ofertaDezembroAdesao.findUnique({ where: { assinaturaId: assinatura.id } })).toMatchObject({
      termosVersao: "teste-lgpd", precoCentavos: 1_000, ip: null, agenteUsuario: null,
    });
  });
});
