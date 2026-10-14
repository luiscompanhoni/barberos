/**
 * Roleta de premios: o cliente ganha giros por atendimento (e/ou um giro gratis por periodo).
 * O sorteio e feito aqui no servidor; a tela so anima ate o premio sorteado.
 * Dinheiro vira saldo (usa na comanda); brinde fica "a retirar" no balcao.
 */
import { randomInt } from "node:crypto";
import type { RoletaPremio, TipoPremioRoleta } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { situacaoDoCliente } from "@/lib/assinaturas/servico";
import { resumoComanda } from "@/lib/comandas/regras";
import { disponiveis } from "@/lib/crescimento/saldo";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { resolverPeriodo } from "@/lib/indicadores/periodo";
import { chances, comandasComResgate, comBonus, elegiveis, girosDisponiveis, multiplicador, retornoPorReal, sortear } from "./regras";

const PADRAO: Omit<RoletaPremio, "id" | "criadoEm">[] = [
  { rotulo: "R$ 5", tipo: "CREDITO", valorCentavos: 500, peso: 20, cor: "#8BC34A", ordem: 0, ativo: true, limiteMensal: null, custoCentavos: 0 },
  { rotulo: "R$ 2", tipo: "CREDITO", valorCentavos: 200, peso: 25, cor: "#26A69A", ordem: 1, ativo: true, limiteMensal: null, custoCentavos: 0 },
  { rotulo: "Tente de novo", tipo: "NADA", valorCentavos: 0, peso: 20, cor: "#7E57C2", ordem: 2, ativo: true, limiteMensal: null, custoCentavos: 0 },
  { rotulo: "R$ 10", tipo: "CREDITO", valorCentavos: 1000, peso: 10, cor: "#D81B60", ordem: 3, ativo: true, limiteMensal: null, custoCentavos: 0 },
  { rotulo: "Bebida grátis", tipo: "BRINDE", valorCentavos: 0, peso: 8, cor: "#1E88E5", ordem: 4, ativo: true, limiteMensal: null, custoCentavos: 0 },
  { rotulo: "R$ 15", tipo: "CREDITO", valorCentavos: 1500, peso: 5, cor: "#FB8C00", ordem: 5, ativo: true, limiteMensal: null, custoCentavos: 0 },
  { rotulo: "Corte grátis", tipo: "BRINDE", valorCentavos: 0, peso: 1, cor: "#E53935", ordem: 6, ativo: true, limiteMensal: 2, custoCentavos: 0 },
  { rotulo: "R$ 3", tipo: "CREDITO", valorCentavos: 300, peso: 20, cor: "#43A047", ordem: 7, ativo: true, limiteMensal: null, custoCentavos: 0 },
  { rotulo: "Tente de novo", tipo: "NADA", valorCentavos: 0, peso: 15, cor: "#EC407A", ordem: 8, ativo: true, limiteMensal: null, custoCentavos: 0 },
  { rotulo: "R$ 25", tipo: "CREDITO", valorCentavos: 2500, peso: 2, cor: "#00ACC1", ordem: 9, ativo: true, limiteMensal: null, custoCentavos: 0 },
];

export async function configRoleta() {
  const cfg = await db.roletaConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  if (!(await db.roletaPremio.count())) await db.roletaPremio.createMany({ data: PADRAO });
  return cfg;
}

const inicioDoMes = () => {
  const d = new Date(Date.now() - 3 * 3_600_000); // fuso de Brasilia
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 3));
};

async function contagem(clienteId: string, cfg: { inicioEm: Date }) {
  const [atendimentos, usados, ultimoGratis] = await Promise.all([
    db.agendamento.count({ where: { clienteId, status: "CONCLUIDO", inicio: { gte: cfg.inicioEm } } }),
    db.roletaGiro.count({ where: { clienteId, origem: "ATENDIMENTO" } }),
    db.roletaGiro.findFirst({ where: { clienteId, origem: "GRATIS" }, orderBy: { criadoEm: "desc" }, select: { criadoEm: true } }),
  ]);
  return { atendimentos, usados, ultimoGratis: ultimoGratis?.criadoEm ?? null };
}

