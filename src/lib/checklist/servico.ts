/**
 * Checklist da equipe: tarefas por funcao (diarista, barbeiro, gerente), lista do dia por pessoa,
 * envio pelo WhatsApp de manha (com link para marcar sem login) e resumo das pendencias a noite.
 */
import { randomBytes } from "node:crypto";
import { Prisma, type FuncaoChecklist } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, minutosLocal, parseData } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { urlPainel } from "@/lib/dominios";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { notificarCliente } from "@/lib/whatsapp/conversas";
import { previaDeFaixas, resumoPontos, totaisDePontos, travarPontoDoItem } from "./pontos";
import { hhmmParaMinutos, tarefasDoDia, textoLista, textoResumo } from "./regras";

const PADRAO: { titulo: string; funcao: FuncaoChecklist; diasSemana?: number[]; horario?: string }[] = [
  { funcao: "DIARISTA", titulo: "Varrer e passar pano no salão", horario: "08:00" },
  { funcao: "DIARISTA", titulo: "Limpar banheiro e repor papel e sabonete", horario: "08:30" },
  { funcao: "DIARISTA", titulo: "Limpar espelhos, bancadas e cadeiras", horario: "09:00" },
  { funcao: "DIARISTA", titulo: "Lavar toalhas e capas", diasSemana: [1, 3, 5] },
  { funcao: "DIARISTA", titulo: "Limpar geladeira e balcão do bar", diasSemana: [5] },
  { funcao: "DIARISTA", titulo: "Tirar o lixo" },
  { funcao: "BARBEIRO", titulo: "Organizar e limpar a bancada ao chegar" },
  { funcao: "BARBEIRO", titulo: "Higienizar e esterilizar máquinas, pentes e tesouras" },
  { funcao: "BARBEIRO", titulo: "Conferir lâminas, pomadas e produtos da bancada" },
  { funcao: "BARBEIRO", titulo: "Varrer o cabelo e limpar a cadeira após cada cliente" },
  { funcao: "BARBEIRO", titulo: "Deixar a bancada limpa e as máquinas carregando ao sair" },
  { funcao: "GERENTE", titulo: "Abrir o caixa com o fundo de troco", horario: "08:30" },
  { funcao: "GERENTE", titulo: "Conferir a agenda do dia e confirmar os clientes", horario: "09:00" },
  { funcao: "GERENTE", titulo: "Responder as conversas pendentes do WhatsApp" },
  { funcao: "GERENTE", titulo: "Conferir o estoque do bar e anotar a reposição" },
  { funcao: "GERENTE", titulo: "Conciliar os recebimentos do dia anterior (Financeiro)" },
  { funcao: "GERENTE", titulo: "Fechar o caixa e explicar qualquer diferença", horario: "20:00" },
];

export const novoToken = () => randomBytes(12).toString("base64url");
const linkPessoa = (token: string) => `${urlPainel()}/t/${token}`;
const diaSemana = (data: string) => {
  const { ano, mes, dia } = parseData(data);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
};
const dataDb = (data: string) => new Date(`${data}T00:00:00Z`);

export async function configChecklist() {
  const cfg = await db.checklistConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  if (!(await db.checklistTarefa.count())) {
    await db.checklistTarefa.createMany({ data: PADRAO.map((t, ordem) => ({ ...t, diasSemana: t.diasSemana ?? [], ordem })) });
  }
  return cfg;
}

/** Cria os itens do dia para as pessoas ativas (sem duplicar; tarefa nova entra no mesmo dia). */
export async function gerarItens(data: string, pessoaIds?: string[]) {
  const [pessoas, tarefas] = await Promise.all([
    db.checklistPessoa.findMany({ where: { ativo: true, ...(pessoaIds ? { id: { in: pessoaIds } } : {}) } }),
    db.checklistTarefa.findMany({ where: { ativo: true } }),
  ]);
  const ds = diaSemana(data);
  const linhas = pessoas.flatMap((p) =>
    tarefasDoDia(tarefas, p.funcao, ds).map((t, ordem) => ({ pessoaId: p.id, tarefaId: t.id, data: dataDb(data), titulo: t.titulo, horario: t.horario, ordem, pontos: t.pontos })),
  );
  if (linhas.length) await db.checklistItem.createMany({ data: linhas, skipDuplicates: true });
}

