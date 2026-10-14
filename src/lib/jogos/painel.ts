/**
 * Painel dos jogos (dono/gerencia configuram; recepcao ve jogadas e resgates).
 * Salvar so passa com as chances somando 100%; a simulacao roda a mesma regra do sorteio antes de publicar.
 */
import { randomInt } from "node:crypto";
import type { Jogo, Prisma, Raridade, TipoPremio } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { resumoComanda } from "@/lib/comandas/regras";
import { disponiveis } from "@/lib/crescimento/saldo";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { resolverPeriodo } from "@/lib/indicadores/periodo";
import { listarJogos } from "./motor";
import { atualizarPremios } from "./premios";
import { comandasComResgate, custoEsperado, retornoPorReal, simular, validarPremios } from "./regras";

const inicioDoMes = () => {
  const d = new Date(Date.now() - 3 * 3_600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 3));
};

/** Todos os jogos com os premios (e quantas vezes cada um saiu no mes) para a tela de configuracao. */
export async function painelJogos() {
  const jogos = await listarJogos();
  await atualizarPremios();
  const inicio = inicioDoMes();
  const [premios, saiu, jogadasMes, abertos, servicos] = await Promise.all([
    db.jogoPremio.findMany({ orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] }),
    db.premioGanho.groupBy({ by: ["premioId"], where: { criadoEm: { gte: inicio } }, _count: true }),
    db.jogada.groupBy({ by: ["jogoId"], where: { criadoEm: { gte: inicio } }, _count: true }),
    db.premioGanho.groupBy({ by: ["jogoId"], where: { status: { in: ["DISPONIVEL", "RESERVADO"] }, tipo: { not: "CREDITO" } }, _count: true }),
    db.servico.findMany({ where: { ativo: true }, orderBy: { ordem: "asc" }, select: { id: true, nome: true, precoCentavos: true } }),
  ]);
  const noMes = new Map(saiu.map((s) => [s.premioId, s._count]));
  return {
    jogos: jogos.map((j) => {
      const ps = premios.filter((p) => p.jogoId === j.id);
      return {
        ...j,
        premios: ps.map((p) => ({ ...p, saiuNoMes: noMes.get(p.id) ?? 0 })),
        jogadasNoMes: jogadasMes.find((x) => x.jogoId === j.id)?._count ?? 0,
        premiosAbertos: abertos.find((x) => x.jogoId === j.id)?._count ?? 0,
        custoPorJogadaCentavos: custoEsperado(ps, j.tipo === "CAIXA" ? j.premiosPorJogada : 1),
      };
    }),
    servicos,
  };
}

export type ConfigJogo = Pick<Jogo,
  "nome" | "descricao" | "ativo" | "premiosPorJogada" | "raridade" | "validadeDias" | "bonusAssinantePct" | "inicioEm" | "fimEm" |
  "limitePorPessoaMes" | "jogadasPorAtendimento" | "valorMinimoAtendimentoCentavos" | "soAssinante" | "jogadasPorIndicacao" |
  "jogadasAniversario" | "jogadasRenovacaoPlano" | "gratisACadaDias">;

export type PremioEntrada = {
  id?: string; rotulo: string; tipo: TipoPremio; valorCentavos: number; percentual: number; servicoId: string | null; chanceBps: number;
  raridade: Raridade; cor: string; icone: string; ativo: boolean; limiteMensal: number | null; estoque: number | null; custoCentavos: number;
};

