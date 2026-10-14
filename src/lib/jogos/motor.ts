/**
 * Motor unico dos jogos de recompensa. Uma jogada:
 * 1. trava o cliente (dois toques ou duas abas nao jogam duas vezes);
 * 2. devolve a mesma jogada se a chave de idempotencia ja foi usada (atualizou a pagina, caiu a conexao);
 * 3. gasta uma ficha, sorteia no servidor (crypto) respeitando estoque e limite do mes;
 * 4. grava jogada + premios (credito vai para o saldo) ANTES de responder. A tela so anima o resultado.
 */
import { randomBytes, randomInt } from "node:crypto";
import type { Jogada, Jogo, JogoPremio, PremioGanho, Prisma } from "@prisma/client";
import { auditar, origemDaRequisicao } from "@/lib/auditoria";
import { situacaoDoCliente } from "@/lib/assinaturas/servico";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { comoGanhar, contarFichas, fichasLivres, sincronizarFichas } from "./fichas";
import { TODOS_PADRAO } from "./padroes";
import { codigoDoPremio, comBonus, elegiveis, montarGrade, multiplicador, sortear, type Simbolo } from "./regras";
import type { CentralJogos, FatiaRoleta, JogadaCliente, JogoCliente, PremioCliente, ResultadoJogada } from "./tipos";

type Tx = Prisma.TransactionClient;
const DIA = 86_400_000;

/** Cria os jogos padrao que faltam (desligados). Idempotente. */
export async function garantirJogos() {
  const existentes = new Set((await db.jogo.findMany({ select: { id: true } })).map((j) => j.id));
  for (const p of TODOS_PADRAO.filter((j) => !existentes.has(j.id))) {
    const { premios, ...jogo } = p;
    await db.$transaction(async (tx) => {
      const criado = await tx.jogo.createMany({ data: [{ ...jogo, ativo: false }], skipDuplicates: true });
      if (criado.count) await tx.jogoPremio.createMany({ data: premios.map((x, ordem) => ({ ...x, jogoId: p.id, ordem })) });
    });
  }
}

export async function listarJogos() {
  await garantirJogos();
  return db.jogo.findMany({ orderBy: [{ ordem: "asc" }, { id: "asc" }] });
}

/** Jogo no ar agora: ligado e dentro do periodo. */
export function noAr(j: Pick<Jogo, "ativo" | "inicioEm" | "fimEm">, agora = new Date()) {
  return j.ativo && (!j.inicioEm || j.inicioEm <= agora) && (!j.fimEm || j.fimEm > agora);
}

const inicioDoMes = (agora = Date.now()) => {
  const d = new Date(agora - 3 * 3_600_000); // fuso de Brasilia
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 3));
};

const premiosDoJogo = (tx: Tx | typeof db, jogoId: string) =>
  tx.jogoPremio.findMany({ where: { jogoId, ativo: true }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] });

const fatia = (p: JogoPremio): FatiaRoleta => ({ id: p.id, rotulo: p.rotulo, cor: p.cor, icone: p.icone, tipo: p.tipo, raridade: p.raridade });

// ---------------- jogada

export type OpcoesJogada = {
  /** Ficha especifica (presente da campanha). Sem ela, usa a ficha mais antiga do cliente. */
  fichaId?: string;
  ip?: string | null;
  dispositivo?: string | null;
};

const CHAVE = /^[\w:-]{8,120}$/;

