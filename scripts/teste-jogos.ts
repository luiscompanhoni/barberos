// Teste de integracao do motor de jogos contra o banco de DESENVOLVIMENTO. Cria jogos e clientes proprios
// (ids "teste-*") e apaga tudo no fim. Rodar: npm run teste:jogos
process.env.WHATSAPP_PROVIDER = "simulador";

import type { Sessao } from "@/lib/auth/sessao";
import { abrirComanda, cancelarComanda } from "@/lib/comandas/servico";
import { saldoDoCliente } from "@/lib/crescimento/saldo";
import { db } from "@/lib/db";
import { centralDoCliente, jogar, jogarPelaCampanha, marcarRevelada } from "@/lib/jogos/motor";
import { painelJogos, resultadoJogos, salvarJogo, simularJogo, type ConfigJogo, type PremioEntrada } from "@/lib/jogos/painel";
import { atualizarPremios, buscarPremios, cancelarPremio, desfazerValidacao, premiosDoCliente, reservarPremio, validarPremio } from "@/lib/jogos/premios";
import { trioDaGrade } from "@/lib/jogos/regras";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string; status?: number }; } };
const TELS = ["5511933337101", "5511933337102"];
const JOGOS = ["teste-roleta", "teste-caixa", "teste-raspa"];
let n = 0;
const chave = () => `teste-${Date.now()}-${++n}`;

async function limpar() {
  const cs = await db.cliente.findMany({ where: { telefone: { in: TELS } }, select: { id: true } });
  const ids = cs.map((c) => c.id);
  await db.campanha.deleteMany({ where: { nome: "teste-jogos" } });
  await db.premioGanho.deleteMany({ where: { OR: [{ clienteId: { in: ids } }, { jogoId: { in: JOGOS } }] } });
  await db.jogada.deleteMany({ where: { OR: [{ clienteId: { in: ids } }, { jogoId: { in: JOGOS } }] } });
  await db.jogo.deleteMany({ where: { id: { in: JOGOS } } });
  await db.beneficio.deleteMany({ where: { clienteId: { in: ids } } });
  const comandas = await db.comanda.findMany({ where: { clienteId: { in: ids } }, select: { id: true } });
  await db.pagamentoComanda.deleteMany({ where: { comandaId: { in: comandas.map((c) => c.id) } } });
  await db.itemComanda.deleteMany({ where: { comandaId: { in: comandas.map((c) => c.id) } } });
  await db.comanda.deleteMany({ where: { id: { in: comandas.map((c) => c.id) } } });
  await db.agendamento.deleteMany({ where: { clienteId: { in: ids } } });
  await db.cliente.deleteMany({ where: { id: { in: ids } } });
}

const CONFIG: ConfigJogo = {
  nome: "Teste", descricao: null, ativo: true, premiosPorJogada: 1, raridade: "COMUM", validadeDias: 30, bonusAssinantePct: 10,
  inicioEm: null, fimEm: null, limitePorPessoaMes: null, jogadasPorAtendimento: 1, valorMinimoAtendimentoCentavos: 0, soAssinante: false,
  jogadasPorIndicacao: 0, jogadasAniversario: 0, jogadasRenovacaoPlano: 0, gratisACadaDias: 0,
};
const premio = (x: Partial<PremioEntrada> & Pick<PremioEntrada, "rotulo" | "tipo" | "chanceBps">): PremioEntrada => ({
  valorCentavos: 0, percentual: 0, servicoId: null, raridade: "COMUM", cor: "#C9A24A", icone: "presente", ativo: true, limiteMensal: null, estoque: null, custoCentavos: 0, ...x,
});

