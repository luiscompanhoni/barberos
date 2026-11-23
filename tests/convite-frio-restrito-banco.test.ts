import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { landingDaCampanha, roletaComEnvioReservado } from "@/lib/campanhas/link";
import { rodarRetomadas } from "@/lib/convites/retomadas";
import { db } from "@/lib/db";
import { jogarPelaCampanha } from "@/lib/jogos/motor";
import { iniciarConviteApp } from "@/lib/whatsapp/convite-app";
import { obterConversa } from "@/lib/whatsapp/conversas";
import { registrarStatus } from "@/lib/whatsapp/status";

const habilitado = process.env.TESTE_CONVITE_APP_LOCAL === "1";
if (habilitado) {
  const banco = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(banco.hostname) || !banco.pathname.includes("teste")) {
    throw new Error("Use um banco de testes local descartável.");
  }
}

describe.skipIf(!habilitado)("convite de teste individual no simulador", () => {
  const campanhaId = "teste-automatico-leonel-frio";
  async function prepararRoleta() {
    const jogo = await db.jogo.create({ data: { id: randomUUID(), nome: "Roleta individual", tipo: "ROLETA", ativo: false, inicioEm: new Date(Date.now() + 7 * 86_400_000),
      premios: { create: { tipo: "DESCONTO", rotulo: "Desconto teste", percentual: 10, cor: "#000000", chanceBps: 10000 } } } });
    await db.campanha.upsert({ where: { id: campanhaId }, update: { jogoId: jogo.id, status: "PAUSADA" }, create: {
      id: campanhaId, nome: "Teste individual", segmentos: [], mensagem: "{link}", limiteDiario: 1, jogoId: jogo.id, status: "PAUSADA",
    } });
    return jogo;
  }
  beforeAll(async () => {
    vi.stubEnv("SITE_URL", "https://black.exemplo.test");
    vi.stubEnv("AMBIENTE", "homologacao");
    vi.stubEnv("WHATSAPP_PROVIDER", "simulador");
    vi.stubEnv("WHATSAPP_ATENDIMENTO_APOS_PILOTO", "true");
    for (const flag of ["WHATSAPP_ATENDIMENTO_IA_PAGA", "WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "BARBEROS_QUARENTENA_RESTAURACAO"]) vi.stubEnv(flag, "false");
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, botAtivo: true }, update: { botAtivo: true } });
  });
  afterAll(async () => { vi.unstubAllEnvs(); await db.$disconnect(); });

  it("exige o dono ativo no próprio telefone e revalida a campanha em cada etapa", async () => {
    const telefone = "55479" + randomInt(10000000, 99999999);
    const cliente = await db.cliente.create({ data: { nome: "Cliente sintético", telefone, aceitaMensagens: true } });
    const c = await obterConversa(telefone);
    const dono = await db.usuario.create({ data: { nome: "Dono sintético", telefone, papel: "GERENTE" } });
    const jogo = await prepararRoleta();
    const abrir = () => iniciarConviteApp(c.id, dono.id, false, true);
    vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "false");
    await expect(abrir()).rejects.toMatchObject({ status: 403 });
    await db.usuario.update({ where: { id: dono.id }, data: { papel: "DONO", ativo: false } });
    await expect(abrir()).rejects.toMatchObject({ status: 403 });
    await db.usuario.update({ where: { id: dono.id }, data: { ativo: true, telefone: randomUUID() } });
    await expect(abrir()).rejects.toMatchObject({ status: 403 });
    await db.usuario.update({ where: { id: dono.id }, data: { telefone } });
    vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
    await expect(abrir()).rejects.toMatchObject({ status: 409 });
    expect(await db.mensagem.count({ where: { conversaId: c.id } })).toBe(0);
    vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "false");
    await db.conversa.update({ where: { id: c.id }, data: { instagramIgsid: randomUUID() } });
    await expect(abrir()).rejects.toThrow(/WhatsApp/);
    expect(await db.jornadaConviteApp.findUnique({ where: { conversaId: c.id } })).toBeNull();
    await db.conversa.update({ where: { id: c.id }, data: { instagramIgsid: null } });
    expect(await abrir()).toEqual({ segmento: "frio" });
    const j = await db.jornadaConviteApp.findUniqueOrThrow({ where: { conversaId: c.id } });
    expect(j.token).toMatch(/^rott_[0-9a-f]{32}$/);
    const where = { token: j.token };
    const mudarEnvio = (data: Parameters<typeof db.campanhaEnvio.update>[0]["data"]) =>
      db.campanhaEnvio.update({ where, data });
    await mudarEnvio({ status: "PULADO", mensagemId: null });
    expect(await roletaComEnvioReservado(j.token)).toBe(true);
    expect(await landingDaCampanha(j.token)).toBeNull();
    await expect(jogarPelaCampanha(j.token)).rejects.toMatchObject({ status: 404 });
    const outra = await db.campanha.create({ data: {
      nome: "Outra campanha pausada", segmentos: [], mensagem: "{link}", limiteDiario: 1, jogoId: jogo.id, status: "PAUSADA",
    } });
    await mudarEnvio({ campanhaId: outra.id });
    expect(await roletaComEnvioReservado(j.token)).toBe(false);
    await mudarEnvio({ campanhaId, status: "ENVIADO", mensagemId: j.linkId, aberturaIniciadaEm: new Date() });
    expect(await landingDaCampanha(j.token)).toBeNull();
    await expect(jogarPelaCampanha(j.token)).rejects.toMatchObject({ status: 404 });
    await mudarEnvio({ aberturaIniciadaEm: null, enviadoEm: new Date(0) });
    expect(await landingDaCampanha(j.token)).toMatchObject({ jogo: { vencido: true } });
    await expect(jogarPelaCampanha(j.token)).rejects.toMatchObject({ status: 410 });
    await mudarEnvio({ enviadoEm: new Date() });
    const criadoEm = new Date();
    criadoEm.setUTCHours(23, 0, 0, 0);
    const wamid = randomUUID();
    await db.mensagem.update({ where: { id: j.linkId! }, data: { criadoEm, wamid } });
    await registrarStatus([{ wamid, status: "LIDA", quando: +criadoEm + 1000, erro: null }]);
    const prazo = +criadoEm + 1000 + 3_600_000;
    const rodar = (t: number) => rodarRetomadas(t, "America/Sao_Paulo", [cliente.id]);
    await mudarEnvio({ enviadoEm: new Date(0) });
    expect(await rodar(prazo)).toBe(0);
    expect((await db.jornadaConviteApp.findUniqueOrThrow({ where: { conversaId: c.id } })).proximaEm).toBeNull();
    await mudarEnvio({ enviadoEm: new Date() });
    await db.jornadaConviteApp.update({ where: { conversaId: c.id }, data: { proximaEm: new Date(prazo) } });
    expect(await rodar(prazo - 1)).toBe(0);
    for (const invalido of ["campanha", "lote", "status", "tipo"] as const) {
      if (invalido === "campanha") await mudarEnvio({ campanhaId: outra.id });
      if (invalido === "lote") await mudarEnvio({ lote: 1 });
      if (invalido === "status") await db.campanha.update({ where: { id: campanhaId }, data: { status: "ATIVA" } });
      if (invalido === "tipo") await db.jogo.update({ where: { id: jogo.id }, data: { tipo: "CAIXA" } });
      expect(await rodar(prazo)).toBe(0);
      expect((await landingDaCampanha(j.token))?.jogo?.ativo).toBeFalsy();
      await expect(jogarPelaCampanha(j.token, { ip: null })).rejects.toThrow();
      expect(await db.fichaJogo.count({ where: { clienteId: cliente.id } })).toBe(0);
      await mudarEnvio({ lote: 0, campanhaId });
      await db.campanha.update({ where: { id: campanhaId }, data: { status: "PAUSADA" } });
      await db.jogo.update({ where: { id: jogo.id }, data: { tipo: "ROLETA" } });
    }
    expect(await rodar(prazo)).toBe(1);
    expect(await rodar(prazo + 2 * 86_400_000)).toBe(0);
    expect(await landingDaCampanha(j.token)).toMatchObject({ jogo: { ativo: true } });
    const normal = "rotf_" + randomUUID().replaceAll("-", "");
    await db.campanhaEnvio.update({ where, data: { token: normal } });
    await expect(jogarPelaCampanha(normal, { ip: null })).rejects.toThrow();
    expect(await db.jogada.count({ where: { clienteId: cliente.id } })).toBe(0);
    await db.campanhaEnvio.update({ where: { token: normal }, data: { token: j.token } });
    const primeira = await jogarPelaCampanha(j.token, { ip: null });
    expect(primeira.jogada.premios).toHaveLength(1);
    expect(await jogarPelaCampanha(j.token)).toEqual({ jaJogou: true, jogada: primeira.jogada });
    await mudarEnvio({ lote: 1 });
    await expect(jogarPelaCampanha(j.token)).rejects.toThrow();
    // Uma queda após gravar a jogada pode deixar pendente a associação ao envio.
    await mudarEnvio({ token: normal, campanhaId: outra.id, jogadaId: null });
    expect((await jogarPelaCampanha(normal, { ip: null })).jogada.id).toBe(primeira.jogada.id);
    expect(await db.jogada.count({ where: { clienteId: cliente.id } })).toBe(1);
  });

  it("revalida a campanha depois de obter a trava de jogadas do cliente", async () => {
    const telefone = "55479" + randomInt(10000000, 99999999);
    const cliente = await db.cliente.create({ data: { nome: "Concorrência sintética", telefone } });
    await prepararRoleta();
    const token = "rott_" + randomUUID().replaceAll("-", "");
    await db.campanhaEnvio.create({ data: { token, campanhaId, clienteId: cliente.id, lote: 0, status: "ENVIADO", enviadoEm: new Date() } });
    let resultado!: Promise<PromiseSettledResult<Awaited<ReturnType<typeof jogarPelaCampanha>>>[]>;
    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`jogos:${cliente.id}`}))`;
      resultado = Promise.allSettled([jogarPelaCampanha(token, { ip: null })]);
      // A mudança de status acontece depois da consulta inicial do giro e antes de ele obter a trava.
      await expect.poll(async () => {
        const [estado] = await tx.$queryRaw<{ aguardando: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_locks WHERE NOT granted AND locktype = 'advisory'
            AND pg_backend_pid() = ANY(pg_blocking_pids(pid))) AS aguardando`;
        return estado.aguardando;
      }, { timeout: 3000 }).toBe(true);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campanha:${campanhaId}`}))`;
      await tx.campanha.update({ where: { id: campanhaId }, data: { status: "ATIVA" } });
    }, { timeout: 8000 });
    expect(await resultado).toMatchObject([{ status: "rejected", reason: { status: 404 } }]);
    expect(await db.jogada.count({ where: { clienteId: cliente.id } })).toBe(0);
    expect(await db.fichaJogo.count({ where: { clienteId: cliente.id } })).toBe(0);
  });
});