/** Joga. Repetir a mesma `chave` devolve a jogada ja feita (nunca joga duas vezes). */
export async function jogar(clienteId: string, jogoId: string, chave: string, o: OpcoesJogada = {}): Promise<JogadaCliente> {
  if (!CHAVE.test(chave)) throw new ErroNegocio("Jogada inválida. Atualize a página.", 400, "chave");
  const ja = await db.jogada.findUnique({ where: { chave }, include: { premios: { include: { agendamento: true } } } });
  if (ja) return repetida(ja, clienteId);

  const jogo = await db.jogo.findUnique({ where: { id: jogoId } });
  if (!jogo) throw naoEncontrado("Jogo");
  if (!noAr(jogo)) throw new ErroNegocio(`${jogo.nome} está fora do ar no momento.`, 409, "desligado");
  const sit = await situacaoDoCliente(clienteId);
  if (jogo.soAssinante && !sit?.valida) throw new ErroNegocio(`${jogo.nome} é exclusiva para assinantes em dia.`, 403, "so_assinante");
  const mult = multiplicador(!!sit?.valida, jogo.bonusAssinantePct);
  const origem = o.ip !== undefined ? { ip: o.ip ?? null, dispositivo: o.dispositivo ?? null } : await origemDaRequisicao();

  const jogada = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`jogos:${clienteId}`}))`;
    // Outra requisicao com a mesma chave pode ter terminado enquanto esta esperava a trava.
    const dentro = await tx.jogada.findUnique({ where: { chave } });
    if (dentro) return dentro.id;

    if (!o.fichaId) await sincronizarFichas(tx, clienteId, jogo);
    const ficha = o.fichaId
      ? await tx.fichaJogo.findFirst({ where: { id: o.fichaId, ...fichasLivres(clienteId, jogoId) } })
      : await tx.fichaJogo.findFirst({ where: fichasLivres(clienteId, jogoId), orderBy: [{ expiraEm: { sort: "asc", nulls: "last" } }, { criadoEm: "asc" }] });
    if (!ficha) throw new ErroNegocio("Você não tem jogadas agora. Cada atendimento concluído libera mais! 💈", 409, "sem_jogadas");
    if (jogo.limitePorPessoaMes !== null) {
      const noMes = await tx.jogada.count({ where: { clienteId, jogoId, criadoEm: { gte: inicioDoMes() } } });
      if (noMes >= jogo.limitePorPessoaMes) throw new ErroNegocio(`Você já jogou ${jogo.nome} o máximo deste mês. Volte no mês que vem!`, 409, "limite_mes");
    }

    // Estoque e limite do mes valem para todos os clientes: um sorteio por vez em cada jogo.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`jogos:sorteio:${jogoId}`}))`;
    const premios = await premiosDoJogo(tx, jogoId);
    const saiu = await tx.premioGanho.groupBy({ by: ["premioId"], where: { jogoId, criadoEm: { gte: inicioDoMes() }, premioId: { in: premios.map((p) => p.id) } }, _count: true });
    const noMes = new Map(saiu.map((s) => [s.premioId!, s._count]));
    const estoque = new Map(premios.map((p) => [p.id, p.estoque]));
    const vezes = jogo.tipo === "CAIXA" ? Math.max(1, jogo.premiosPorJogada) : 1;
    const sorteados: JogoPremio[] = [];
    for (let i = 0; i < vezes; i++) {
      const pool = elegiveis(premios.map((p) => ({ ...p, estoque: estoque.get(p.id) ?? null })), noMes);
      const total = pool.reduce((t, p) => t + p.chanceBps, 0);
      if (!pool.length || total <= 0) {
        if (sorteados.length) break; // caixa: o que ja saiu fica
        throw new ErroNegocio(`${jogo.nome} está sem prêmios no momento. Volte mais tarde!`, 409, "sem_premios");
      }
      const p = sortear(pool, randomInt(total));
      sorteados.push(p);
      noMes.set(p.id, (noMes.get(p.id) ?? 0) + 1);
      const e = estoque.get(p.id);
      if (e !== null && e !== undefined) estoque.set(p.id, e - 1);
    }

    const ganhos = sorteados.filter((p) => p.tipo !== "NADA");
    const resultado = montarResultado(jogo, premios, sorteados[0]);
    const nova = await tx.jogada.create({
      data: {
        chave, jogoId, tipo: jogo.tipo, clienteId, origem: ficha.origem, multiplicador: mult, vitoria: ganhos.length > 0,
        resultado: resultado as unknown as Prisma.InputJsonValue, ip: origem.ip, dispositivo: origem.dispositivo,
      },
    });
    await tx.fichaJogo.update({ where: { id: ficha.id }, data: { jogadaId: nova.id } });
    for (const p of ganhos) await entregar(tx, jogo, nova, p, mult);
    for (const p of new Set(ganhos)) {
      const e = estoque.get(p.id);
      if (e !== null && e !== undefined) await tx.jogoPremio.update({ where: { id: p.id }, data: { estoque: Math.max(0, e) } });
    }
    await auditar(tx, null, "jogo_jogar", "cliente", clienteId, {
      jogo: jogoId, jogada: nova.id, origem: ficha.origem, premios: ganhos.map((p) => p.rotulo), vitoria: ganhos.length > 0,
    });
    return nova.id;
  });

  const r = await db.jogada.findUniqueOrThrow({ where: { id: jogada }, include: { premios: { include: { agendamento: true } } } });
  return paraCliente(r);
}

function repetida(j: Jogada & { premios: (PremioGanho & { agendamento: { id: string; inicio: Date } | null })[] }, clienteId: string) {
  if (j.clienteId !== clienteId) throw new ErroNegocio("Jogada inválida. Atualize a página.", 409, "chave");
  return paraCliente(j);
}

