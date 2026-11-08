/**
 * Importação do CSV baixado pelo dono no extrato da Stone, preservando a evidência original.
 * Cada linha entra uma vez (id pela data com milissegundos, valor e saldos); a tarifa da linha vira uma TAXA a parte.
 * As regras por nome (ex.: CELESC -> energia, YGOR GABRIEL -> retirada) classificam as saidas.
 */
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { configuracao } from "@/lib/agenda/carregar";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import type { TipoExterno } from "./regras";
import { centavosStone, classificarStone, idStone, instanteStone, lerCsvStone, padraoDoNome, regraPara, type LinhaStone, type Regra } from "./stone-regras";

export const regrasAtuais = async (): Promise<Regra[]> =>
  (await db.regraConciliacao.findMany({ select: { padrao: true, tipo: true, categoria: true } })) as Regra[];

/** Sobe o CSV da Stone. Devolve quantas linhas novas entraram e o periodo do arquivo. */
export async function importarStone(s: Sessao, texto: string) {
  let linhas;
  try { linhas = lerCsvStone(texto); } catch (e) { throw new ErroNegocio((e as Error).message, 422, "arquivo"); }
  if (!linhas.length) throw new ErroNegocio("O arquivo está vazio.", 422, "arquivo");
  const [contas, regras] = await Promise.all([configuracao().then((c) => c.contasProprias), regrasAtuais()]);
  const dados: Prisma.MovimentoExternoCreateManyInput[] = [];
  for (const [indice, o] of linhas.entries()) {
    try {
    if (!["Crédito", "Débito"].includes(o["Movimentação"])) throw new Error("Movimentação deve ser Crédito ou Débito.");
    const c = classificarStone(o, contas);
    const r = c.tipo === "PAGAMENTO" ? regraPara(c.contraparte, regras) : null;
    const id = idStone(o);
    const data = instanteStone(o);
    dados.push({
      fonte: "STONE", idExterno: id, identidadeCanonica: id, data, valorCentavos: centavosStone(o["Valor"]), tipo: r?.tipo ?? c.tipo, forma: c.forma,
      categoria: r?.categoria ?? null, descricao: `${o["Tipo"]}${o["Descrição"] ? ` · ${o["Descrição"]}` : ""}`.slice(0, 200),
      observacao: c.contraparte?.slice(0, 200) ?? null, bruto: o as Prisma.InputJsonValue,
    });
    // Tarifa cobrada na propria linha (ex.: Pix da maquininha): uma taxa separada.
    const tarifa = o["Tarifa"]?.trim() ? centavosStone(o["Tarifa"]) : 0;
    if (tarifa < 0) throw new Error("Tarifa não pode ser negativa.");
    if (tarifa > 0) dados.push({ fonte: "STONE", idExterno: `${id}:tarifa`, identidadeCanonica: `${id}:tarifa`, data, valorCentavos: -tarifa, tipo: "TAXA", forma: c.forma, descricao: `Tarifa · ${o["Tipo"]}`, observacao: null });
    } catch (e) { throw new ErroNegocio(`Linha ${indice + 2}: ${(e as Error).message} Nenhuma linha foi importada.`, 422, "linha_stone_invalida"); }
  }
  const datas = dados.map((d) => +new Date(d.data as Date)).sort((a, b) => a - b);
  const de = new Date(datas[0]), ate = new Date(datas.at(-1)!);
  const hash = createHash("sha256").update(texto).digest("hex");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('conciliacao:importacao:stone'))`;
    const chaves = dados.map(d => d.identidadeCanonica!);
    const anteriores = await tx.movimentoExterno.findMany({ where: { fonte: "STONE", OR: [{ data: { gte: de, lte: ate } }, { identidadeCanonica: { in: chaves } }] }, select: { id: true, idExterno: true, identidadeCanonica: true, bruto: true, valorCentavos: true, data: true } });
    const porIdentidade = new Map<string, typeof anteriores[number]>();
    const porIdExterno = new Map(anteriores.map(a => [a.idExterno, a]));
    const registrar = (identidade: string, a: typeof anteriores[number]) => {
      if (porIdentidade.has(identidade) && porIdentidade.get(identidade)!.id !== a.id) throw new ErroNegocio("Há possíveis duplicatas no extrato já registrado. Confira os movimentos antes de importar novamente; nenhum dado foi alterado.", 409, "stone_duplicata_legada");
      porIdentidade.set(identidade, a);
    };
    for (const a of anteriores) {
      let identidade = a.identidadeCanonica;
      if (!identidade && a.bruto && typeof a.bruto === "object" && !Array.isArray(a.bruto)) {
        try { identidade = idStone(a.bruto as LinhaStone); } catch { /* O original inválido fica preservado para revisão. */ }
      }
      if (!identidade) continue;
      registrar(identidade, a);
      const tarifa = porIdExterno.get(`${a.idExterno}:tarifa`);
      if (tarifa) registrar(`${identidade}:tarifa`, tarifa);
    }
    const novos: Prisma.MovimentoExternoCreateManyInput[] = [];
    const vistos = new Map<string, string>(); let repetidos = 0;
    for (const d of dados) {
      const chave = d.identidadeCanonica!;
      const assinatura = JSON.stringify([d.valorCentavos, new Date(d.data as Date).toISOString()]);
      if (vistos.has(chave)) {
        if (vistos.get(chave) !== assinatura) throw new ErroNegocio("O arquivo repete uma referência com valor ou data diferentes. Nenhuma linha foi importada.", 422, "stone_referencia_divergente");
        repetidos++; continue;
      }
      vistos.set(chave, assinatura);
      const anterior = porIdentidade.get(chave);
      if (anterior) {
        if (anterior.valorCentavos !== d.valorCentavos || +anterior.data !== +new Date(d.data as Date)) throw new ErroNegocio("Uma referência do extrato mudou de valor ou data. Confira a origem; nenhuma linha foi importada.", 409, "stone_referencia_divergente");
        if (!anterior.identidadeCanonica) await tx.movimentoExterno.update({ where: { id: anterior.id }, data: { identidadeCanonica: chave } });
        repetidos++;
      } else novos.push(d);
    }
    const r = novos.length ? await tx.movimentoExterno.createMany({ data: novos }) : { count: 0 };
    await auditar(tx, s.usuarioId, "conciliacao_importar_stone", "configuracao", "stone", { arquivoSha256: hash, linhas: linhas.length, movimentos: dados.length, novos: r.count, repetidos, de: de.toISOString(), ate: ate.toISOString() });
    return { linhas: linhas.length, novos: r.count, repetidos, de, ate, arquivoSha256: hash };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Aplica as regras de novo nas saidas ainda nao classificadas a mao (Celcash e Stone). */
export async function reaplicarRegras() {
  const regras = await regrasAtuais();
  const ms = await db.movimentoExterno.findMany({ where: { classificadoPorId: null, tipo: { in: ["PAGAMENTO"] }, vinculosDespesa: { none: { anuladoEm: null } } }, select: { id: true, tipo: true, categoria: true, observacao: true } });
  let n = 0;
  for (const m of ms) {
    const r = regraPara(m.observacao, regras);
    if (r && (r.tipo !== m.tipo || r.categoria !== m.categoria)) {
      n += await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM movimentos_externos WHERE id = ${m.id} FOR UPDATE`;
        const atual = await tx.movimentoExterno.findUnique({ where: { id: m.id }, include: { vinculosDespesa: { where: { anuladoEm: null }, select: { id: true } } } });
        if (!atual || atual.classificadoPorId || atual.tipo !== "PAGAMENTO" || atual.vinculosDespesa.length) return 0;
        await tx.movimentoExterno.update({ where: { id: m.id }, data: { tipo: r.tipo, categoria: r.categoria } });
        await auditar(tx, null, "conciliacao_regra_reaplicada", "movimento_externo", m.id, { antes: { tipo: atual.tipo, categoria: atual.categoria }, depois: { tipo: r.tipo, categoria: r.categoria } });
        return 1;
      });
    }
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
