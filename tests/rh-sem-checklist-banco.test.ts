import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { cadastro, enviarLista, gerarItens, listaPublica, marcarPublico, novoLink, painelDoDia, salvarCadastro } from "@/lib/checklist/servico";
import { classificacao } from "@/lib/checklist/pontos";
import { criarPessoaRh, type PessoaRhEntrada } from "@/lib/rh/cadastro";
import { previaFolha } from "@/lib/rh/folha";
import { salvarAcesso } from "@/lib/auth/equipe";

const ativo = process.env.TESTE_RH_SEM_CHECKLIST_LOCAL === "1";
if (ativo) {
  const u = new URL(process.env.DATABASE_URL ?? "");
  if (u.hostname !== "127.0.0.1" || u.port !== "55439" || u.username !== "auditoria_teste" || !/^\/barberos_ci_local_regr_rh_\d{8}$/.test(u.pathname)) throw Error("Exige banco RH local descartável dedicado.");
}
let s: Sessao, contador = 0;
const prefixoTelefone = randomInt(10000, 99999);
const entrada = (): PessoaRhEntrada => ({ nome: "Sócio fictício", telefone: `55119${prefixoTelefone}${String(contador++).padStart(3, "0")}`, cargo: "Sócio", salarioCentavos: 123456, competenciaSalario: "2032-02", idempotencia: randomUUID() });
const totais = async () => ({ usuarios: await db.usuario.count(), cadeiras: await db.barbeiro.count(), tarefas: await db.checklistTarefa.count(), envios: await db.checklistEnvio.count(), mensagens: await db.mensagem.count(), folhas: await db.folhaPagamento.count(), despesas: await db.despesa.count() });