/** Brinde vencido sem retirar: expira. */
async function expirarBrindes(clienteId?: string) {
  await db.roletaGiro.updateMany({ where: { status: "A_RETIRAR", expiraEm: { lt: new Date() }, ...(clienteId ? { clienteId } : {}) }, data: { status: "EXPIRADO" } });
}

/** Tudo que a tela da roleta do cliente precisa. */
export async function estadoDoCliente(clienteId: string) {
  const cfg = await configRoleta();
  await expirarBrindes(clienteId);
  const [premios, c, sit, aRetirar, ultimos] = await Promise.all([
    db.roletaPremio.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] }),
    contagem(clienteId, cfg),
    situacaoDoCliente(clienteId),
    db.roletaGiro.findMany({ where: { clienteId, status: "A_RETIRAR" }, orderBy: { criadoEm: "desc" } }),
    db.roletaGiro.findMany({ where: { clienteId }, orderBy: { criadoEm: "desc" }, take: 20 }),
  ]);
  const giros = girosDisponiveis({
    atendimentos: c.atendimentos, girosPorAtendimento: cfg.girosPorAtendimento, usadosPorAtendimento: c.usados,
    giroGratisDias: cfg.giroGratisDias, ultimoGratis: c.ultimoGratis, agora: Date.now(),
  });
  return {
    ativa: cfg.ativa,
    premios: premios.map((p) => ({ id: p.id, rotulo: p.rotulo, tipo: p.tipo, valorCentavos: p.valorCentavos, cor: p.cor })),
    giros: giros.total,
    proximoGratisEm: giros.proximoGratisEm,
    girosPorAtendimento: cfg.girosPorAtendimento,
    multiplicador: multiplicador(!!sit?.valida, cfg.bonusAssinantePct),
    assinante: !!sit?.valida,
    aRetirar: aRetirar.map((g) => ({ id: g.id, rotulo: g.rotulo, expiraEm: g.expiraEm, criadoEm: g.criadoEm })),
    historico: ultimos.map((g) => ({ id: g.id, rotulo: g.rotulo, tipo: g.tipo, valorCentavos: g.valorCentavos, status: g.status, criadoEm: g.criadoEm })),
  };
}