/** Painel: itens do dia agrupados por pessoa. */
export async function painelDoDia(data: string) {
  await configChecklist();
  await gerarItens(data);
  const pessoas = await db.checklistPessoa.findMany({
    where: { OR: [{ ativo: true }, { itens: { some: { data: dataDb(data) } } }] },
    orderBy: [{ funcao: "asc" }, { nome: "asc" }],
    include: { itens: { where: { data: dataDb(data) }, orderBy: [{ horario: "asc" }, { ordem: "asc" }], include: { _count: { select: { fotos: true } } } } },
  });
  const totais = await totaisDePontos(pessoas.map((p) => p.id));
  return pessoas.map((p) => ({
    id: p.id, nome: p.nome, funcao: p.funcao, telefone: p.telefone, link: linkPessoa(p.token), pontos: totais.get(p.id) ?? 0,
    itens: p.itens.map((i) => ({
      id: i.id, titulo: i.titulo, horario: i.horario, feito: i.feito, feitoEm: i.feitoEm, feitoPor: i.feitoPor,
      pontos: i.pontos, avaliacao: i.avaliacao, avaliadoPor: i.avaliadoPor, motivoRe: i.motivoRe,
      fotos: i._count.fotos,
    })),
  }));
}

/**
 * Marca/desmarca. Tarefa validada so o painel desmarca (e perde a validacao). Marcar de novo
 * depois de uma re volta para "aguardando validacao" e a re fica no extrato.
 */
async function marcar(itemId: string, feito: boolean, por: string, pessoaId?: string) {
  const item = await db.checklistItem.findFirst({ where: { id: itemId, ...(pessoaId ? { pessoaId } : {}) } });
  if (!item) throw naoEncontrado("Tarefa");
  if (item.avaliacao === "VALIDADO" && !feito && pessoaId) throw new ErroNegocio("Essa tarefa já foi validada pelo gerente.", 409, "validada");
  await db.$transaction(async (tx) => {
    if (item.avaliacao === "VALIDADO" && !feito) {
      await travarPontoDoItem(tx, itemId);
      await tx.checklistPonto.deleteMany({ where: { itemId } });
    }
    if (item.avaliacao === "RE" && feito) await tx.checklistPonto.updateMany({ where: { itemId }, data: { itemId: null } });
    const limpa = (item.avaliacao === "VALIDADO" && !feito) || (item.avaliacao === "RE" && feito);
    await tx.checklistItem.update({
      where: { id: itemId },
      data: { feito, feitoEm: feito ? new Date() : null, feitoPor: feito ? por : null, ...(limpa ? { avaliacao: null, avaliadoEm: null, avaliadoPor: null, motivoRe: null } : {}) },
    });
  });
}

export const marcarNoPainel = (s: Sessao, itemId: string, feito: boolean) => marcar(itemId, feito, s.nome);

// ---------------- link publico da pessoa (sem login)

export async function listaPublica(token: string) {
  const p = await db.checklistPessoa.findUnique({ where: { token } });
  if (!p || !p.ativo) return null;
  const cfg = await configuracao();
  const hoje = dataLocal(Date.now(), cfg.fuso);
  await gerarItens(hoje, [p.id]);
  const itens = await db.checklistItem.findMany({ where: { pessoaId: p.id, data: dataDb(hoje) }, orderBy: [{ horario: "asc" }, { ordem: "asc" }], include: { _count: { select: { fotos: true } } } });
  return {
    nome: p.nome, funcao: p.funcao, data: hoje, barbearia: cfg.nomeBarbearia, pontos: await resumoPontos(p.id),
    itens: itens.map((i) => ({ id: i.id, titulo: i.titulo, horario: i.horario, feito: i.feito, pontos: i.pontos, avaliacao: i.avaliacao, motivoRe: i.motivoRe, fotos: i._count.fotos })),
  };
}

export async function marcarPublico(token: string, itemId: string, feito: boolean) {
  const p = await db.checklistPessoa.findUnique({ where: { token } });
  if (!p || !p.ativo) throw naoEncontrado("Link");
  await marcar(itemId, feito, "link", p.id);
}

// ---------------- cadastro (painel)

export type PessoaEntrada = { id?: string; nome: string; telefone: string; funcao: FuncaoChecklist; ativo: boolean };
export type TarefaEntrada = { id?: string; titulo: string; funcao: FuncaoChecklist; diasSemana: number[]; horario: string | null; ativo: boolean; pontos?: number };
export type ConfigEntrada = { ativo: boolean; horaEnvio: string; horaResumo: string; pontosRe?: number; nivelPlatina?: number; nivelLegend?: number };

