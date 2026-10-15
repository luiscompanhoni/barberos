/**
 * Extrato da Stone no BarberOS: o dono baixa o CSV no site da Stone e sobe aqui (a Stone nao tem API aberta para isso).
 * Cada linha entra uma vez (id pela data com milissegundos, valor e saldos); a tarifa da linha vira uma TAXA a parte.
 * As regras por nome (ex.: CELESC -> energia, YGOR GABRIEL -> retirada) classificam as saidas.
 */
import type { Prisma } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import type { TipoExterno } from "./regras";
import { centavosStone, classificarStone, idStone, instanteStone, lerCsvStone, padraoDoNome, regraPara, type Regra } from "./stone-regras";

export const regrasAtuais = async (): Promise<Regra[]> =>
  (await db.regraConciliacao.findMany({ select: { padrao: true, tipo: true, categoria: true } })) as Regra[];

/** Sobe o CSV da Stone. Devolve quantas linhas novas entraram e o periodo do arquivo. */
export async function importarStone(s: Sessao, texto: string) {
  let linhas;
  try { linhas = lerCsvStone(texto); } catch (e) { throw new ErroNegocio((e as Error).message, 422, "arquivo"); }
  if (!linhas.length) throw new ErroNegocio("O arquivo está vazio.", 422, "arquivo");
  const [contas, regras] = await Promise.all([configuracao().then((c) => c.contasProprias), regrasAtuais()]);
  const dados: Prisma.MovimentoExternoCreateManyInput[] = [];
  for (const o of linhas) {
    const c = classificarStone(o, contas);
    const r = c.tipo === "PAGAMENTO" ? regraPara(c.contraparte, regras) : null;
    const id = idStone(o);
    const data = instanteStone(o);
    if (Number.isNaN(+data)) continue;
    dados.push({
      fonte: "STONE", idExterno: id, data, valorCentavos: centavosStone(o["Valor"]), tipo: r?.tipo ?? c.tipo, forma: c.forma,
      categoria: r?.categoria ?? null, descricao: `${o["Tipo"]}${o["Descrição"] ? ` · ${o["Descrição"]}` : ""}`.slice(0, 200),
      observacao: c.contraparte?.slice(0, 200) ?? null, bruto: o as Prisma.InputJsonValue,
    });
    // Tarifa cobrada na propria linha (ex.: Pix da maquininha): uma taxa separada.
    const tarifa = centavosStone(o["Tarifa"]);
    if (tarifa > 0) dados.push({ fonte: "STONE", idExterno: `${id}:tarifa`, data, valorCentavos: -tarifa, tipo: "TAXA", forma: c.forma, descricao: `Tarifa · ${o["Tipo"]}`, observacao: null });
  }
  const r = await db.movimentoExterno.createMany({ data: dados, skipDuplicates: true });
  const datas = dados.map((d) => +new Date(d.data as Date)).sort((a, b) => a - b);
  await db.$transaction((tx) => auditar(tx, s.usuarioId, "conciliacao_importar_stone", "configuracao", "stone", { linhas: linhas.length, novos: r.count }));
  return { linhas: linhas.length, novos: r.count, de: new Date(datas[0]), ate: new Date(datas.at(-1)!) };
}

/** Aplica as regras de novo nas saidas ainda nao classificadas a mao (Celcash e Stone). */
export async function reaplicarRegras() {
  const regras = await regrasAtuais();
  const ms = await db.movimentoExterno.findMany({ where: { classificadoPorId: null, tipo: { in: ["PAGAMENTO"] } }, select: { id: true, tipo: true, categoria: true, observacao: true } });
  let n = 0;
  for (const m of ms) {
    const r = regraPara(m.observacao, regras);
    if (r && (r.tipo !== m.tipo || r.categoria !== m.categoria)) { await db.movimentoExterno.update({ where: { id: m.id }, data: { tipo: r.tipo, categoria: r.categoria } }); n++; }
  }
  return n;
}

export async function listarRegras() {
  return db.regraConciliacao.findMany({ orderBy: { padrao: "asc" } });
}

/** Cria/atualiza a regra de um nome e reaplica. */
export async function salvarRegra(s: Sessao, d: { padrao: string; tipo: TipoExterno; categoria: string | null }) {
  const padrao = padraoDoNome(d.padrao);
  if (padrao.length < 3) throw new ErroNegocio("Use pelo menos 3 letras do nome.");
  await db.$transaction(async (tx) => {
    await tx.regraConciliacao.upsert({ where: { padrao }, create: { padrao, tipo: d.tipo, categoria: d.categoria, criadoPorId: s.usuarioId }, update: { tipo: d.tipo, categoria: d.categoria } });
    await auditar(tx, s.usuarioId, "conciliacao_regra", "configuracao", padrao, { tipo: d.tipo, categoria: d.categoria });
  });
  return reaplicarRegras();
}

export async function excluirRegra(s: Sessao, id: string) {
  await db.$transaction(async (tx) => {
    const r = await tx.regraConciliacao.delete({ where: { id } });
    await auditar(tx, s.usuarioId, "conciliacao_regra_excluir", "configuracao", r.padrao, { tipo: r.tipo, categoria: r.categoria });
  });
}
