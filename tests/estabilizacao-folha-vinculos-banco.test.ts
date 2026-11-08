import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { Sessao } from "@/lib/auth/sessao";
import { exportarCsv, fecharFolha, previaFolha } from "@/lib/rh/folha";
import { salvarFicha } from "@/lib/rh/funcionarios";
import { gravarVigenciaRemuneracao, lerVigenciaRemuneracao } from "@/lib/rh/vigencias";
import type { RegraSalva } from "@/lib/rh/regras";
import { configExtras, salvarExtras } from "@/lib/rh/pote";
import { extrasNaCompetencia } from "@/lib/rh/config-calculo";

const injecao = vi.hoisted(() => ({ barreira: null as { acao: string; entrou: (pid: number) => void; liberar: Promise<void> } | null }));
vi.mock("@/lib/auditoria", async () => {
  const real = await vi.importActual<typeof import("@/lib/auditoria")>("@/lib/auditoria");
  async function pausar(tx: Parameters<typeof real.auditar>[0], acao: string) {
    const b = injecao.barreira;
    if (b?.acao !== acao) return;
    const [r] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    b.entrou(r.pid); await b.liberar;
  }
  return { ...real,
    auditar: async (...args: Parameters<typeof real.auditar>) => { await real.auditar(...args); await pausar(args[0], args[2]); },
    auditarMudanca: async (...args: Parameters<typeof real.auditarMudanca>) => { await real.auditarMudanca(...args); await pausar(args[0], args[2]); },
  };
});
const ativo = process.env.TESTE_ESTABILIZACAO_FINANCEIRO_LOCAL === "1";
if (ativo) {
  const u = new URL(process.env.DATABASE_URL ?? "");
  if (u.hostname !== "127.0.0.1" || u.port !== "55439" || !u.pathname.startsWith("/barberos_ci_local_estabilizacao_")) throw Error("Exige banco financeiro local descartável.");
}
let s: Sessao, observador: PrismaClient;
let ano = 2100;
const entradaExtras = (competencia: string, revisao: string, percentualBps = 3500) => ({ competencia, revisao,
  assinaturas: { ativo: false, percentualBps, arredondamento: "MAIORES_RESTOS_V1" as const, creditos: [] }, faixas: [],
});
async function fixture(mes: string, ligado = false) {
  const tag = randomUUID();
  const u = await db.usuario.create({ data: { nome: "Cadeira fictícia", telefone: `cadeira-${tag}`, papel: "BARBEIRO" } });
  const b = await db.barbeiro.create({ data: { nome: "Cadeira fictícia", usuarioId: u.id } });
  const p = await db.checklistPessoa.create({ data: { nome: "Pessoa fictícia", telefone: `pessoa-${tag}`, token: tag, funcao: "BARBEIRO", barbeiroId: ligado ? b.id : null, salarioCentavos: 1000 } });
  const cliente = await db.cliente.create({ data: { nome: "Cliente fictício", telefone: `cliente-${tag}` } });
  const sv = await db.servico.create({ data: { nome: `Serviço fictício ${tag}`, duracaoMin: 30, precoCentavos: 10000 } });
  const regra: RegraSalva = { servicoId: sv.id, barbeiroId: null, avulsoTipo: "PERCENTUAL", avulsoValor: 2000, planoTipo: "FIXO", planoValor: 0 };
  await db.comissaoServico.create({ data: regra });
  const vigente = await lerVigenciaRemuneracao<RegraSalva[]>(db, "servicos", mes);
  await db.$transaction(tx => gravarVigenciaRemuneracao(tx, { escopo: "servicos", competencia: mes, conteudo: [...(vigente?.conteudo ?? []), regra], atorId: s.usuarioId }));
  await db.agendamento.create({ data: { clienteId: cliente.id, barbeiroId: b.id, servicoId: sv.id, inicio: new Date(`${mes}-06T10:00:00-03:00`), fim: new Date(`${mes}-06T10:30:00-03:00`), precoCentavos: 10000, origem: "PAINEL", status: "CONCLUIDO" } });
  return { p, b };
}
async function corrida(acao: string, primeira: () => Promise<unknown>, segunda: () => Promise<unknown>) {
  let avisar!: (pid: number) => void, liberar!: () => void;
  const entrou = new Promise<number>(r => { avisar = r; }), aguardar = new Promise<void>(r => { liberar = r; });
  injecao.barreira = { acao, entrou: avisar, liberar: aguardar };
  const a = primeira();
  let b: Promise<unknown> | undefined;
  try {
    const pid = await Promise.race([entrou, a.then(() => { throw Error("A primeira operação não atingiu a barreira."); })]);
    b = segunda();
    await vi.waitFor(async () => {
      const [r] = await observador.$queryRaw<{ esperando: boolean }[]>`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity x WHERE x.datname = current_database()
        AND x.pid <> pg_backend_pid() AND ${pid} = ANY(pg_blocking_pids(x.pid))
        AND x.query LIKE '%checklist_pessoas%' AND x.query LIKE '%FOR UPDATE%'
      ) AS esperando`;
      expect(r.esperando).toBe(true);
    }, { timeout: 3000, interval: 20 });
    liberar();
    return await Promise.allSettled([a, b]);
  } finally { injecao.barreira = null; liberar(); await Promise.allSettled(b ? [a, b] : [a]); }
}