async function main() {
  await limpar();
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, barbeiroId: null, clienteId: null };
  const [c1, c2] = await Promise.all(TELS.map((telefone, i) => db.cliente.create({ data: { telefone, nome: `Teste Jogos ${i + 1}` } })));
  const barbeiro = await db.barbeiro.findFirstOrThrow({ where: { ativo: true, servicos: { some: {} } }, include: { servicos: { include: { servico: true } } } });
  const servico = barbeiro.servicos[0].servico;
  for (const [id, tipo] of [["teste-roleta", "ROLETA"], ["teste-caixa", "CAIXA"], ["teste-raspa", "RASPADINHA"]] as const) {
    await db.jogo.create({ data: { id, tipo, nome: `Teste ${tipo}`, ativo: false, ordem: 99 } });
  }
  // Atendimentos concluidos em datas longe da agenda real (contam depois de ligar o jogo).
  let hora = Date.parse("2031-06-02T12:00:00Z");
  // Horario marcado (para usar o premio) dentro da validade: daqui a 2 dias, de madrugada (fora do expediente).
  let madrugada = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 2, 4);
  const atendimento = async (clienteId: string, status: "CONCLUIDO" | "MARCADO" = "CONCLUIDO") => {
    const inicio = status === "MARCADO" ? (madrugada += 3_600_000) : (hora += 3_600_000);
    return db.agendamento.create({ data: { barbeiroId: barbeiro.id, clienteId, servicoId: servico.id, inicio: new Date(inicio), fim: new Date(inicio + 1_800_000), precoCentavos: servico.precoCentavos, origem: "SITE", status } });
  };

  try {
    // ---------- configuracao
    const invalida = await falha(() => salvarJogo(s, "teste-roleta", CONFIG, [premio({ rotulo: "A", tipo: "CREDITO", valorCentavos: 500, chanceBps: 5000 }), premio({ rotulo: "B", tipo: "NADA", chanceBps: 4000 })]));
    ok(invalida?.codigo === "config_invalida", "não publica com chances somando 90%");
    await salvarJogo(s, "teste-roleta", { ...CONFIG, ativo: false }, [
      premio({ rotulo: "R$ 5", tipo: "CREDITO", valorCentavos: 500, chanceBps: 10_000 }),
      premio({ rotulo: "Nada", tipo: "NADA", chanceBps: 0 }),
    ]);
    ok((await falha(() => jogar(c1.id, "teste-roleta", chave())))?.codigo === "desligado", "jogo desligado não joga");
    const premiosRoleta = (await painelJogos()).jogos.find((j) => j.id === "teste-roleta")!.premios;
    const entrada = () => premiosRoleta.map((p) => ({ ...premio(p), id: p.id }));
    await salvarJogo(s, "teste-roleta", CONFIG, entrada());
    ok((await falha(() => jogar(c1.id, "teste-roleta", chave())))?.codigo === "sem_jogadas", "sem atendimento concluído não tem jogada");

    // ---------- vitoria, credito no saldo, idempotencia e conexao interrompida
    await atendimento(c1.id);
    const k = chave();
    const j1 = await jogar(c1.id, "teste-roleta", k);
    ok(j1.vitoria && j1.premios[0].tipo === "CREDITO", "vitória: prêmio decidido no servidor");
    ok(j1.resultado.tipo === "ROLETA" && j1.resultado.fatias[j1.resultado.indice].id === premiosRoleta.find((p) => p.tipo === "CREDITO")!.id, "a fatia devolvida é a do prêmio sorteado");
    ok((await saldoDoCliente(c1.id)) === 500, "crédito entra no saldo na hora (R$ 5)");
    const repetida = await jogar(c1.id, "teste-roleta", k);
    ok(repetida.id === j1.id && (await db.jogada.count({ where: { clienteId: c1.id } })) === 1, "mesma chave (atualizou a página) devolve a mesma jogada");
    ok((await centralDoCliente(c1.id)).jogos.find((j) => j.id === "teste-roleta")?.pendente?.id === j1.id, "caiu a conexão: a jogada volta como pendente para revelar");
    await marcarRevelada(c2.id, j1.id);
    ok(!!(await db.jogada.findUniqueOrThrow({ where: { id: j1.id } })).reveladaEm === false, "outro cliente não marca a jogada como revelada");
    await marcarRevelada(c1.id, j1.id);
    ok((await centralDoCliente(c1.id)).jogos.find((j) => j.id === "teste-roleta")?.pendente === null, "depois de revelar, não fica pendente");
    ok((await falha(() => jogar(c2.id, "teste-roleta", k)))?.codigo === "chave", "fraude: chave de outro cliente é recusada");

    // ---------- clique duplo e requisicoes simultaneas
    await atendimento(c1.id);
    const kk = chave();
    const duplo = await Promise.allSettled([jogar(c1.id, "teste-roleta", kk), jogar(c1.id, "teste-roleta", kk)]);
    const ids = new Set(duplo.flatMap((r) => (r.status === "fulfilled" ? [r.value.id] : [])));
    ok(ids.size === 1, "clique duplo com a mesma chave = uma jogada só");
    await atendimento(c1.id);
    const tres = await Promise.allSettled([jogar(c1.id, "teste-roleta", chave()), jogar(c1.id, "teste-roleta", chave()), jogar(c1.id, "teste-roleta", chave())]);
    ok(tres.filter((r) => r.status === "fulfilled").length === 1, "três abas ao mesmo tempo com 1 jogada: só uma passa");

    // ---------- nao vitoria
    const pr = (await painelJogos()).jogos.find((j) => j.id === "teste-roleta")!.premios;
    await salvarJogo(s, "teste-roleta", CONFIG, pr.map((p) => ({ ...premio(p), id: p.id, chanceBps: p.tipo === "NADA" ? 10_000 : 0 })));
    await atendimento(c1.id);
    const perdeu = await jogar(c1.id, "teste-roleta", chave());
    ok(!perdeu.vitoria && perdeu.premios.length === 0, "não vitória: nenhum prêmio gravado");

    // ---------- estoque encerrado e limite por pessoa
    const servicoPremio = premio({ rotulo: "Serviço grátis", tipo: "SERVICO", servicoId: servico.id, chanceBps: 6000, estoque: 1, custoCentavos: 1000 });
    await salvarJogo(s, "teste-caixa", { ...CONFIG, premiosPorJogada: 2, limitePorPessoaMes: 3 }, [
      servicoPremio, premio({ rotulo: "Bebida", tipo: "BRINDE", chanceBps: 2000, custoCentavos: 400, icone: "bebida" }), premio({ rotulo: "15% off", tipo: "DESCONTO", percentual: 15, chanceBps: 2000 }),
    ]);
    const sim = simularJogo("CAIXA", 2, (await painelJogos()).jogos.find((j) => j.id === "teste-caixa")!.premios.map((p) => ({ ...premio(p), id: p.id })), 1000);
    ok(sim.erros.length === 0 && sim.linhas.find((l) => l.rotulo === "Serviço grátis")!.saiu === 1, "simulação respeita o estoque de 1");
    for (let i = 0; i < 4; i++) await atendimento(c1.id);
    const caixas = [] as Awaited<ReturnType<typeof jogar>>[];
    for (let i = 0; i < 3; i++) caixas.push(await jogar(c1.id, "teste-caixa", chave()));
    ok(caixas.every((c) => c.premios.length === 2), "caixa com 2 prêmios garantidos");
    const servicos = caixas.flatMap((c) => c.premios).filter((p) => p.tipo === "SERVICO");
    ok(servicos.length === 1, `estoque encerrado: o serviço grátis saiu ${servicos.length}x (estoque 1)`);
    ok((await db.jogoPremio.findFirstOrThrow({ where: { jogoId: "teste-caixa", tipo: "SERVICO" } })).estoque === 0, "estoque baixa para 0");
    ok((await falha(() => jogar(c1.id, "teste-caixa", chave())))?.codigo === "limite_mes", "limite de 3 por pessoa no mês");

    // ---------- raspadinha: grade montada no servidor
    await salvarJogo(s, "teste-raspa", CONFIG, [
      premio({ rotulo: "R$ 10", tipo: "CREDITO", valorCentavos: 1000, chanceBps: 5000, icone: "dinheiro" }), premio({ rotulo: "Nada", tipo: "NADA", chanceBps: 5000 }),
    ]);
    for (let i = 0; i < 6; i++) await atendimento(c2.id);
    let vit = 0, der = 0, coerente = true;
    for (let i = 0; i < 6; i++) {
      const r = await jogar(c2.id, "teste-raspa", chave());
      if (r.resultado.tipo !== "RASPADINHA") { coerente = false; continue; }
      const trio = trioDaGrade(r.resultado.grade);
      if (r.vitoria) { vit++; coerente &&= !!trio && r.resultado.vencedoras.length === 3; } else { der++; coerente &&= !trio && r.resultado.vencedoras.length === 0; }
    }
    ok(coerente && vit + der === 6, `raspadinha: vitória tem trio e derrota não (${vit} vitórias, ${der} derrotas)`);

    // ---------- fluxo completo: ganhou -> agendou -> compareceu -> recepcao validou -> utilizado
    const desconto = caixas.flatMap((c) => c.premios).find((p) => p.tipo === "SERVICO" || p.tipo === "DESCONTO")!;
    const ag = await atendimento(c1.id, "MARCADO");
    await db.$transaction((tx) => reservarPremio(tx, c1.id, desconto.id, ag));
    ok((await premiosDoCliente(c1.id)).find((p) => p.id === desconto.id)?.status === "RESERVADO", "agendou para usar: prêmio reservado no horário");
    ok((await falha(() => db.$transaction((tx) => reservarPremio(tx, c1.id, desconto.id, ag))))?.codigo === "premio_indisponivel", "não reserva o mesmo prêmio duas vezes");
    await db.agendamento.update({ where: { id: ag.id }, data: { status: "CONCLUIDO" } });
    const { id: comandaId } = await abrirComanda(s, { agendamentoId: ag.id });
    ok((await buscarPremios({ clienteId: c1.id, comandaId })).some((p) => p.id === desconto.id), "recepção vê o prêmio na comanda do cliente");
    ok((await falha(() => validarPremio(s, desconto.id, { comandaId, codigo: "BB-222222" })))?.codigo === "codigo", "código errado não valida");
    const v = await validarPremio(s, desconto.id, { comandaId, codigo: desconto.codigo });
    const cm = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    ok(v.descontoCentavos > 0 && cm.descontoCentavos === v.descontoCentavos, `validado: desconto de R$ ${(v.descontoCentavos / 100).toFixed(2)} na comanda`);
    ok((await db.premioGanho.findUniqueOrThrow({ where: { id: desconto.id } })).status === "UTILIZADO", "prêmio marcado como utilizado");
    ok((await falha(() => validarPremio(s, desconto.id, { comandaId })))?.codigo === "utilizado", "não usa o mesmo prêmio duas vezes");
    await desfazerValidacao(s, desconto.id);
    ok((await db.comanda.findUniqueOrThrow({ where: { id: comandaId } })).descontoCentavos === 0, "desfazer devolve o desconto da comanda");
    await validarPremio(s, desconto.id, { comandaId });
    await cancelarComanda(s, comandaId, "teste");
    ok((await db.premioGanho.findUniqueOrThrow({ where: { id: desconto.id } })).status === "DISPONIVEL", "comanda cancelada devolve o prêmio ao cliente");

    // ---------- horario cancelado solta a reserva; vencido expira
    const ag2 = await atendimento(c1.id, "MARCADO");
    await db.$transaction((tx) => reservarPremio(tx, c1.id, desconto.id, ag2));
    await db.agendamento.update({ where: { id: ag2.id }, data: { status: "CANCELADO" } });
    await atualizarPremios({ clienteId: c1.id });
    ok((await db.premioGanho.findUniqueOrThrow({ where: { id: desconto.id } })).status === "DISPONIVEL", "horário cancelado: prêmio volta a disponível");
    const brinde = caixas.flatMap((c) => c.premios).find((p) => p.tipo === "BRINDE" && p.id !== desconto.id);
    if (brinde) {
      await db.premioGanho.update({ where: { id: brinde.id }, data: { expiraEm: new Date(Date.now() - 60_000) } });
      ok((await falha(() => validarPremio(s, brinde.id, {})))?.codigo === "expirado", "prêmio vencido não é validado");
      await atualizarPremios({ clienteId: c1.id });
      ok((await db.premioGanho.findUniqueOrThrow({ where: { id: brinde.id } })).status === "EXPIRADO", "prêmio vencido vira expirado (não some)");
    }
    ok((await falha(() => cancelarPremio(s, desconto.id, "x")))?.message.includes("motivo") === true, "cancelar exige motivo");
    await cancelarPremio(s, desconto.id, "teste de cancelamento");
    ok((await db.premioGanho.findUniqueOrThrow({ where: { id: desconto.id } })).status === "CANCELADO", "gerência cancela com motivo");
    ok((await db.auditoria.count({ where: { acao: { in: ["premio_validar", "premio_cancelar", "premio_reservar", "jogo_jogar"] }, entidadeId: c1.id } })) >= 5, "tudo fica na auditoria");

    // ---------- campanha: presente sem login, um por mensagem
    const camp = await db.campanha.create({ data: { nome: "teste-jogos", segmentos: ["ate30"], mensagem: "{link}", limiteDiario: 1, jogoId: "teste-roleta" } });
    await salvarJogo(s, "teste-roleta", CONFIG, pr.map((p) => ({ ...premio(p), id: p.id, chanceBps: p.tipo === "CREDITO" ? 10_000 : 0 })));
    const envio = await db.campanhaEnvio.create({ data: { campanhaId: camp.id, clienteId: c2.id, lote: 1, status: "ENVIADO", enviadoEm: new Date(), token: `tst${Date.now()}abc` } });
    const duas = await Promise.allSettled([jogarPelaCampanha(envio.token!), jogarPelaCampanha(envio.token!)]);
    for (const r of duas) if (r.status === "rejected") console.error("campanha:", r.reason);
    const [a, b] = duas.map((r) => (r.status === "fulfilled" ? r.value : null));
    if (!a || !b) throw new Error("jogada da campanha falhou");
    ok(a.jogada.id === b.jogada.id, "link da campanha aberto 2x ao mesmo tempo = uma jogada");
    ok((await jogarPelaCampanha(envio.token!)).jaJogou, "abrir o link de novo mostra o mesmo prêmio");

    const res = await resultadoJogos("mes", "teste-caixa");
    ok(res.jogadas.total === 3, `resultado do mês conta as jogadas da caixa (${res.jogadas.total})`);
  } finally {
    await limpar();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
