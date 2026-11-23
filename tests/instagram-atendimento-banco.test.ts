import { randomInt, randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { Modelo } from "@/lib/bot/agente";
import { enviarRespostaEquipeInstagram, registrarEntradaInstagram } from "@/lib/instagram/persistencia";
import { processarEntradaInstagram } from "@/lib/instagram/processar";
import { obterConversa } from "@/lib/whatsapp/conversas";

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
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => db.$disconnect());

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
    const antiga = (await registrarEntradaInstagram(mensagem(igsid(), "Olá", Date.now() - 24 * 3_600_000)))!;
    await expect(enviarRespostaEquipeInstagram(antiga.conversaId, "Oi", "teste-equipe")).rejects.toThrow("A janela de 24h do Instagram fechou");
    expect(await db.mensagem.count({ where: { conversaId: antiga.conversaId, autor: "EQUIPE" } })).toBe(0);
  });
});