describe.skipIf(!ativo)("pessoa remunerada sem checklist no PostgreSQL descartável", () => {
  beforeAll(async () => {
    vi.stubGlobal("fetch", async () => { throw Error("Rede externa bloqueada na fixture RH"); });
    const dono = await db.usuario.create({ data: { nome: "Dono fictício RH neutro", telefone: `dono-rh-neutro-${randomUUID()}`, papel: "DONO" } });
    s = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, sessaoVersao: 0, clienteId: null, barbeiroId: null };
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    await cadastro();
  });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllGlobals(); });

  it("cria somente RH e versão salarial, com salário zero antes da vigência e folha aberta", async () => {
    const antes = await totais(), d = entrada(), r = await criarPessoaRh(s, d);
    const p = await db.checklistPessoa.findUniqueOrThrow({ where: { id: r.pessoaId } });
    expect(p).toMatchObject({ funcao: null, ativo: true, usuarioId: null, barbeiroId: null, cargo: "Sócio", salarioCentavos: 123456 });
    expect(await totais()).toEqual(antes);
    expect((await previaFolha("2032-01")).linhas.find(l => l.pessoaId === p.id)).toMatchObject({ salario: 0, status: "ABERTA", vinculoPendente: false });
    expect((await previaFolha("2032-02")).linhas.find(l => l.pessoaId === p.id)).toMatchObject({ salario: 123456, liquido: 123456, status: "ABERTA", vinculoPendente: false });
    expect(await db.auditoria.count({ where: { acao: "rh_pessoa_criar", entidadeId: p.id } })).toBe(1);
  });
  it("repetições e concorrência criam uma ficha e uma auditoria", async () => {
    const d = entrada(), [a, b] = await Promise.all([criarPessoaRh(s, d), criarPessoaRh(s, d)]);
    expect(a.pessoaId).toBe(b.pessoaId); expect([a.jaRegistrada, b.jaRegistrada].sort()).toEqual([false, true]);
    expect(await db.checklistPessoa.count({ where: { telefone: d.telefone } })).toBe(1);
    await expect(criarPessoaRh(s, { ...d, salarioCentavos: 999 })).rejects.toMatchObject({ codigo: "rh_cadastro_idempotencia" });
    await expect(criarPessoaRh(s, { ...d, telefone: d.telefone.slice(2), idempotencia: randomUUID() })).rejects.toMatchObject({ codigo: "rh_cadastro_duplicado" });
  });
  it("não cria itens, não envia, não expõe link e não aparece no ranking ou painel de checklist", async () => {
    const r = await criarPessoaRh(s, entrada()), p = await db.checklistPessoa.findUniqueOrThrow({ where: { id: r.pessoaId } });
    const antes = await totais();
    await gerarItens("2032-02-02", [p.id]);
    expect(await db.checklistItem.count({ where: { pessoaId: p.id } })).toBe(0);
    expect(await enviarLista(p.id, "2032-02-02", true)).toBe(false);
    expect(await listaPublica(p.token)).toBeNull();
    await expect(marcarPublico(p.token, "item-inexistente", true)).rejects.toMatchObject({ status: 404 });
    await expect(novoLink(s, p.id)).rejects.toMatchObject({ status: 404 });
    expect((await classificacao()).pessoas.some(x => x.id === p.id)).toBe(false);
    expect((await painelDoDia("2032-02-02")).some(x => x.id === p.id)).toBe(false);
    expect(await totais()).toEqual(antes);
  });
  it("salvamento integral do checklist preserva fichas neutras, funções e tarefas existentes", async () => {
    const r = await criarPessoaRh(s, entrada()), p = await db.checklistPessoa.findUniqueOrThrow({ where: { id: r.pessoaId } });
    const legado = await db.checklistPessoa.create({ data: { nome: "Diarista fictícia", telefone: entrada().telefone, token: randomUUID(), funcao: "DIARISTA" } });
    const antes = await cadastro(), tarefas = await db.checklistTarefa.findMany({ orderBy: { id: "asc" } });
    expect(antes.pessoas.some(x => x.id === p.id)).toBe(false);
    await salvarCadastro(s, { ...antes, pessoas: antes.pessoas.map(x => ({ ...x, funcao: x.funcao! })) });
    expect(await db.checklistPessoa.findUniqueOrThrow({ where: { id: p.id } })).toEqual(p);
    expect((await db.checklistPessoa.findUniqueOrThrow({ where: { id: legado.id } })).funcao).toBe("DIARISTA");
    // O editor antigo normaliza os índices de ordem; conteúdo e identidade permanecem.
    const conteudo = (xs: typeof tarefas) => xs.map(t => ({ ...t, ordem: 0 }));
    expect(conteudo(await db.checklistTarefa.findMany({ orderBy: { id: "asc" } }))).toEqual(conteudo(tarefas));
    await expect(salvarCadastro(s, { ...antes, pessoas: [{ id: p.id, nome: p.nome, telefone: p.telefone, funcao: "GERENTE", ativo: true }] })).rejects.toMatchObject({ codigo: "rh_sem_checklist" });
  });
  it("recusa duplicação pelo checklist ou Acessos, preservando ficha e demais dados", async () => {
    const d = entrada(), r = await criarPessoaRh(s, d), antes = await cadastro();
    const totaisAntes = await totais(), ficha = await db.checklistPessoa.findUniqueOrThrow({ where: { id: r.pessoaId } });
    const pessoas = antes.pessoas.map(p => ({ ...p, funcao: p.funcao! }));
    await expect(salvarCadastro(s, { ...antes, pessoas: [...pessoas, { nome: "Duplicação fictícia", telefone: d.telefone.slice(2), funcao: "GERENTE", ativo: true }] })).rejects.toMatchObject({ codigo: "rh_cadastro_duplicado" });
    await expect(salvarAcesso(s, null, { nome: "Acesso duplicado fictício", telefone: d.telefone.slice(2), papel: "BARBEIRO", atende: true })).rejects.toMatchObject({ codigo: "rh_cadastro_duplicado" });
    expect(await db.checklistPessoa.findUniqueOrThrow({ where: { id: r.pessoaId } })).toEqual(ficha);
    expect(await cadastro()).toEqual(antes); expect(await totais()).toEqual(totaisAntes);
  });
  it.each(["checklist", "acessos"] as const)("serializa inclusão em %s concorrente com a inclusão no RH", async caminho => {
    const d = entrada(), antes = await cadastro(), pessoas = antes.pessoas.map(p => ({ ...p, funcao: p.funcao! }));
    const resultados = await Promise.allSettled([
      criarPessoaRh(s, d),
      caminho === "checklist"
        ? salvarCadastro(s, { ...antes, pessoas: [...pessoas, { nome: "Checklist concorrente fictício", telefone: d.telefone, funcao: "DIARISTA", ativo: true }] })
        : salvarAcesso(s, null, { nome: "Acesso concorrente fictício", telefone: d.telefone, papel: "BARBEIRO", atende: true }),
    ]);
    expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const falha = resultados.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(falha.reason).toMatchObject({ codigo: "rh_cadastro_duplicado" });
    expect(await db.checklistPessoa.count({ where: { telefone: d.telefone } })).toBe(1);
  });
  it("revalida dono, versão de sessão e permissão antes de qualquer escrita", async () => {
    const antes = await db.checklistPessoa.count();
    await expect(criarPessoaRh({ ...s, papel: "GERENTE" }, entrada())).rejects.toMatchObject({ status: 403 });
    await expect(criarPessoaRh({ ...s, sessaoVersao: 9 }, entrada())).rejects.toMatchObject({ status: 403 });
    expect(await db.checklistPessoa.count()).toBe(antes);
  });
  it("editar um acesso posteriormente vinculado preserva ausência de função sem seleção explícita", async () => {
    const r = await criarPessoaRh(s, entrada());
    const usuario = await db.usuario.create({ data: { nome: "Acesso fictício existente", telefone: entrada().telefone, papel: "RECEPCAO" } });
    await db.checklistPessoa.update({ where: { id: r.pessoaId }, data: { usuarioId: usuario.id } });
    await salvarAcesso(s, usuario.id, { nome: "Acesso fictício atualizado", atende: false, cargo: "Sócio" });
    expect((await db.checklistPessoa.findUniqueOrThrow({ where: { id: r.pessoaId } })).funcao).toBeNull();
  });
});