/** Gira a roleta: consome um giro, sorteia e entrega o premio. */
export async function girar(clienteId: string) {
  const cfg = await configRoleta();
  if (!cfg.ativa) throw new ErroNegocio("A roleta está desligada no momento.", 409, "desligada");
  const sit = await situacaoDoCliente(clienteId);
  const mult = multiplicador(!!sit?.valida, cfg.bonusAssinantePct);

  return db.$transaction(async (tx) => {
    // Um giro por vez por cliente (dois toques rapidos nao gastam 2 giros nem furam o limite).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`roleta:${clienteId}`}))`;
    const [atendimentos, usados, ultimoGratis] = await Promise.all([
      tx.agendamento.count({ where: { clienteId, status: "CONCLUIDO", inicio: { gte: cfg.inicioEm } } }),
      tx.roletaGiro.count({ where: { clienteId, origem: "ATENDIMENTO" } }),
      tx.roletaGiro.findFirst({ where: { clienteId, origem: "GRATIS" }, orderBy: { criadoEm: "desc" }, select: { criadoEm: true } }),
    ]);
    const g = girosDisponiveis({
      atendimentos, girosPorAtendimento: cfg.girosPorAtendimento, usadosPorAtendimento: usados,
      giroGratisDias: cfg.giroGratisDias, ultimoGratis: ultimoGratis?.criadoEm ?? null, agora: Date.now(),
    });
    if (g.total <= 0) throw new ErroNegocio("Você não tem giros agora. Cada atendimento concluído vale giro! 💈", 409, "sem_giros");

    // Limite mensal conta global (todos os clientes); trava para nao estourar com giros simultaneos.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('roleta:sorteio'))`;
    const premios = await tx.roletaPremio.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] });
    const saiu = await tx.roletaGiro.groupBy({ by: ["premioId"], where: { criadoEm: { gte: inicioDoMes() }, premioId: { in: premios.map((p) => p.id) } }, _count: true });
    const pool = elegiveis(premios, new Map(saiu.map((s) => [s.premioId!, s._count])));
    const total = pool.reduce((t, p) => t + p.peso, 0);
    if (!pool.length || total <= 0) throw new ErroNegocio("A roleta está sem prêmios no momento. Volte mais tarde!", 409, "sem_premios");
    const premio = sortear(pool, randomInt(total));

    const valor = premio.tipo === "CREDITO" ? comBonus(premio.valorCentavos, mult) : 0;
    const expiraEm = premio.tipo === "NADA" ? null : new Date(Date.now() + cfg.validadeDias * 86_400_000);
    const beneficio = premio.tipo === "CREDITO" && valor > 0
      ? await tx.beneficio.create({ data: { clienteId, descricao: `Roleta: ${premio.rotulo}${mult > 100 ? ` (bônus x${(mult / 100).toFixed(1)})` : ""}`, valorCentavos: valor, motivo: "ROLETA", expiraEm } })
      : null;
    const giro = await tx.roletaGiro.create({
      data: {
        clienteId, premioId: premio.id, rotulo: premio.rotulo, tipo: premio.tipo, valorCentavos: valor || premio.valorCentavos,
        multiplicador: premio.tipo === "CREDITO" ? mult : 100, origem: g.gratis ? "GRATIS" : "ATENDIMENTO",
        custoCentavos: premio.tipo === "BRINDE" ? premio.custoCentavos : 0,
        status: premio.tipo === "BRINDE" ? "A_RETIRAR" : "CONCLUIDO", beneficioId: beneficio?.id, expiraEm,
      },
    });
    await auditar(tx, null, "roleta_girar", "cliente", clienteId, { premio: premio.rotulo, tipo: premio.tipo, valor });
    return {
      premioId: premio.id, rotulo: premio.rotulo, tipo: premio.tipo as TipoPremioRoleta,
      valorBaseCentavos: premio.valorCentavos, multiplicador: giro.multiplicador, valorCentavos: valor,
      expiraEm, girosRestantes: g.total - 1,
    };
  });
}

// ---------------- painel (dono / recepcao)

export async function painelRoleta() {
  const cfg = await configRoleta();
  await expirarBrindes();
  const inicio = inicioDoMes();
  const [premios, saiu, aRetirar, ultimos, girosMes, credito] = await Promise.all([
    db.roletaPremio.findMany({ orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] }),
    db.roletaGiro.groupBy({ by: ["premioId"], where: { criadoEm: { gte: inicio } }, _count: true }),
    db.roletaGiro.findMany({ where: { status: "A_RETIRAR" }, orderBy: { criadoEm: "asc" }, include: { cliente: { select: { nome: true, telefone: true } } } }),
    db.roletaGiro.findMany({ orderBy: { criadoEm: "desc" }, take: 30, include: { cliente: { select: { nome: true } } } }),
    db.roletaGiro.count({ where: { criadoEm: { gte: inicio } } }),
    db.roletaGiro.aggregate({ where: { criadoEm: { gte: inicio }, tipo: "CREDITO" }, _sum: { valorCentavos: true } }),
  ]);
  const ch = chances(premios);
  const noMes = new Map(saiu.map((s) => [s.premioId, s._count]));
  return {
    config: cfg,
    premios: premios.map((p) => ({ ...p, chance: ch.get(p.id) ?? 0, saiuNoMes: noMes.get(p.id) ?? 0 })),
    aRetirar: aRetirar.map((g) => ({ id: g.id, rotulo: g.rotulo, cliente: g.cliente.nome, telefone: g.cliente.telefone, criadoEm: g.criadoEm, expiraEm: g.expiraEm })),
    ultimos: ultimos.map((g) => ({ id: g.id, rotulo: g.rotulo, tipo: g.tipo, valorCentavos: g.valorCentavos, cliente: g.cliente.nome, status: g.status, criadoEm: g.criadoEm })),
    mes: { giros: girosMes, creditoCentavos: credito._sum.valorCentavos ?? 0 },
  };
}