export async function cadastro() {
  const cfg = await configChecklist();
  const [pessoas, tarefas] = await Promise.all([
    db.checklistPessoa.findMany({ orderBy: [{ funcao: "asc" }, { nome: "asc" }] }),
    db.checklistTarefa.findMany({ orderBy: [{ funcao: "asc" }, { ordem: "asc" }] }),
  ]);
  return {
    config: { ativo: cfg.ativo, horaEnvio: cfg.horaEnvio, horaResumo: cfg.horaResumo, pontosRe: cfg.pontosRe, nivelPlatina: cfg.nivelPlatina, nivelLegend: cfg.nivelLegend },
    pessoas: pessoas.map((p) => ({ id: p.id, nome: p.nome, telefone: p.telefone, funcao: p.funcao, ativo: p.ativo, link: linkPessoa(p.token) })),
    tarefas: tarefas.map((t) => ({ id: t.id, titulo: t.titulo, funcao: t.funcao, diasSemana: t.diasSemana, horario: t.horario, ativo: t.ativo, pontos: t.pontos })),
  };
}

export async function salvarCadastro(s: Sessao, d: { config: ConfigEntrada; pessoas: PessoaEntrada[]; tarefas: TarefaEntrada[]; confirmarFaixas?: boolean }) {
  if (hhmmParaMinutos(d.config.horaResumo) <= hhmmParaMinutos(d.config.horaEnvio)) throw new ErroNegocio("O resumo precisa ser depois do envio das listas.");
  // As faixas valem para o bônus: só o dono muda (de quem não é dono, os valores enviados são ignorados).
  const config = s.papel === "DONO" ? d.config : { ...d.config, nivelPlatina: undefined, nivelLegend: undefined };
  const atual = await configChecklist();
  const antes = { nivelPlatina: atual.nivelPlatina, nivelLegend: atual.nivelLegend };
  const faixas = { nivelPlatina: config.nivelPlatina ?? antes.nivelPlatina, nivelLegend: config.nivelLegend ?? antes.nivelLegend };
  if (faixas.nivelLegend <= faixas.nivelPlatina) throw new ErroNegocio("O BLACK LEGEND precisa de mais pontos que o BLACK PLATINA.");
  const mudaFaixas = faixas.nivelPlatina !== antes.nivelPlatina || faixas.nivelLegend !== antes.nivelLegend;
  // Antes de salvar, o dono vê quem sobe ou desce (hoje e no bônus ainda não aprovado do mês anterior).
  if (mudaFaixas) {
    const mudancas = await previaDeFaixas(antes, faixas);
    if (mudancas.length && !d.confirmarFaixas) {
      throw new ErroNegocio(`${mudancas.length} pessoa(s) mudam de faixa com esses pontos. Confira antes de salvar.`, 409, "confirmar_faixas", { mudancas });
    }
  }
  await db.$transaction(async (tx) => {
    await tx.checklistConfig.upsert({ where: { id: 1 }, create: { id: 1, ...config }, update: config });
    const idsP = d.pessoas.map((p) => p.id).filter((x): x is string => !!x);
    await tx.checklistPessoa.updateMany({ where: { id: { notIn: idsP } }, data: { ativo: false } });
    for (const p of d.pessoas) {
      const dados = { nome: p.nome, telefone: p.telefone, funcao: p.funcao, ativo: p.ativo };
      if (p.id) await tx.checklistPessoa.update({ where: { id: p.id }, data: dados });
      else await tx.checklistPessoa.create({ data: { ...dados, token: novoToken() } });
    }
    const idsT = d.tarefas.map((t) => t.id).filter((x): x is string => !!x);
    await tx.checklistTarefa.updateMany({ where: { id: { notIn: idsT } }, data: { ativo: false } });
    for (const [ordem, t] of d.tarefas.entries()) {
      const dados = { titulo: t.titulo, funcao: t.funcao, diasSemana: [...new Set(t.diasSemana)].sort(), horario: t.horario || null, ativo: t.ativo, ordem, ...(t.pontos !== undefined ? { pontos: t.pontos } : {}) };
      if (t.id) {
        await tx.checklistTarefa.update({ where: { id: t.id }, data: dados });
        // Itens de hoje ainda nao avaliados acompanham os pontos novos.
        if (t.pontos !== undefined) await tx.checklistItem.updateMany({ where: { tarefaId: t.id, avaliacao: null, data: { gte: dataDb(dataLocal(Date.now())) } }, data: { pontos: t.pontos } });
      }
      else await tx.checklistTarefa.create({ data: dados });
    }
    // Itens de hoje que ainda nao foram feitos acompanham a mudanca (tarefa desativada sai da lista).
    await tx.checklistItem.deleteMany({ where: { feito: false, data: { gte: dataDb(dataLocal(Date.now())) }, OR: [{ tarefa: { ativo: false } }, { pessoa: { ativo: false } }] } });
    await auditar(tx, s.usuarioId, "checklist_configurar", "configuracao", "checklist", { pessoas: d.pessoas.length, tarefas: d.tarefas.length, ativo: config.ativo, ...(mudaFaixas ? { faixas: { antes, depois: faixas } } : {}) });
  });
  return cadastro();
}

