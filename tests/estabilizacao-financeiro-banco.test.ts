import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { importarStone } from "@/lib/conciliacao/stone";
import { idStoneLegado } from "@/lib/conciliacao/stone-regras";
import { excluirLancamento, fecharFolha, lancar, pagarFolha, previaFolha, reabrirFolha } from "@/lib/rh/folha";
import { relatorioComissoes, salvarComissoes } from "@/lib/rh/comissoes";
import { competenciasRemuneracao, gravarVigenciaRemuneracao, lerVigenciaRemuneracao } from "@/lib/rh/vigencias";
import type { RegraSalva } from "@/lib/rh/regras";
import { recebimentosMensalidades } from "@/lib/financeiro/recebimentos";
import type { Sessao } from "@/lib/auth/sessao";

vi.mock("@/lib/eventos", () => ({ publicar: vi.fn() }));
const injecao = vi.hoisted(() => ({ falharAuditoria: false,
  pausa: null as { acao: string; avisar: (pid: number) => void; esperar: Promise<void> } | null,
}));
vi.mock("@/lib/auditoria", async () => {
  const real = await vi.importActual<typeof import("@/lib/auditoria")>("@/lib/auditoria");
  return { ...real, auditar: async (...args: Parameters<typeof real.auditar>) => {
    if (injecao.falharAuditoria) throw Error("Falha de escrita de auditoria injetada no teste local");
    const pausa = injecao.pausa;
    if (pausa?.acao === args[2]) {
      const [r] = await args[0].$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      pausa.avisar(r.pid); await pausa.esperar;
    }
    return real.auditar(...args);
  } };
});
const ativo = process.env.TESTE_ESTABILIZACAO_FINANCEIRO_LOCAL === "1";
if (ativo) {
  const u = new URL(process.env.DATABASE_URL ?? "");
  if (u.hostname !== "127.0.0.1" || u.port !== "55439" || !u.pathname.startsWith("/barberos_ci_local_estabilizacao_")) throw Error("Exige banco financeiro local descartável.");
}
const janela = { gte: new Date("2026-11-01T00:00:00-03:00"), lt: new Date("2026-12-01T00:00:00-03:00") };
let s: Sessao;
let observador: PrismaClient;
function linha(tag = randomUUID()) {
  const saldo = parseInt(tag.replaceAll("-", "").slice(0, 8), 16) % 10_000_000 + 1000;
  return { Data: "08/11/2026", Horário: "09:10:11.123", Movimentação: "Crédito", Tipo: "Pix", Valor: "100,00", "Saldo antes": `${saldo},00`, "Saldo depois": `${saldo + 100},00`, Origem: `Fictício ${tag}`, Tarifa: "1,00" };
}
function csv(l: Record<string, string>) { return [Object.keys(l), Object.values(l)].map(a => a.map(v => `"${v.replaceAll('"', '""')}"`).join(",")).join("\r\n"); }