/** O que a tela vai animar. Roleta: a fatia do premio (na roda de agora). Raspadinha: a cartela inteira. */
function montarResultado(jogo: Jogo, premios: JogoPremio[], primeiro: JogoPremio): ResultadoJogada {
  if (jogo.tipo === "ROLETA") {
    const fatias = premios.map(fatia);
    const indice = fatias.findIndex((f) => f.id === primeiro.id);
    if (indice < 0) throw new Error("Prêmio sorteado fora da roda.");
    return { tipo: "ROLETA", fatias, indice };
  }
  if (jogo.tipo === "RASPADINHA") {
    const simbolo = (p: JogoPremio): Simbolo => ({ simbolo: p.id, rotulo: p.rotulo, icone: p.icone });
    const reais = premios.filter((p) => p.tipo !== "NADA");
    const { grade, vencedoras } = montarGrade(primeiro.tipo === "NADA" ? null : simbolo(primeiro), reais.map(simbolo), (max) => randomInt(max));
    return { tipo: "RASPADINHA", grade, vencedoras };
  }
  return { tipo: "CAIXA", quantidade: Math.max(1, jogo.premiosPorJogada) };
}

/** Grava o premio ganho (credito ja entra no saldo; o resto fica disponivel com codigo para usar na barbearia). */
async function entregar(tx: Tx, jogo: Jogo, jogada: Jogada, p: JogoPremio, mult: number) {
  const expiraEm = new Date(Date.now() + jogo.validadeDias * DIA);
  const valor = p.tipo === "CREDITO" ? comBonus(p.valorCentavos, mult) : p.valorCentavos;
  const beneficio = p.tipo === "CREDITO"
    ? await tx.beneficio.create({
        data: {
          clienteId: jogada.clienteId, valorCentavos: valor, expiraEm, motivo: jogo.tipo === "ROLETA" ? "ROLETA" : "JOGO",
          descricao: `${jogo.nome}: ${p.rotulo}${mult > 100 ? ` (bônus x${(mult / 100).toFixed(1)})` : ""}`,
        },
      })
    : null;
  return tx.premioGanho.create({
    data: {
      codigo: await codigoLivre(tx), jogadaId: jogada.id, jogoId: jogo.id, clienteId: jogada.clienteId, premioId: p.id,
      rotulo: p.rotulo, tipo: p.tipo, raridade: p.raridade, icone: p.icone, valorCentavos: valor, percentual: p.percentual,
      servicoId: p.servicoId, multiplicador: p.tipo === "CREDITO" ? mult : 100, custoCentavos: p.tipo === "CREDITO" ? 0 : p.custoCentavos,
      // Credito ja esta no saldo: o premio foi entregue.
      status: p.tipo === "CREDITO" ? "UTILIZADO" : "DISPONIVEL", utilizadoEm: p.tipo === "CREDITO" ? new Date() : null,
      beneficioId: beneficio?.id, expiraEm,
    },
  });
}

async function codigoLivre(tx: Tx) {
  for (let i = 0; i < 8; i++) {
    const c = codigoDoPremio(randomBytes(6));
    if (!(await tx.premioGanho.findUnique({ where: { codigo: c }, select: { id: true } }))) return c;
  }
  throw new Error("Não consegui gerar o código do prêmio.");
}

// ---------------- leitura para o cliente

type PremioComAgenda = PremioGanho & { agendamento: { id: string; inicio: Date } | null };

export function premioParaCliente(p: PremioComAgenda): PremioCliente {
  return {
    id: p.id, codigo: p.codigo, jogoId: p.jogoId, rotulo: p.rotulo, tipo: p.tipo, raridade: p.raridade, icone: p.icone,
    valorCentavos: p.valorCentavos, percentual: p.percentual, status: p.status,
    expiraEm: p.expiraEm?.toISOString() ?? null, criadoEm: p.criadoEm.toISOString(), utilizadoEm: p.utilizadoEm?.toISOString() ?? null,
    agendamento: p.agendamento && p.status === "RESERVADO" ? { id: p.agendamento.id, inicio: p.agendamento.inicio.toISOString() } : null,
  };
}

export function paraCliente(j: Jogada & { premios: PremioComAgenda[] }): JogadaCliente {
  return {
    id: j.id, jogoId: j.jogoId, tipo: j.tipo, vitoria: j.vitoria, multiplicador: j.multiplicador,
    resultado: j.resultado as unknown as ResultadoJogada,
    premios: [...j.premios].sort((a, b) => +a.criadoEm - +b.criadoEm || a.id.localeCompare(b.id)).map(premioParaCliente),
    revelada: !!j.reveladaEm, criadoEm: j.criadoEm.toISOString(),
  };
}

/** A tela terminou a animacao: a jogada nao aparece mais como pendente. */
export async function marcarRevelada(clienteId: string, jogadaId: string) {
  await db.jogada.updateMany({ where: { id: jogadaId, clienteId, reveladaEm: null }, data: { reveladaEm: new Date() } });
}

/** Jogada sem revelar mais recente de cada jogo (ate 7 dias). */
async function pendentes(clienteId: string) {
  const js = await db.jogada.findMany({
    where: { clienteId, reveladaEm: null, criadoEm: { gte: new Date(Date.now() - 7 * DIA) } },
    orderBy: { criadoEm: "desc" }, include: { premios: { include: { agendamento: true } } },
  });
  const porJogo = new Map<string, JogadaCliente>();
  for (const j of js) if (!porJogo.has(j.jogoId)) porJogo.set(j.jogoId, paraCliente(j));
  return porJogo;
}