/** Salva a configuracao e os premios de um jogo (so com chances validas). Premio removido e desativado, nunca apagado. */
export async function salvarJogo(s: Sessao, jogoId: string, config: ConfigJogo, premios: PremioEntrada[]) {
  const atual = await db.jogo.findUnique({ where: { id: jogoId } });
  if (!atual) throw naoEncontrado("Jogo");
  const erros = validarPremios(atual.tipo, premios);
  if (config.inicioEm && config.fimEm && config.fimEm <= config.inicioEm) erros.push("O fim do período precisa ser depois do início.");
  if (atual.tipo === "CAIXA" && (config.premiosPorJogada < 1 || config.premiosPorJogada > 5)) erros.push("Caixa dá de 1 a 5 prêmios.");
  if (erros.length) throw new ErroNegocio(erros[0], 422, "config_invalida", erros);
  const servicos = new Set((await db.servico.findMany({ select: { id: true } })).map((x) => x.id));
  for (const p of premios) if (p.servicoId && !servicos.has(p.servicoId)) throw new ErroNegocio(`"${p.rotulo}": serviço não encontrado.`);

  await db.$transaction(async (tx) => {
    // Ligando agora: so eventos daqui pra frente liberam jogadas.
    const ligando = config.ativo && !atual.ativo;
    await tx.jogo.update({
      where: { id: jogoId },
      data: { ...config, premiosPorJogada: atual.tipo === "CAIXA" ? config.premiosPorJogada : 1, ...(ligando ? { contarDesde: new Date() } : {}) },
    });
    const ids = premios.map((p) => p.id).filter((x): x is string => !!x);
    await tx.jogoPremio.updateMany({ where: { jogoId, id: { notIn: ids } }, data: { ativo: false } });
    for (const [ordem, p] of premios.entries()) {
      const dados = {
        rotulo: p.rotulo, tipo: p.tipo, chanceBps: p.chanceBps, raridade: p.raridade, cor: p.cor, icone: p.icone, ativo: p.ativo, ordem,
        valorCentavos: p.tipo === "CREDITO" || p.tipo === "SERVICO" ? p.valorCentavos : 0,
        percentual: p.tipo === "DESCONTO" ? p.percentual : 0,
        servicoId: p.tipo === "SERVICO" ? p.servicoId : null,
        limiteMensal: p.limiteMensal, estoque: p.estoque,
        custoCentavos: p.tipo === "BRINDE" || p.tipo === "SERVICO" ? p.custoCentavos : 0,
      };
      if (p.id) {
        const r = await tx.jogoPremio.updateMany({ where: { id: p.id, jogoId }, data: dados });
        if (!r.count) throw new ErroNegocio(`"${p.rotulo}": prêmio de outro jogo.`);
      } else await tx.jogoPremio.create({ data: { ...dados, jogoId } });
    }
    await auditar(tx, s.usuarioId, "jogo_configurar", "configuracao", jogoId, {
      antes: { ativo: atual.ativo, validadeDias: atual.validadeDias, limitePorPessoaMes: atual.limitePorPessoaMes },
      depois: { ...config, inicioEm: config.inicioEm?.toISOString() ?? null, fimEm: config.fimEm?.toISOString() ?? null },
      premios: premios.map((p) => ({ rotulo: p.rotulo, tipo: p.tipo, chanceBps: p.chanceBps, estoque: p.estoque, custoCentavos: p.custoCentavos, ativo: p.ativo })),
    } as Prisma.InputJsonValue);
  });
  return painelJogos();
}

/** Simulacao de distribuicao (antes de publicar): N jogadas com a mesma regra do sorteio do servidor. */
export function simularJogo(tipo: Jogo["tipo"], premiosPorJogada: number, premios: (PremioEntrada & { id: string })[], jogadas: number) {
  const erros = validarPremios(tipo, premios);
  const n = Math.min(Math.max(jogadas, 100), 100_000);
  const porJogada = tipo === "CAIXA" ? Math.max(1, premiosPorJogada) : 1;
  const { conta, semPremio } = simular(premios, n, porJogada, (max) => randomInt(max));
  const linhas = premios.filter((p) => p.ativo).map((p) => {
    const saiu = conta.get(p.id) ?? 0;
    const custoUn = p.tipo === "CREDITO" ? p.valorCentavos : p.tipo === "NADA" ? 0 : p.custoCentavos;
    return { id: p.id, rotulo: p.rotulo, tipo: p.tipo, chanceBps: p.chanceBps, saiu, pctReal: Math.round((saiu / (n * porJogada)) * 10_000) / 100, custoCentavos: saiu * custoUn };
  });
  const custo = linhas.reduce((t, l) => t + l.custoCentavos, 0);
  return {
    erros, jogadas: n, sorteios: n * porJogada, semPremio, linhas,
    custoTotalCentavos: custo, custoPorJogadaCentavos: Math.round(custo / n),
    custoEsperadoPorJogadaCentavos: custoEsperado(premios, porJogada),
    vitoriaPct: Math.round((linhas.filter((l) => l.tipo !== "NADA").reduce((t, l) => t + l.saiu, 0) / (n * porJogada)) * 10_000) / 100,
  };
}

/** Jogadas recentes (com IP e aparelho para conferir fraude) e os premios de cada uma. */
export async function jogadasRecentes(f: { jogoId?: string; clienteId?: string; limite?: number }) {
  const js = await db.jogada.findMany({
    where: { ...(f.jogoId ? { jogoId: f.jogoId } : {}), ...(f.clienteId ? { clienteId: f.clienteId } : {}) },
    orderBy: { criadoEm: "desc" }, take: Math.min(f.limite ?? 50, 200),
    include: { cliente: { select: { nome: true, telefone: true } }, premios: { select: { id: true, codigo: true, rotulo: true, status: true, tipo: true } } },
  });
  return js.map((j) => ({
    id: j.id, jogoId: j.jogoId, tipo: j.tipo, origem: j.origem, vitoria: j.vitoria, criadoEm: j.criadoEm, revelada: !!j.reveladaEm,
    ip: j.ip, dispositivo: j.dispositivo, cliente: j.cliente, premios: j.premios,
  }));
}