describe.skipIf(!ativo)("estabilização financeira no PostgreSQL sintético", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("connection_limit", "1"); url.searchParams.set("connect_timeout", "1"); url.searchParams.set("pool_timeout", "1");
    observador = new PrismaClient({ datasources: { db: { url: url.href } } });
    vi.stubGlobal("fetch", async () => { throw Error("Rede externa bloqueada"); });
    const u = await db.usuario.create({ data: { nome: "Dono financeiro fictício", telefone: `financeiro-${randomUUID()}`, papel: "DONO" } });
    s = { usuarioId: u.id, papel: "DONO", nome: u.nome, sessaoVersao: 0 } as Sessao;
    await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  });
  afterAll(async () => { await Promise.all([db.$disconnect(), observador?.$disconnect()]); vi.unstubAllGlobals(); });

  async function corridaPausada(acao: string, primeira: () => Promise<unknown>, segunda: () => Promise<unknown>, lock: "pessoa" | "advisory") {
    let liberar!: () => void, avisar!: (pid: number) => void;
    const esperar = new Promise<void>(r => { liberar = r; }), pausou = new Promise<number>(r => { avisar = r; });
    injecao.pausa = { acao, avisar, esperar };
    const a = primeira();
    try {
      const pid = await Promise.race([pausou, a.then(() => { throw Error("A primeira ação não atingiu a barreira de auditoria."); })]);
      const b = segunda(), resultados = Promise.allSettled([a, b]);
      let erroObservacao: unknown;
      try {
        await vi.waitFor(async () => {
          const [{ quantidade }] = await observador.$transaction(async monitor => {
            await monitor.$executeRaw`SET LOCAL statement_timeout = '750ms'`;
            return monitor.$queryRaw<{ quantidade: number }[]>`
              SELECT count(*)::integer AS quantidade FROM pg_stat_activity a
              WHERE a.datname = current_database() AND a.pid <> pg_backend_pid()
                AND a.wait_event_type = 'Lock' AND ${pid} = ANY(pg_blocking_pids(a.pid))
                AND ((${lock} = 'pessoa' AND a.query LIKE '%checklist_pessoas%' AND a.query LIKE '%FOR UPDATE%')
                  OR (${lock} = 'advisory' AND a.query LIKE '%pg_advisory_xact_lock%'))`;
          }, { maxWait: 500, timeout: 1000 });
          expect(quantidade).toBeGreaterThan(0);
        }, { timeout: 2500, interval: 20 });
      } catch (erro) { erroObservacao = erro; }
      liberar();
      const r = await resultados;
      if (erroObservacao) throw erroObservacao;
      return r;
    } finally { injecao.pausa = null; liberar(); await a.catch(() => {}); }
  }

  it("importação e auditoria são atômicas mesmo se a escrita da auditoria falhar", async () => {
    const l = linha(), antes = await db.movimentoExterno.count();
    injecao.falharAuditoria = true;
    try { await expect(importarStone(s, csv(l))).rejects.toThrow(/Falha de escrita/); } finally { injecao.falharAuditoria = false; }
    expect(await db.movimentoExterno.count()).toBe(antes);
    const r = await importarStone(s, csv(l)); expect(r.novos).toBe(2);
    const a = await db.auditoria.findFirst({ where: { acao: "conciliacao_importar_stone", dados: { path: ["arquivoSha256"], equals: r.arquivoSha256 } } });
    expect(a).not.toBeNull();
  });
  it("reimportar outro formato preserva a identidade e a tarifa", async () => {
    const l = linha(); await importarStone(s, csv(l));
    const r = await importarStone(s, csv({ ...l, Valor: "R$ 100,00", "Saldo antes": `R$ ${l["Saldo antes"]}`, Horário: "09:10:11.123" }));
    expect(r).toMatchObject({ novos: 0, repetidos: 2 });
  });
  it("reconhece IDs legados sem regravar o bruto ou trocar o identificador externo", async () => {
    const l = linha(), id = idStoneLegado(l), data = new Date("2026-11-08T12:10:11.123Z");
    const m = await db.movimentoExterno.create({ data: { fonte: "STONE", idExterno: id, data, valorCentavos: 10000, tipo: "RECEBIMENTO", descricao: "Fixture legada", bruto: l } });
    await db.movimentoExterno.create({ data: { fonte: "STONE", idExterno: `${id}:tarifa`, data, valorCentavos: -100, tipo: "TAXA", descricao: "Tarifa fixture legada" } });
    expect(await importarStone(s, csv({ ...l, Valor: "R$ 100,00" }))).toMatchObject({ novos: 0, repetidos: 2 });
    const depois = await db.movimentoExterno.findUniqueOrThrow({ where: { id: m.id } });
    expect(depois.idExterno).toBe(id); expect(depois.bruto).toEqual(l); expect(depois.identidadeCanonica).toBeTruthy();
  });
  it("uma referência com valor divergente é rejeitada sem importar o lote", async () => {
    const l = { ...linha(), "ID da transação": randomUUID() }; await importarStone(s, csv(l));
    const antes = await db.movimentoExterno.count();
    await expect(importarStone(s, csv({ ...l, Valor: "99,00" }))).rejects.toMatchObject({ codigo: "stone_referencia_divergente" });
    expect(await db.movimentoExterno.count()).toBe(antes);
  });

  async function funcionario() {
    const id = randomUUID();
    const u = await db.usuario.create({ data: { nome: "Barbeiro fictício", telefone: `barbeiro-${id}`, papel: "BARBEIRO" } });
    const b = await db.barbeiro.create({ data: { nome: "Profissional financeiro fictício", usuarioId: u.id } });
    const p = await db.checklistPessoa.create({ data: { nome: "Funcionário fictício", telefone: `pessoa-${id}`, token: id, funcao: "BARBEIRO", barbeiroId: b.id, salarioCentavos: 10000 } });
    const c = await db.cliente.create({ data: { nome: "Cliente financeiro fictício", telefone: `cliente-${id}` } });
    const sv = await db.servico.create({ data: { nome: `Serviço fictício ${id}`, duracaoMin: 30, precoCentavos: 10000 } });
    const regra: RegraSalva = { servicoId: sv.id, barbeiroId: null, avulsoTipo: "PERCENTUAL", avulsoValor: 2000, planoTipo: "FIXO", planoValor: 0 };
    await db.comissaoServico.create({ data: regra });
    // Reexecução no banco sintético pode já ter histórico: acrescenta só esta nova fixture à versão
    // vigente, sem copiar o rascunho físico futuro ou regravar versões e IDs dos casos anteriores.
    const vigente = await lerVigenciaRemuneracao<RegraSalva[]>(db, "servicos", "2026-11");
    if (vigente) await db.$transaction(tx => gravarVigenciaRemuneracao(tx, { escopo: "servicos", competencia: "2026-11",
      conteudo: [...vigente.conteudo, regra], atorId: s.usuarioId,
    }));
    await db.agendamento.create({ data: { clienteId: c.id, barbeiroId: b.id, servicoId: sv.id, inicio: new Date("2026-11-06T10:00:00-03:00"), fim: new Date("2026-11-06T10:30:00-03:00"), precoCentavos: 10000, origem: "PAINEL", status: "CONCLUIDO" } });
    return { p, b, c, sv };
  }
  it("relatório e folha preservam integralmente os valores e a memória congelados", async () => {
    const { p, b } = await funcionario();
    const previa = await previaFolha("2026-11");
    expect(previa.linhas.find(l => l.pessoaId === p.id)?.liquido).toBe(12000);
    await fecharFolha(s, "2026-11", p.id, previa.revisao);
    await db.checklistPessoa.update({ where: { id: p.id }, data: { salarioCentavos: 20000 } });
    const atual = await previaFolha("2026-11"), l = atual.linhas.find(l => l.pessoaId === p.id)!;
    expect(l.liquido).toBe(12000); expect(l.salario).toBe(10000); expect(l.mudouDepois).toBe(true);
    expect(l.comissaoDetalhe?.avulso.comissao).toBe(2000);
    const r = await relatorioComissoes("2026-11-01", "2026-11-30");
    expect(r.barbeiros.find(x => x.barbeiroId === b.id)?.folha?.totalAPagar).toBe(12000);
    expect(l.chavePix).toBeNull();
    await reabrirFolha(s, "2026-11", p.id);
    const audit = await db.auditoria.findFirst({ where: { entidadeId: { not: "" }, acao: "rh_folha_reabrir", dados: { path: ["pessoaId"], equals: p.id } } });
    expect(audit?.dados).toHaveProperty("retratoAnterior");
  });
  it("uma prévia antiga não fecha após mudança com a mesma quantidade de lançamentos", async () => {
    const { p } = await funcionario(), previa = await previaFolha("2026-11");
    await db.checklistPessoa.update({ where: { id: p.id }, data: { salarioCentavos: 10001 } });
    await expect(fecharFolha(s, "2026-11", p.id, previa.revisao)).rejects.toMatchObject({ codigo: "folha_mudou" });
    expect(await db.folhaPagamento.count({ where: { pessoaId: p.id } })).toBe(0);
  });
  it("dois fechamentos concorrentes criam uma única folha e uma única auditoria", async () => {
    const { p } = await funcionario(), previa = await previaFolha("2026-11");
    const resultados = await Promise.allSettled([fecharFolha(s, "2026-11", p.id, previa.revisao), fecharFolha(s, "2026-11", p.id, previa.revisao)]);
    expect(resultados.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.folhaPagamento.count({ where: { pessoaId: p.id } })).toBe(1);
  });
  it("receita usa prova/data efetivas e distingue o nominal pendente", async () => {
    const { c } = await funcionario();
    const plano = await db.plano.create({ data: { nome: "Plano fictício", precoCentavos: 10000 } });
    const a = await db.assinatura.create({ data: { clienteId: c.id, planoId: plano.id, precoCentavos: 10000, formaPagamento: "PIX", origem: "PAINEL" } });
    const antes = await recebimentosMensalidades(janela);
    const gatewayId = `sim_fixture-${randomUUID()}`;
    await db.cobranca.create({ data: { assinaturaId: a.id, gatewayId, valorCentavos: 10000, vencimento: new Date("2026-10-01Z"), status: "PAGA", pagaEm: new Date("2026-11-02Z"), valorRecebidoConfirmadoCentavos: 9000, recebidoConfirmadoEm: new Date("2026-11-02T10:00:00-03:00"), provaRecebimento: { versao: 1, fonte: "simulado", referencia: gatewayId, status: "PAGA", campoValor: "valorCentavos", campoData: "pagaEm", valorCentavos: 9000, em: "2026-11-02T13:00:00.000Z" } } });
    await db.cobranca.create({ data: { assinaturaId: a.id, gatewayId: `fixture-${randomUUID()}`, valorCentavos: 7777, vencimento: new Date("2026-11-01Z"), status: "PAGA", pagaEm: new Date("2026-11-02Z") } });
    const depois = await recebimentosMensalidades(janela);
    expect(depois.total - antes.total).toBe(9000); expect(depois.nominalPendente - antes.nominalPendente).toBe(7777); expect(depois.completo).toBe(false);
  });
  it("trocar a ficha atual da cadeira não permite fechar a mesma comissão para outra pessoa", async () => {
    const { p, b } = await funcionario();
    const previa = await previaFolha("2026-11"); await fecharFolha(s, "2026-11", p.id, previa.revisao);
    await db.checklistPessoa.update({ where: { id: p.id }, data: { barbeiroId: null } });
    const id = randomUUID();
    const outra = await db.checklistPessoa.create({ data: { nome: "Outra ficha fictícia", telefone: `outra-${id}`, token: id, funcao: "BARBEIRO", barbeiroId: b.id } });
    const atual = await previaFolha("2026-11");
    await expect(fecharFolha(s, "2026-11", outra.id, atual.revisao)).rejects.toMatchObject({ codigo: "cadeira_folha_duplicada" });
    expect(await db.folhaPagamento.count({ where: { competencia: "2026-11", barbeiroIdCongelado: b.id } })).toBe(1);
    const r = await relatorioComissoes("2026-11-01", "2026-11-30");
    expect(r.barbeiros.find(x => x.barbeiroId === b.id)?.folha?.totalAPagar).toBe(12000);
  });
  it("exclusão vence antes de liberar a trava e o fechamento rejeita seu snapshot antigo", async () => {
    const { p } = await funcionario();
    const l = await lancar(s, { competencia: "2026-11", pessoaId: p.id, tipo: "BONUS", valorCentavos: 100, descricao: "Bônus sintético", idempotencia: randomUUID() });
    const previa = await previaFolha("2026-11");
    const r = await corridaPausada("rh_lancamento_excluir", () => excluirLancamento(s, l.id), () => fecharFolha(s, "2026-11", p.id, previa.revisao), "pessoa");
    expect(r[0].status).toBe("fulfilled");
    expect(r[1]).toMatchObject({ status: "rejected", reason: { codigo: "folha_mudou", status: 409 } });
    const f = await db.folhaPagamento.findFirst({ where: { competencia: "2026-11", pessoaId: p.id, ativa: true } });
    const permanece = !!await db.folhaLancamento.findUnique({ where: { id: l.id } });
    expect(f).toBeNull(); expect(permanece).toBe(false);
    expect((await db.checklistPessoa.findUniqueOrThrow({ where: { id: p.id } })).revisaoPix).toBe(p.revisaoPix);
  });
  it("marcar paga vence e reabertura concorrente não apaga a folha nem duplica despesa", async () => {
    const { p } = await funcionario(), previa = await previaFolha("2026-11");
    await fecharFolha(s, "2026-11", p.id, previa.revisao);
    const r = await corridaPausada("rh_folha_paga", () => pagarFolha(s, "2026-11", p.id, "PIX"), () => reabrirFolha(s, "2026-11", p.id), "pessoa");
    expect(r[0].status).toBe("fulfilled"); expect(r[1]).toMatchObject({ status: "rejected", reason: { codigo: "ja_paga" } });
    const f = await db.folhaPagamento.findFirstOrThrow({ where: { competencia: "2026-11", pessoaId: p.id, ativa: true } });
    expect(f.status).toBe("PAGA"); expect(f.despesaId).not.toBeNull();
    expect(await db.despesa.count({ where: { id: f.despesaId! } })).toBe(1);
  });
  it("reabertura vence e registro de pagamento concorrente não usa o retrato apagado", async () => {
    const { p } = await funcionario(), previa = await previaFolha("2026-11");
    await fecharFolha(s, "2026-11", p.id, previa.revisao);
    const antes = await db.despesa.count();
    const r = await corridaPausada("rh_folha_reabrir", () => reabrirFolha(s, "2026-11", p.id), () => pagarFolha(s, "2026-11", p.id, "PIX"), "pessoa");
    expect(r[0].status).toBe("fulfilled"); expect(r[1]).toMatchObject({ status: "rejected", reason: { codigo: "nao_fechada" } });
    expect(await db.folhaPagamento.count({ where: { competencia: "2026-11", pessoaId: p.id } })).toBe(0);
    expect(await db.despesa.count()).toBe(antes);
  });
  it("índice parcial impede duas regras gerais sob criação concorrente", async () => {
    const sv = await db.servico.create({ data: { nome: `Serviço único ${randomUUID()}`, duracaoMin: 20, precoCentavos: 1000 } });
    const data = { servicoId: sv.id, avulsoTipo: "PERCENTUAL" as const, avulsoValor: 4000, planoTipo: "FIXO" as const, planoValor: 0 };
    const r = await Promise.allSettled([db.comissaoServico.create({ data }), db.comissaoServico.create({ data })]);
    expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.comissaoServico.count({ where: { servicoId: sv.id, barbeiroId: null } })).toBe(1);
  });
  // Último caso: registra uma versão global e seu baseline depois das fixtures dos casos anteriores.
  it("configuração vence sob advisory e o fechamento rejeita regras de um snapshot antigo", async () => {
    const { p, sv } = await funcionario(), comp = competenciasRemuneracao().proxima;
    const previa = await previaFolha(comp);
    const r = await corridaPausada("rh_comissoes_configurar", () => salvarComissoes(s, { competencia: comp,
      gerais: [{ servicoId: sv.id, avulsoTipo: "PERCENTUAL", avulsoValor: 3000, planoTipo: "FIXO", planoValor: 0 }], excecoes: [],
    }), () => fecharFolha(s, comp, p.id, previa.revisao), "advisory");
    expect(r[0].status).toBe("fulfilled");
    expect(r[1]).toMatchObject({ status: "rejected", reason: { codigo: "folha_mudou", status: 409 } });
    expect(await db.folhaPagamento.count({ where: { pessoaId: p.id, competencia: comp } })).toBe(0);
  });
});