/** Gera um link novo (o antigo para de funcionar). */
export async function novoLink(s: Sessao, pessoaId: string) {
  await db.checklistPessoa.update({ where: { id: pessoaId }, data: { token: novoToken() } });
  await auditar(db, s.usuarioId, "checklist_novo_link", "checklist", pessoaId, {});
}

// ---------------- WhatsApp

async function reservar(chave: string, forcar: boolean) {
  if (forcar) {
    await db.checklistEnvio.deleteMany({ where: { chave } });
  }
  try {
    return (await db.checklistEnvio.create({ data: { chave } })).id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

async function mandar(envioId: string, telefone: string, texto: string) {
  try {
    const r = await notificarCliente(telefone, texto);
    // Equipe nao conversa com o bot: a conversa fica com atendimento humano.
    await db.conversa.updateMany({ where: { telefone }, data: { estado: "HUMANO" } });
    if (r && !r.ok) await db.checklistEnvio.update({ where: { id: envioId }, data: { ok: false, erro: r.erro?.slice(0, 300) ?? "falhou" } });
    return !!r?.ok;
  } catch (e) {
    await db.checklistEnvio.update({ where: { id: envioId }, data: { ok: false, erro: (e as Error).message.slice(0, 300) } });
    return false;
  }
}

/** Manda a lista do dia de uma pessoa (uma vez por dia; `forcar` reenvia). */
export async function enviarLista(pessoaId: string, data: string, forcar = false) {
  const p = await db.checklistPessoa.findUnique({ where: { id: pessoaId } });
  if (!p || !p.ativo) return false;
  await gerarItens(data, [p.id]);
  const itens = await db.checklistItem.findMany({ where: { pessoaId: p.id, data: dataDb(data), feito: false }, orderBy: [{ horario: "asc" }, { ordem: "asc" }] });
  if (!itens.length) return false;
  const id = await reservar(`lista:${p.id}:${data}`, forcar);
  if (!id) return false;
  return mandar(id, p.telefone, textoLista({ nome: p.nome, data, diaSemana: diaSemana(data), itens, link: linkPessoa(p.token) }));
}

/** Resumo das pendencias para quem e GERENTE no checklist (ou para o dono, se nao tiver gerente). */
export async function enviarResumo(data: string, forcar = false) {
  const itens = await db.checklistItem.findMany({ where: { data: dataDb(data) }, include: { pessoa: { select: { nome: true } } }, orderBy: [{ horario: "asc" }, { ordem: "asc" }] });
  const texto = textoResumo({
    data, feitas: itens.filter((i) => i.feito).length, total: itens.length,
    pendentes: itens.filter((i) => !i.feito).map((i) => ({ nome: i.pessoa.nome, titulo: i.titulo })), link: `${urlPainel()}/checklist`,
  });
  if (!texto) return 0;
  const gerentes = await db.checklistPessoa.findMany({ where: { ativo: true, funcao: "GERENTE" }, select: { telefone: true } });
  const telefones = gerentes.length ? gerentes.map((g) => g.telefone) : (await db.usuario.findMany({ where: { papel: "DONO", ativo: true }, select: { telefone: true } })).map((u) => u.telefone);
  let n = 0;
  for (const tel of [...new Set(telefones)]) {
    const id = await reservar(`resumo:${data}:${tel}`, forcar);
    if (id && (await mandar(id, tel, texto))) n++;
  }
  return n;
}

/** Rotina (a cada 5 min): lista de manha a partir de `horaEnvio`, resumo a partir de `horaResumo`. */
export async function rodarChecklist(agora = Date.now()) {
  const cfg = await db.checklistConfig.findUnique({ where: { id: 1 } });
  if (!cfg?.ativo) return { listas: 0, resumos: 0 };
  const fuso = (await configuracao()).fuso;
  const hoje = dataLocal(agora, fuso);
  const min = minutosLocal(agora, fuso);
  let listas = 0, resumos = 0;
  if (min >= hhmmParaMinutos(cfg.horaEnvio) && min < hhmmParaMinutos(cfg.horaResumo)) {
    const pessoas = await db.checklistPessoa.findMany({ where: { ativo: true }, select: { id: true } });
    for (const p of pessoas) if (await enviarLista(p.id, hoje)) listas++;
  }
  if (min >= hhmmParaMinutos(cfg.horaResumo)) resumos = await enviarResumo(hoje);
  return { listas, resumos };
}
