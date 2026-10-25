import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { apagar } from "./arquivos";
import { ATIVOS, LIMITES, validarCortes, type Edicao, type Snapshot } from "./regras";

type Tx = Prisma.TransactionClient;
const include = { clipes: { orderBy: { posicao: "asc" as const } }, versoes: { orderBy: { numero: "desc" as const } } };
export type Projeto = Prisma.EstudioProjetoGetPayload<{ include: typeof include }>;
/** Serializa reservas de espaço, revisões e leases. Nunca inclui upload ou render. */
export async function transacao<T>(fn: (tx: Tx) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(73105329)");
    return fn(tx);
  }, { maxWait: 10_000, timeout: 10_000 });
}
export async function projeto(tx: Tx, usuarioId: string, id: string) {
  const p = await tx.estudioProjeto.findFirst({ where: { id, usuarioId }, include });
  if (!p) throw naoEncontrado("Projeto");
  return p;
}
function revisao(p: Projeto, r: number) {
  if (p.revisao !== r) throw new ErroNegocio("O projeto mudou. Atualize a página antes de continuar.", 409);
}
function editavel(p: Projeto) {
  if (p.versoes.some(v => ATIVOS.some(e => e === v.estado))) throw new ErroNegocio("Aguarde ou cancele a montagem antes de editar.", 409);
}
async function incrementar(tx: Tx, p: Projeto) {
  await tx.estudioProjeto.update({ where: { id: p.id }, data: { revisao: { increment: 1 } } });
}
async function espaco(tx: Tx, usuarioId: string, extra: number) {
  for (const [where, limite] of [[{ projeto: { usuarioId } }, LIMITES.usuario], [{}, LIMITES.global]] as const) {
    const [c, v] = await Promise.all([
      tx.estudioClipe.aggregate({ where, _sum: { bytes: true } }),
      tx.estudioVersao.aggregate({ where, _sum: { bytes: true } }),
    ]);
    if ((c._sum.bytes || 0) + (v._sum.bytes || 0) + extra > limite) throw new ErroNegocio("Limite de armazenamento atingido. Exclua projetos antigos para liberar espaço.", 409);
  }
}
export function publico(p: Projeto) {
  return { id: p.id, nome: p.nome, revisao: p.revisao, atualizadoEm: p.atualizadoEm,
    clipes: p.clipes.map(({ arquivo, ...c }) => ({ ...c, pronto: !!arquivo })),
    versoes: p.versoes.map(v => ({ id: v.id, numero: v.numero, revisao: v.revisao, estado: v.estado, criadoEm: v.criadaEm, aprovadaEm: v.aprovadaEm, erro: v.erro, comentario: v.comentario, bytes: v.arquivo ? v.bytes : 0, disponivel: !!v.arquivo, sha256: v.sha256 })),
  };
}
export async function workerDisponivel(tx: Tx = db) {
  const w = await tx.estudioWorker.findUnique({ where: { id: "principal" } });
  return !!w && Date.now() - w.vistoEm.getTime() < 90_000;
}
export async function listar(usuarioId: string) {
  const [projetos, online] = await Promise.all([
    db.estudioProjeto.findMany({ where: { usuarioId }, orderBy: { atualizadoEm: "desc" }, include }),
    workerDisponivel(),
  ]);
  return { projetos: projetos.map(publico), processadorDisponivel: online, limites: LIMITES };
}
export async function criar(usuarioId: string, nome: string) {
  return transacao(async tx => {
    if (await tx.estudioProjeto.count({ where: { usuarioId } }) >= LIMITES.projetos) throw new ErroNegocio("Limite de 10 projetos atingido.", 409);
    const p = await tx.estudioProjeto.create({ data: { usuarioId, nome } });
    await auditar(tx, usuarioId, "estudio.criar", "EstudioProjeto", p.id);
    return p.id;
  });
}
export async function reservar(usuarioId: string, id: string, c: { nome: string; bytes: number; mime: string; duracao: number; revisao: number }) {
  return transacao(async tx => {
    const p = await projeto(tx, usuarioId, id); revisao(p, c.revisao); editavel(p);
    if (p.clipes.length >= LIMITES.clipes || p.clipes.reduce((s, c) => s + c.bytes, 0) + c.bytes > LIMITES.projeto) throw new ErroNegocio("Limite de 20 vídeos ou 500 MB por projeto atingido.", 409);
    await espaco(tx, usuarioId, c.bytes);
    const clipe = await tx.estudioClipe.create({ data: { projetoId: id, nome: c.nome, bytes: c.bytes, mime: c.mime, duracao: c.duracao, fim: Math.min(6, c.duracao), posicao: p.clipes.length ? Math.max(...p.clipes.map(c => c.posicao)) + 1 : 0 } });
    await incrementar(tx, p);
    await auditar(tx, usuarioId, "estudio.reservar-upload", "EstudioProjeto", id, { clipeId: clipe.id, bytes: c.bytes });
    return clipe;
  });
}
export async function iniciarUpload(usuarioId: string, id: string, clipeId: string) {
  return transacao(async tx => {
    const p = await projeto(tx, usuarioId, id); editavel(p);
    const c = p.clipes.find(c => c.id === clipeId);
    if (!c) throw naoEncontrado("Clipe");
    if (c.arquivo || (c.uploadEm && Date.now() - c.uploadEm.getTime() < 6 * 60_000)) throw new ErroNegocio("Envio já iniciado.", 409);
    const uploadEm = new Date();
    await tx.estudioClipe.update({ where: { id: c.id }, data: { uploadEm } });
    return { ...c, uploadEm };
  });
}
export async function concluirUpload(usuarioId: string, id: string, clipeId: string, uploadEm: Date, arquivo: string) {
  await transacao(async tx => {
    const p = await projeto(tx, usuarioId, id); editavel(p);
    const c = p.clipes.find(c => c.id === clipeId);
    if (!c || c.arquivo || c.uploadEm?.getTime() !== uploadEm.getTime()) throw new ErroNegocio("Envio expirou ou foi cancelado.", 409);
    await tx.estudioClipe.update({ where: { id: clipeId }, data: { arquivo, uploadEm: null } });
    await incrementar(tx, p);
    await auditar(tx, usuarioId, "estudio.receber-video", "EstudioProjeto", id, { clipeId });
  });
}
export async function editar(usuarioId: string, id: string, e: Edicao) {
  await transacao(async tx => {
    const p = await projeto(tx, usuarioId, id); revisao(p, e.revisao); editavel(p);
    if (p.clipes.length !== e.clipes.length || new Set(e.clipes.map(c => c.id)).size !== e.clipes.length || e.clipes.some(c => !p.clipes.some(x => x.id === c.id && x.arquivo))) throw new ErroNegocio("Envie todos os vídeos antes de salvar a montagem.", 409);
    if (!validarCortes(e.clipes.map(c => ({ ...c, duracao: p.clipes.find(x => x.id === c.id)!.duracao })))) throw new ErroNegocio("Confira os cortes. O vídeo final deve ter no máximo 120 segundos.");
    for (const [posicao, c] of e.clipes.entries()) await tx.estudioClipe.update({ where: { id: c.id }, data: { inicio: c.inicio, fim: c.fim, texto: c.texto, posicao } });
    await tx.estudioProjeto.update({ where: { id }, data: { nome: e.nome, revisao: { increment: 1 } } });
    await auditar(tx, usuarioId, "estudio.editar", "EstudioProjeto", id, { revisao: p.revisao + 1 });
  });
}
export async function excluirClipe(usuarioId: string, id: string, clipeId: string, r: number) {
  const arquivo = await transacao(async tx => {
    const p = await projeto(tx, usuarioId, id); revisao(p, r); editavel(p);
    const c = p.clipes.find(c => c.id === clipeId);
    if (!c) throw naoEncontrado("Clipe");
    await tx.estudioClipe.delete({ where: { id: clipeId } }); await incrementar(tx, p);
    await auditar(tx, usuarioId, "estudio.excluir-clipe", "EstudioProjeto", id, { clipeId });
    return c.arquivo;
  });
  if (arquivo) await apagar(arquivo);
}
export async function excluirProjeto(usuarioId: string, id: string, r: number) {
  const arquivos = await transacao(async tx => {
    const p = await projeto(tx, usuarioId, id); revisao(p, r); editavel(p);
    await tx.estudioProjeto.delete({ where: { id } });
    await auditar(tx, usuarioId, "estudio.excluir", "EstudioProjeto", id);
    return [...p.clipes, ...p.versoes].flatMap(c => c.arquivo ? [c.arquivo] : []);
  });
  await Promise.all(arquivos.map(apagar));
}
export async function enfileirar(usuarioId: string, id: string, r: number) {
  return transacao(async tx => {
    const p = await projeto(tx, usuarioId, id); revisao(p, r); editavel(p);
    if (!await workerDisponivel(tx)) throw new ErroNegocio("Processador de vídeos offline. Tente novamente quando estiver disponível.", 503);
    if (!p.clipes.length || p.clipes.some(c => !c.arquivo) || !validarCortes(p.clipes)) throw new ErroNegocio("Confira os vídeos e os cortes antes de gerar.");
    if (p.versoes.length >= LIMITES.versoes) throw new ErroNegocio("Limite de 10 versões por projeto atingido.");
    if (await tx.estudioVersao.count({ where: { projeto: { usuarioId }, estado: { in: [...ATIVOS] } } })) throw new ErroNegocio("Você já tem um vídeo na fila. Aguarde a conclusão.", 409);
    await espaco(tx, usuarioId, LIMITES.saida);
    const snapshot: Snapshot = { preset: "black-vertical-v1", clipes: p.clipes.map(c => ({ id: c.id, inicio: c.inicio, fim: c.fim, texto: c.texto, mime: c.mime })) };
    const v = await tx.estudioVersao.create({ data: { projetoId: id, numero: (p.versoes[0]?.numero || 0) + 1, revisao: p.revisao, snapshot, bytes: LIMITES.saida } });
    await auditar(tx, usuarioId, "estudio.enfileirar", "EstudioProjeto", id, { versaoId: v.id, revisao: p.revisao });
    return v.id;
  });
}
export async function avaliar(usuarioId: string, id: string, versaoId: string, r: number, acao: "aprovar" | "ajustes" | "cancelar", comentario?: string) {
  await transacao(async tx => {
    const p = await projeto(tx, usuarioId, id); revisao(p, r);
    const v = p.versoes[0];
    if (!v || v.id !== versaoId) throw new ErroNegocio("Selecione a versão mais recente.", 409);
    if (acao === "cancelar") {
      if (!ATIVOS.some(e => e === v.estado)) throw new ErroNegocio("A montagem já terminou. Atualize o projeto.", 409);
      await tx.estudioVersao.update({ where: { id: v.id }, data: { estado: "CANCELADO", lease: null, leaseAte: null, bytes: 0, finalizadaEm: new Date() } });
    } else {
      if (v.estado !== "REVISAO" || !v.arquivo || v.revisao !== p.revisao) throw new ErroNegocio("Esta versão não corresponde à montagem atual. Gere uma nova versão.", 409);
      if (acao === "ajustes" && !comentario?.trim()) throw new ErroNegocio("Descreva a alteração desejada.");
      await tx.estudioVersao.update({ where: { id: v.id }, data: { estado: acao === "aprovar" ? "APROVADO" : "AJUSTES", comentario, aprovadaEm: acao === "aprovar" ? new Date() : null } });
    }
    await auditar(tx, usuarioId, "estudio." + acao, "EstudioProjeto", id, { versaoId, sha256: v.sha256 });
  });
}
export async function claim(versao: string) {
  return transacao(async tx => {
    const agora = new Date();
    await tx.estudioWorker.upsert({ where: { id: "principal" }, create: { id: "principal", vistoEm: agora, versao }, update: { vistoEm: agora, versao } });
    await tx.estudioVersao.updateMany({ where: { estado: "PROCESSANDO", leaseAte: { lt: agora } }, data: { estado: "FALHOU", erro: "O processador foi interrompido. Gere outra versão para tentar novamente.", bytes: 0, lease: null, leaseAte: null, finalizadaEm: agora } });
    if (await tx.estudioVersao.count({ where: { estado: "PROCESSANDO" } })) return null;
    const v = await tx.estudioVersao.findFirst({ where: { estado: "FILA", projeto: { usuario: { ativo: true } } }, orderBy: { criadaEm: "asc" } });
    if (!v) return null;
    const lease = randomUUID();
    await tx.estudioVersao.update({ where: { id: v.id }, data: { estado: "PROCESSANDO", lease, leaseAte: new Date(Date.now() + 90_000) } });
    return { id: v.id, lease, snapshot: v.snapshot };
  });
}
export async function exigirLease(tx: Tx, id: string, lease: string) {
  const v = await tx.estudioVersao.findFirst({ where: { id, lease, estado: "PROCESSANDO", leaseAte: { gt: new Date() }, projeto: { usuario: { ativo: true } } }, include: { projeto: { select: { usuarioId: true } } } });
  if (!v) throw new ErroNegocio("Trabalho expirado ou cancelado.", 409);
  return v;
}
export async function heartbeat(id: string, lease: string) {
  await transacao(async tx => {
    await exigirLease(tx, id, lease);
    await tx.estudioVersao.update({ where: { id }, data: { leaseAte: new Date(Date.now() + 90_000) } });
    await tx.estudioWorker.update({ where: { id: "principal" }, data: { vistoEm: new Date() } });
  });
}
export async function finalizar(id: string, lease: string, resultado: { chave: string; bytes: number; hash: string } | null) {
  await transacao(async tx => {
    const v = await exigirLease(tx, id, lease);
    await tx.estudioVersao.update({ where: { id }, data: { estado: resultado ? "REVISAO" : "FALHOU", arquivo: resultado?.chave, bytes: resultado?.bytes || 0, sha256: resultado?.hash, erro: resultado ? null : "Não foi possível processar os vídeos. Confira o formato e os cortes e tente novamente.", lease: null, leaseAte: null, finalizadaEm: new Date() } });
    await auditar(tx, v.projeto.usuarioId, resultado ? "estudio.renderizar" : "estudio.falhar", "EstudioProjeto", v.projetoId, { versaoId: id, sha256: resultado?.hash || null });
  });
}