/** Central de jogos do cliente: jogos no ar, jogadas de cada um, vitrine de premios e jogada pendente. */
export async function centralDoCliente(clienteId: string): Promise<CentralJogos> {
  const jogos = (await listarJogos()).filter((j) => noAr(j));
  const [fichas, sit, pend, premios, ativos] = await Promise.all([
    contarFichas(clienteId, jogos),
    situacaoDoCliente(clienteId),
    pendentes(clienteId),
    db.jogoPremio.findMany({ where: { jogoId: { in: jogos.map((j) => j.id) }, ativo: true }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] }),
    db.premioGanho.count({ where: { clienteId, status: { in: ["DISPONIVEL", "RESERVADO"] } } }),
  ]);
  const assinante = !!sit?.valida;
  return {
    jogos: jogos.map((j): JogoCliente => {
      const doJogo = premios.filter((p) => p.jogoId === j.id);
      return {
        id: j.id, tipo: j.tipo, nome: j.nome, descricao: j.descricao, raridade: j.raridade, premiosPorJogada: j.premiosPorJogada,
        ativo: true, soAssinante: j.soAssinante,
        fichas: j.soAssinante && !assinante ? 0 : fichas.get(j.id)?.fichas ?? 0,
        proximaGratisEm: fichas.get(j.id)?.proximaGratisEm?.toISOString() ?? null,
        comoGanhar: comoGanhar(j),
        vitrine: doJogo.filter((p) => p.tipo !== "NADA").map((p) => ({ id: p.id, rotulo: p.rotulo, tipo: p.tipo, raridade: p.raridade, icone: p.icone, cor: p.cor, chanceBps: p.chanceBps })),
        fatias: j.tipo === "ROLETA" ? doJogo.map(fatia) : [],
        pendente: pend.get(j.id) ?? null,
      };
    }),
    multiplicador: multiplicador(assinante, jogos[0]?.bonusAssinantePct ?? 10),
    assinante,
    premiosAtivos: ativos,
  };
}

/** Um jogo da central (a tela do jogo carrega so ele). */
export async function jogoDoCliente(clienteId: string, jogoId: string) {
  const c = await centralDoCliente(clienteId);
  const j = c.jogos.find((x) => x.id === jogoId);
  if (!j) throw new ErroNegocio("Esse jogo está fora do ar no momento.", 404, "desligado");
  return { ...j, multiplicador: c.multiplicador, assinante: c.assinante };
}

// ---------------- campanha (link sem login)

/**
 * Jogada de presente da campanha: uma por mensagem enviada, valida pelos dias de validade do jogo.
 * Abrir de novo devolve a mesma jogada.
 */
export async function jogarPelaCampanha(token: string, o: OpcoesJogada = {}) {
  const envio = await db.campanhaEnvio.findUnique({ where: { token }, include: { campanha: { include: { jogo: true } } } });
  const jogo = envio?.campanha.jogo;
  if (!envio || !jogo || envio.status !== "ENVIADO") throw naoEncontrado("Link");
  if (envio.jogadaId) {
    const j = await db.jogada.findUniqueOrThrow({ where: { id: envio.jogadaId }, include: { premios: { include: { agendamento: true } } } });
    return { jogada: paraCliente(j), jaJogou: true };
  }
  const expiraEm = new Date(+(envio.enviadoEm ?? envio.liberadoEm) + jogo.validadeDias * DIA);
  if (expiraEm < new Date()) throw new ErroNegocio("Esse presente venceu.", 410, "vencido");
  // createMany + skipDuplicates e atomico no banco (dois cliques ao mesmo tempo nao brigam pela ficha).
  const chaveFicha = { jogoId: jogo.id, clienteId: envio.clienteId, origem: "CAMPANHA" as const, referencia: `envio:${envio.id}` };
  await db.fichaJogo.createMany({ data: [{ ...chaveFicha, expiraEm }], skipDuplicates: true });
  const ficha = await db.fichaJogo.findUniqueOrThrow({ where: { jogoId_clienteId_origem_referencia: chaveFicha } });
  // A chave do presente e fixa por envio: dois cliques simultaneos (ou uma queda no meio) caem na mesma jogada.
  const jogada = await jogar(envio.clienteId, jogo.id, `campanha:${envio.id}`, { ...o, fichaId: ficha.id });
  await db.campanhaEnvio.updateMany({ where: { id: envio.id, jogadaId: null }, data: { jogadaId: jogada.id, clicouEm: envio.clicouEm ?? new Date() } });
  return { jogada, jaJogou: false };
}