export type ConfigEntrada = { ativa: boolean; girosPorAtendimento: number; giroGratisDias: number; bonusAssinantePct: number; validadeDias: number };
export type PremioEntrada = {
  id?: string; rotulo: string; tipo: TipoPremioRoleta; valorCentavos: number; peso: number; cor: string; ativo: boolean; limiteMensal: number | null;
  /** Custo interno do brinde (so BRINDE; dinheiro custa o que o cliente usar). */
  custoCentavos?: number;
};

export async function salvarRoleta(s: Sessao, config: ConfigEntrada, premios: PremioEntrada[]) {
  if (premios.filter((p) => p.ativo).length < 2) throw new ErroNegocio("Deixe pelo menos 2 prêmios ativos na roleta.");
  if (premios.filter((p) => p.ativo).length > 16) throw new ErroNegocio("No máximo 16 fatias ativas (senão o texto não cabe).");
  if (!premios.some((p) => p.ativo && p.peso > 0)) throw new ErroNegocio("Pelo menos um prêmio ativo precisa ter chance maior que zero.");
  for (const p of premios) if (p.tipo === "CREDITO" && p.valorCentavos <= 0) throw new ErroNegocio(`"${p.rotulo}": prêmio em dinheiro precisa de valor.`);

  await db.$transaction(async (tx) => {
    const atual = await tx.roletaConfig.findUnique({ where: { id: 1 } });
    // Ligando agora: so atendimentos daqui pra frente dao giro.
    const ligando = config.ativa && !atual?.ativa;
    await tx.roletaConfig.upsert({
      where: { id: 1 },
      create: { id: 1, ...config },
      update: { ...config, ...(ligando ? { inicioEm: new Date() } : {}) },
    });
    const ids = premios.map((p) => p.id).filter((x): x is string => !!x);
    // Premio que saiu da lista: desativa (mantem o historico dos giros).
    await tx.roletaPremio.updateMany({ where: { id: { notIn: ids } }, data: { ativo: false } });
    for (const [ordem, p] of premios.entries()) {
      const dados = {
        rotulo: p.rotulo, tipo: p.tipo, valorCentavos: p.tipo === "NADA" ? 0 : p.valorCentavos, peso: p.peso, cor: p.cor, ativo: p.ativo, limiteMensal: p.limiteMensal, ordem,
        custoCentavos: p.tipo === "BRINDE" ? (p.custoCentavos ?? 0) : 0,
      };
      if (p.id) await tx.roletaPremio.update({ where: { id: p.id }, data: dados });
      else await tx.roletaPremio.create({ data: dados });
    }
    await auditar(tx, s.usuarioId, "roleta_configurar", "configuracao", "roleta", {
      antes: atual, depois: config, premios: premios.map((p) => ({ rotulo: p.rotulo, tipo: p.tipo, valorCentavos: p.valorCentavos, custoCentavos: p.custoCentavos ?? 0, peso: p.peso, ativo: p.ativo })),
    });
  });
  return painelRoleta();
}