/**
 * Custo x faturamento dos jogos no periodo (de um jogo ou de todos):
 * - custo: brindes entregues + desconto dado por servico gratis/% + credito do jogo usado nas comandas;
 * - faturamento: o que foi pago nas visitas com resgate;
 * - credito ainda em aberto (pode virar custo depois).
 */
export async function resultadoJogos(chave: string | null, jogoId?: string) {
  const fuso = (await configuracao()).fuso;
  const p = resolverPeriodo(chave, fuso);
  const janela = { gte: new Date(p.de), lt: new Date(p.ate) };
  const doJogo = jogoId ? { jogoId } : {};
  const [jogadas, usados, creditosDoJogo] = await Promise.all([
    db.jogada.groupBy({ by: ["vitoria"], where: { ...doJogo, criadoEm: janela }, _count: true }),
    db.premioGanho.findMany({ where: { ...doJogo, tipo: { in: ["BRINDE", "SERVICO", "DESCONTO"] }, status: "UTILIZADO", utilizadoEm: janela }, select: { clienteId: true, utilizadoEm: true, custoCentavos: true, descontoAplicadoCentavos: true, comandaId: true, tipo: true } }),
    db.premioGanho.findMany({ where: { ...doJogo, tipo: "CREDITO", beneficioId: { not: null } }, select: { beneficioId: true } }),
  ]);
  const idsCredito = creditosDoJogo.map((c) => c.beneficioId!);
  const doCredito = { OR: [{ id: { in: idsCredito } }, { origemBeneficioId: { in: idsCredito } }] };
  const [creditos, aberto] = await Promise.all([
    db.beneficio.findMany({ where: { ...doCredito, status: "USADO", usadoEm: janela }, select: { valorCentavos: true, comandaId: true } }),
    db.beneficio.aggregate({ where: { ...doCredito, ...disponiveis() }, _sum: { valorCentavos: true }, _count: true }),
  ]);
  const comResgate = new Set([...creditos.map((c) => c.comandaId), ...usados.map((u) => u.comandaId)].filter((x): x is string => !!x));
  const semComanda = usados.filter((u) => !u.comandaId);
  const candidatas = await db.comanda.findMany({
    where: { status: "FECHADA", OR: [{ id: { in: [...comResgate] } }, { clienteId: { in: [...new Set(semComanda.map((b) => b.clienteId))] }, fechadaEm: janela }] },
    select: { id: true, clienteId: true, fechadaEm: true, descontoCentavos: true, itens: { select: { quantidade: true, precoUnitCentavos: true } }, pagamentos: { select: { forma: true, valorCentavos: true, status: true, estornadoCentavos: true, estornadoEm: true } } },
  });
  const visitas = comandasComResgate(
    candidatas.map((c) => ({ ...c, dia: dataLocal(c.fechadaEm!, fuso) })), comResgate,
    semComanda.map((b) => ({ clienteId: b.clienteId, dia: dataLocal(b.utilizadoEm!, fuso) })),
  );
  const custoBrindes = usados.filter((u) => u.tipo === "BRINDE").reduce((t, b) => t + b.custoCentavos, 0);
  const custoDescontos = usados.reduce((t, b) => t + b.descontoAplicadoCentavos, 0);
  const creditoUsado = creditos.reduce((t, c) => t + c.valorCentavos, 0);
  const custo = custoBrindes + custoDescontos + creditoUsado;
  const faturamento = visitas.reduce((t, c) => t + resumoComanda(c.itens, c.pagamentos, c.descontoCentavos).pago, 0);
  const qtd = (v: boolean) => jogadas.find((g) => g.vitoria === v)?._count ?? 0;
  return {
    periodo: { chave: p.chave, rotulo: p.rotulo },
    jogadas: { total: qtd(true) + qtd(false), vitorias: qtd(true) },
    brindes: { entregues: usados.filter((u) => u.tipo === "BRINDE").length, custoCentavos: custoBrindes, semCusto: usados.filter((u) => u.tipo === "BRINDE" && !u.custoCentavos).length },
    descontos: { usos: usados.filter((u) => u.tipo !== "BRINDE").length, centavos: custoDescontos },
    creditos: { usos: creditos.length, usadoCentavos: creditoUsado },
    custoCentavos: custo,
    visitas: visitas.length,
    faturamentoCentavos: faturamento,
    retorno: retornoPorReal(faturamento, custo),
    saldoAberto: { centavos: aberto._sum.valorCentavos ?? 0, creditos: aberto._count },
  };
}