describe.skipIf(!ativo)("vínculos de folha no PostgreSQL descartável", () => {
  beforeAll(async () => {
    vi.stubGlobal("fetch", async () => { throw Error("Rede externa bloqueada"); });
    const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("connection_limit", "1");
    observador = new PrismaClient({ datasources: { db: { url: url.href } } });
    const u = await db.usuario.create({ data: { nome: "Dono fictício dos vínculos", telefone: `dono-${randomUUID()}`, papel: "DONO" } });
    s = { usuarioId: u.id, papel: "DONO", nome: u.nome, sessaoVersao: 0 } as Sessao;
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    while (await db.folhaPagamento.count({ where: { competencia: { startsWith: `${ano}-` } } })) ano++;
  });
  afterAll(async () => { await Promise.all([db.$disconnect(), observador?.$disconnect()]); vi.unstubAllGlobals(); });

  it("omissão impede fechamento geral e CSV sem escrita; recepção individual continua possível", async () => {
    const comp = `${ano}-01`, { p, b } = await fixture(comp);
    const tag = randomUUID();
    const recepcao = await db.checklistPessoa.create({ data: { nome: "Recepção fictícia", telefone: `recepcao-${tag}`, token: tag, funcao: "GERENTE", salarioCentavos: 10000 } });
    const previa = await previaFolha(comp);
    expect(previa.pendenciasVinculos).toContainEqual({ barbeiroId: b.id, nome: b.nome, comissaoCentavos: 2000, motivo: "SEM_VINCULO" });
    const antes = await db.auditoria.count({ where: { acao: "rh_folha_fechar", entidadeId: comp } });
    await expect(fecharFolha(s, comp, undefined, previa.revisao)).rejects.toMatchObject({ codigo: "vinculo_comissao_pendente" });
    await expect(fecharFolha(s, comp, p.id, previa.revisao)).rejects.toMatchObject({ codigo: "vinculo_comissao_pendente" });
    await expect(exportarCsv(comp)).rejects.toMatchObject({ codigo: "vinculo_comissao_pendente" });
    expect(await db.folhaPagamento.count({ where: { competencia: comp } })).toBe(0);
    expect(await db.auditoria.count({ where: { acao: "rh_folha_fechar", entidadeId: comp } })).toBe(antes);
    expect(await fecharFolha(s, comp, recepcao.id, previa.revisao)).toBe(1);
    const f = await db.folhaPagamento.findUniqueOrThrow({ where: { competencia_pessoaId: { competencia: comp, pessoaId: recepcao.id } } });
    expect(f.comissaoCentavos).toBe(0); expect(f.liquidoCentavos).toBe(10000);
  });
  it("produção de ficha inativa fica explícita e retrato histórico permanece após desvinculação", async () => {
    const comp = `${ano}-02`, { p, b } = await fixture(comp, true);
    await db.checklistPessoa.update({ where: { id: p.id }, data: { ativo: false } });
    expect((await previaFolha(comp)).pendenciasVinculos).toContainEqual({ barbeiroId: b.id, nome: b.nome, comissaoCentavos: 2000, motivo: "INATIVO" });
    await db.checklistPessoa.update({ where: { id: p.id }, data: { ativo: true } });
    const previa = await previaFolha(comp); await fecharFolha(s, comp, p.id, previa.revisao);
    const antes = await db.folhaPagamento.findUniqueOrThrow({ where: { competencia_pessoaId: { competencia: comp, pessoaId: p.id } } });
    await db.checklistPessoa.update({ where: { id: p.id }, data: { ativo: false, barbeiroId: null, salarioCentavos: 999999 } });
    const atual = await previaFolha(comp);
    expect(atual.pendenciasVinculos).toEqual([]);
    expect(atual.linhas.find(l => l.pessoaId === p.id)).toMatchObject({ barbeiroId: b.id, vinculoPendente: false, salario: 1000, comissao: 2000, liquido: 3000 });
    expect(await db.folhaPagamento.findUniqueOrThrow({ where: { id: antes.id } })).toEqual(antes);
  });
  it("salvar vínculo vence sob lock e fechamento rejeita sua prévia antiga", async () => {
    const comp = `${ano}-03`, { p, b } = await fixture(comp);
    const previa = await previaFolha(comp);
    const r = await corrida("rh_ficha", () => salvarFicha(s, p.id, { cargo: p.cargo, salarioCentavos: p.salarioCentavos, admissao: null, barbeiroId: b.id }), () => fecharFolha(s, comp, p.id, previa.revisao));
    expect(r[0].status).toBe("fulfilled"); expect(r[1]).toMatchObject({ status: "rejected", reason: { codigo: "folha_mudou", status: 409 } });
    expect(await db.folhaPagamento.count({ where: { pessoaId: p.id, competencia: comp } })).toBe(0);
  });
  it("fechamento vence e desvinculação posterior não reescreve a cadeira congelada", async () => {
    const comp = `${ano}-04`, { p, b } = await fixture(comp, true);
    const previa = await previaFolha(comp);
    const r = await corrida("rh_folha_fechar", () => fecharFolha(s, comp, p.id, previa.revisao), () => salvarFicha(s, p.id, { cargo: p.cargo, salarioCentavos: p.salarioCentavos, admissao: null, barbeiroId: null }));
    expect(r.map(x => x.status)).toEqual(["fulfilled", "fulfilled"]);
    const f = await db.folhaPagamento.findUniqueOrThrow({ where: { competencia_pessoaId: { competencia: comp, pessoaId: p.id } } });
    expect(f.barbeiroIdCongelado).toBe(b.id); expect(f.comissaoCentavos).toBe(2000);
    expect((await db.checklistPessoa.findUniqueOrThrow({ where: { id: p.id } })).barbeiroId).toBeNull();
    expect((await previaFolha(comp)).pendenciasVinculos).toEqual([]);
  });
  it("método MR grava enum e versão explícita, preserva baseline e recusa mês fechado ou pago", async () => {
    const comp = `${ano}-05`, anterior = `${ano}-04`, config = await configExtras();
    const antes = await extrasNaCompetencia(anterior);
    expect(antes.assinaturas.arredondamento).toBe("LEGADO");
    await salvarExtras(s, entradaExtras(comp, config.revisao));
    expect((await db.poteConfig.findUniqueOrThrow({ where: { id: "pote" } })).arredondamento).toBe("MAIORES_RESTOS_V1");
    const baseline = await lerVigenciaRemuneracao<{ assinaturas: { arredondamento: string } }>(db, "extras", anterior);
    const vigente = await lerVigenciaRemuneracao<{ assinaturas: { arredondamento: string } }>(db, "extras", comp);
    expect(baseline).toMatchObject({ competencia: "0001-01", origem: "BASELINE_LEGADO_NAO_HOMOLOGADO", conteudo: { assinaturas: { arredondamento: "LEGADO" } } });
    expect(vigente).toMatchObject({ competencia: comp, origem: "CONFIGURACAO_EXPLICITA", conteudo: { assinaturas: { arredondamento: "MAIORES_RESTOS_V1" } } });
    expect(await extrasNaCompetencia(anterior)).toEqual(antes);
    const mesFechado = `${ano}-07`, { p } = await fixture(mesFechado, true), previa = await previaFolha(mesFechado);
    await fecharFolha(s, mesFechado, p.id, previa.revisao);
    const historicoAntes = await db.remuneracaoVersao.findMany({ where: { escopo: "extras" }, orderBy: { id: "asc" } });
    const rascunhoAntes = await db.poteConfig.findUniqueOrThrow({ where: { id: "pote" } });
    const rejeitada = entradaExtras(mesFechado, (await configExtras()).revisao, 4000);
    await expect(salvarExtras(s, rejeitada)).rejects.toMatchObject({ codigo: "folha_fechada" });
    await db.folhaPagamento.update({ where: { competencia_pessoaId: { competencia: mesFechado, pessoaId: p.id } }, data: { status: "PAGA" } });
    await expect(salvarExtras(s, rejeitada)).rejects.toMatchObject({ codigo: "folha_fechada" });
    expect(await db.remuneracaoVersao.findMany({ where: { escopo: "extras" }, orderBy: { id: "asc" } })).toEqual(historicoAntes);
    expect(await db.poteConfig.findUniqueOrThrow({ where: { id: "pote" } })).toEqual(rascunhoAntes);
  });
  it("duas alterações com a mesma revisão aceitam só uma e preservam todas as versões anteriores", async () => {
    const comp = `${ano}-06`, config = await configExtras();
    const antes = await db.remuneracaoVersao.findMany({ where: { escopo: "extras" }, orderBy: { id: "asc" } });
    const r = await Promise.allSettled([salvarExtras(s, entradaExtras(comp, config.revisao, 4000)), salvarExtras(s, entradaExtras(comp, config.revisao, 4500))]);
    expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(r.find(x => x.status === "rejected")).toMatchObject({ reason: { codigo: "comissoes_mudaram" } });
    const depois = await db.remuneracaoVersao.findMany({ where: { escopo: "extras" }, orderBy: { id: "asc" } });
    expect(depois.filter(x => antes.some(a => a.id === x.id))).toEqual(antes);
    expect(depois.filter(x => x.competencia === comp)).toHaveLength(1);
    const vigente = await extrasNaCompetencia(comp);
    expect(vigente.assinaturas.arredondamento).toBe("MAIORES_RESTOS_V1");
    expect([4000, 4500]).toContain(vigente.assinaturas.percentualBps);
  });
});