export async function entregarBrinde(s: Sessao, giroId: string) {
  const g = await db.roletaGiro.findUnique({ where: { id: giroId } });
  if (!g) throw naoEncontrado("Prêmio");
  if (g.status !== "A_RETIRAR") throw new ErroNegocio(g.status === "EXPIRADO" ? "Esse brinde já venceu." : "Esse brinde já foi entregue.");
  await db.$transaction(async (tx) => {
    await tx.roletaGiro.update({ where: { id: giroId }, data: { status: "CONCLUIDO", entregueEm: new Date(), entreguePorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "roleta_entregar", "cliente", g.clienteId, { giroId, premio: g.rotulo });
  });
}

/**
 * Custo x faturamento da roleta no periodo:
 * - custo: brindes entregues (custo de cada um) + credito da roleta usado nas comandas;
 * - faturamento: o que foi pago nas visitas com resgate (comanda em que usou credito da roleta, ou do mesmo dia em
 *   que retirou um brinde);
 * - saldo da roleta ainda em aberto (pode virar custo depois).
 */
export async function resultadoRoleta(chave: string | null) {
  const fuso = (await configuracao()).fuso;
  const p = resolverPeriodo(chave, fuso);
  const janela = { gte: new Date(p.de), lt: new Date(p.ate) };
  const [giros, brindes, creditos, aberto] = await Promise.all([
    db.roletaGiro.groupBy({ by: ["tipo"], where: { criadoEm: janela }, _count: true }),
    db.roletaGiro.findMany({ where: { tipo: "BRINDE", status: "CONCLUIDO", entregueEm: janela }, select: { clienteId: true, entregueEm: true, custoCentavos: true, premio: { select: { custoCentavos: true } } } }),
    db.beneficio.findMany({ where: { motivo: "ROLETA", status: "USADO", usadoEm: janela }, select: { valorCentavos: true, comandaId: true } }),
    db.beneficio.aggregate({ where: { motivo: "ROLETA", ...disponiveis() }, _sum: { valorCentavos: true }, _count: true }),
  ]);
  const comCredito = new Set(creditos.map((c) => c.comandaId).filter((x): x is string => !!x));
  const candidatas = await db.comanda.findMany({
    where: { status: "FECHADA", OR: [{ id: { in: [...comCredito] } }, { clienteId: { in: [...new Set(brindes.map((b) => b.clienteId))] }, fechadaEm: janela }] },
    select: { id: true, clienteId: true, fechadaEm: true, descontoCentavos: true, itens: { select: { quantidade: true, precoUnitCentavos: true } }, pagamentos: { select: { forma: true, valorCentavos: true, status: true, estornadoCentavos: true, estornadoEm: true } } },
  });
  const visitas = comandasComResgate(
    candidatas.map((c) => ({ ...c, dia: dataLocal(c.fechadaEm!, fuso) })), comCredito,
    brindes.map((b) => ({ clienteId: b.clienteId, dia: dataLocal(b.entregueEm!, fuso) })),
  );
  const custoBrindes = brindes.reduce((t, b) => t + (b.custoCentavos || b.premio?.custoCentavos || 0), 0);
  const creditoUsado = creditos.reduce((t, c) => t + c.valorCentavos, 0);
  const custo = custoBrindes + creditoUsado;
  const faturamento = visitas.reduce((t, c) => t + resumoComanda(c.itens, c.pagamentos, c.descontoCentavos).pago, 0);
  const qtd = (tipo: TipoPremioRoleta) => giros.find((g) => g.tipo === tipo)?._count ?? 0;
  return {
    periodo: { chave: p.chave, rotulo: p.rotulo },
    giros: { total: qtd("CREDITO") + qtd("BRINDE") + qtd("NADA"), credito: qtd("CREDITO"), brinde: qtd("BRINDE"), nada: qtd("NADA") },
    brindes: { entregues: brindes.length, custoCentavos: custoBrindes, semCusto: brindes.filter((b) => !(b.custoCentavos || b.premio?.custoCentavos)).length },
    creditos: { usos: creditos.length, usadoCentavos: creditoUsado },
    custoCentavos: custo,
    visitas: visitas.length,
    faturamentoCentavos: faturamento,
    retorno: retornoPorReal(faturamento, custo),
    saldoAberto: { centavos: aberto._sum.valorCentavos ?? 0, creditos: aberto._count },
  };
}
