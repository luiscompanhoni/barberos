import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { Sessao } from "@/lib/auth/sessao";
import { criarAdicional, encerrarAdicional, excluirAdicional } from "@/lib/rh/adicionais";
import { fecharFolha, previaFolha } from "@/lib/rh/folha";

const injecao = vi.hoisted(() => ({ barreira: null as { entrou: (pid: number) => void; liberar: Promise<void> } | null }));
vi.mock("@/lib/auditoria", async () => {
  const real = await vi.importActual<typeof import("@/lib/auditoria")>("@/lib/auditoria");
  return { ...real, auditar: async (...args: Parameters<typeof real.auditar>) => {
    await real.auditar(...args);
    if (args[2] === "rh_adicional_criar" && injecao.barreira) {
      const b = injecao.barreira;
      const [sessao] = await args[0].$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      b.entrou(sessao.pid); await b.liberar;
    }
  } };
});
const ativo = process.env.TESTE_ESTABILIZACAO_FINANCEIRO_LOCAL === "1";
if (ativo) {
  const u = new URL(process.env.DATABASE_URL ?? "");
  if (u.hostname !== "127.0.0.1" || u.port !== "55439" || !u.pathname.startsWith("/barberos_ci_local_estabilizacao_")) throw Error("Exige banco financeiro local descartável.");
}
let s: Sessao;
let anoTeste = 2098;
async function funcionario() {
  const id = randomUUID();
  const u = await db.usuario.create({ data: { nome: "Barbeiro adicional fictício", telefone: `adicional-${id}`, papel: "BARBEIRO" } });
  const b = await db.barbeiro.create({ data: { nome: "Profissional adicional fictício", usuarioId: u.id } });
  const p = await db.checklistPessoa.create({ data: { nome: "Funcionário adicional fictício", telefone: `pessoa-${id}`, token: id, funcao: "BARBEIRO", barbeiroId: b.id, salarioCentavos: 10000 } });
  return { p, b };
}
const entrada = (barbeiroId: string, mes: string) => ({ barbeiroId, modalidade: "AVULSO" as const, pontosBps: 500, motivo: "Evidência sintética adicional", inicio: `${mes}-01`, fim: `${mes}-28` });
async function esperarBloqueio(pid: number) {
  const limite = Date.now() + 4000;
  while (Date.now() < limite) {
    const [r] = await db.$queryRaw<{ esperando: boolean }[]>`SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity a WHERE a.pid <> pg_backend_pid()
      AND ${pid} = ANY(pg_blocking_pids(a.pid)) AND a.query LIKE '%checklist_pessoas%'
    ) AS esperando`;
    if (r.esperando) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error("O fechamento não aguardou a trava transacional do adicional.");
}

describe.skipIf(!ativo)("adicionais atômicos no PostgreSQL sintético", () => {
  beforeAll(async () => {
    vi.stubGlobal("fetch", async () => { throw Error("Rede externa bloqueada"); });
    const u = await db.usuario.create({ data: { nome: "Dono adicional fictício", telefone: `dono-adicional-${randomUUID()}`, papel: "DONO" } });
    s = { usuarioId: u.id, papel: "DONO", nome: u.nome, sessaoVersao: 0 } as Sessao;
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const fechadas = await db.folhaPagamento.findMany({ distinct: ["competencia"], select: { competencia: true } });
    while (fechadas.some(f => f.competencia.startsWith(`${anoTeste}-`))) anoTeste++;
  });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllGlobals(); });

  it("duas criações concorrentes aceitam só uma vigência sobreposta", async () => {
    const { b } = await funcionario(), mes = `${anoTeste}-01`, d = entrada(b.id, mes);
    const r = await Promise.allSettled([criarAdicional(s, d), criarAdicional(s, { ...d, inicio: `${mes}-02` })]);
    expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.adicionalComissao.count({ where: { barbeiroId: b.id } })).toBe(1);
  });
  it("fecho já em snapshot aguardando adicional recusa os valores anteriores", async () => {
    const { p, b } = await funcionario(), mes = `${anoTeste}-02`, previa = await previaFolha(mes);
    let avisar!: (pid: number) => void, liberar!: () => void;
    const entrou = new Promise<number>(resolve => { avisar = resolve; }), aguardando = new Promise<void>(resolve => { liberar = resolve; });
    injecao.barreira = { entrou: avisar, liberar: aguardando };
    const criacao = criarAdicional(s, entrada(b.id, mes));
    const pid = await entrou;
    const fechamento = fecharFolha(s, mes, p.id, previa.revisao).then(valor => ({ ok: true as const, valor }), erro => ({ ok: false as const, erro }));
    try { await esperarBloqueio(pid); } finally { injecao.barreira = null; liberar(); }
    await criacao;
    const r = await fechamento;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatchObject({ status: 409, codigo: "folha_mudou" });
    expect(await db.folhaPagamento.count({ where: { pessoaId: p.id, competencia: mes } })).toBe(0);
  });
  it("folha fechada protege criação, encerramento e exclusão mesmo em vigência futura", async () => {
    const { p, b } = await funcionario(), mes = `${anoTeste}-03`, d = entrada(b.id, mes);
    const a = await criarAdicional(s, d), previa = await previaFolha(mes);
    await fecharFolha(s, mes, p.id, previa.revisao);
    await expect(criarAdicional(s, { ...d, modalidade: "ASSINATURA" })).rejects.toMatchObject({ codigo: "folha_fechada" });
    await expect(encerrarAdicional(s, a.id, `${mes}-10`)).rejects.toMatchObject({ codigo: "folha_fechada" });
    await expect(excluirAdicional(s, a.id)).rejects.toMatchObject({ codigo: "folha_fechada" });
    expect((await db.adicionalComissao.findUniqueOrThrow({ where: { id: a.id } })).fim?.toISOString().slice(0, 10)).toBe(d.fim);
  });
  it("prorrogação não cria sobreposição com um segundo adicional", async () => {
    const { b } = await funcionario(), mes = `${anoTeste}-04`, d = entrada(b.id, mes);
    const a = await criarAdicional(s, { ...d, fim: `${mes}-10` });
    await criarAdicional(s, { ...d, inicio: `${mes}-20` });
    await expect(encerrarAdicional(s, a.id, `${mes}-25`)).rejects.toMatchObject({ codigo: "sobreposto" });
  });
});
