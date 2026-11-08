import { randomUUID } from "node:crypto";
import { Prisma, type EntrevistaRecrutamento } from "@prisma/client";
import type { z } from "zod";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { hashTokenEntrevista, tokenEntrevista } from "./entrevistas-token";
import { janelasEntrevista, sobrepoe, zAcaoEntrevista, zConviteEntrevista, type AcaoEntrevista } from "./entrevistas-regras";
import { ocupacoesProfissionalDono, travarProfissionalDono } from "./entrevistas-agenda";
type Tx = Prisma.TransactionClient;
export type Entrevista = EntrevistaRecrutamento;
const invalidar = () => new ErroNegocio("Convite indisponível. Peça um novo link à Black.", 404);
export async function donoEntrevista(tx: Tx, id: string) {
  if (!await tx.usuario.findFirst({ where: { id, ativo: true, papel: "DONO" }, select: { id: true } })) throw proibido();
}
export async function travarAgenda(tx: Tx, donoId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'entrevistas:'} || ${donoId}, 0))`;
  await travarProfissionalDono(tx, donoId);
}
export async function travarCandidaturaEntrevista(tx: Tx, candidaturaId: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'entrevistas-candidatura:'} || ${candidaturaId}, 0))`; }
export async function criarConviteEntrevista(usuarioId: string, candidaturaId: string, entrada: z.infer<typeof zConviteEntrevista>, agora = Date.now()) {
  const b = zConviteEntrevista.parse(entrada);
  return db.$transaction(async tx => {
    await donoEntrevista(tx, usuarioId); await travarAgenda(tx, usuarioId); await travarCandidaturaEntrevista(tx, candidaturaId);
    const repetido = await tx.entrevistaRecrutamento.findUnique({ where: { chave: b.chave } });
    if (repetido) {
      if (repetido.donoId !== usuarioId || repetido.candidaturaId !== candidaturaId || repetido.duracaoMin !== b.duracaoMin || repetido.local !== b.local) throw new ErroNegocio("Chave de convite já utilizada.", 409);
      return repetido;
    }
    const c = await tx.candidaturaRecrutamento.findUnique({ where: { id: candidaturaId } }); if (!c) throw naoEncontrado("Candidatura");
    if (["ENCERRADO", "CONTRATADO"].includes(c.etapa)) throw new ErroNegocio("Esta candidatura não está em seleção.", 409);
    const ativo = await tx.entrevistaRecrutamento.findFirst({ where: { candidaturaId, OR: [{ estado: { in: ["CONVIDADO", "AGUARDA_CONFIRMACAO"] }, expiraEm: { gt: new Date(agora) } }, { estado: "CONFIRMADA", fim: { gt: new Date(agora) } }] } });
    if (ativo) throw new ErroNegocio("Já há um convite ou entrevista ativa. Consulte o registro existente.", 409);
    const atualizado = await tx.candidaturaRecrutamento.updateMany({ where: { id: candidaturaId, versao: b.versao }, data: { versao: { increment: 1 } } });
    if (!atualizado.count) throw new ErroNegocio("Candidatura alterada. Recarregue antes de convidar.", 409);
    const id = randomUUID(); const tokenHash = hashTokenEntrevista(tokenEntrevista({ id, geracao: 0 }));
    const e = await tx.entrevistaRecrutamento.create({ data: { id, chave: b.chave, candidaturaId, donoId: usuarioId, tokenHash, local: b.local, duracaoMin: b.duracaoMin, expiraEm: new Date(agora + 7 * 86400_000) } });
    await auditar(tx, usuarioId, "recrutamento.entrevista.convidada", "EntrevistaRecrutamento", e.id, { candidaturaId }); return e;
  });
}
export async function horariosEntrevista(tx: Tx, e: Entrevista, agora: number) {
  await donoEntrevista(tx, e.donoId);
  const ocupadas = await tx.entrevistaRecrutamento.findMany({ where: { donoId: e.donoId, estado: "CONFIRMADA", fim: { gt: new Date(agora) } }, select: { inicio: true, fim: true } });
  const janelas = janelasEntrevista(e.duracaoMin, agora);
  const profissionais = janelas.length ? await ocupacoesProfissionalDono(tx, e.donoId, janelas[0].inicio, janelas.at(-1)!.fim) : [];
  return janelas.filter(j => !ocupadas.some(o => o.inicio && o.fim && sobrepoe(j, { inicio: o.inicio, fim: o.fim })) && !profissionais.some(o => sobrepoe(j, o)));
}
export async function porTokenEntrevista(tx: Tx, token: string, agora: number) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidar();
  const e = await tx.entrevistaRecrutamento.findUnique({ where: { tokenHash: hashTokenEntrevista(token) } });
  if (!e || e.expiraEm.getTime() <= agora || e.tokenHash !== hashTokenEntrevista(tokenEntrevista(e))) throw invalidar();
  return e;
}
export async function agirEntrevista(tx: Tx, original: Entrevista, entrada: AcaoEntrevista, origem: "PORTAL" | "WHATSAPP", agora: number | undefined) {
  const b = zAcaoEntrevista.parse(entrada);
  await travarAgenda(tx, original.donoId);
  await travarCandidaturaEntrevista(tx, original.candidaturaId);
  agora ??= Date.now();
  let e = await tx.entrevistaRecrutamento.findUniqueOrThrow({ where: { id: original.id } });
  if (e.tokenHash !== original.tokenHash || e.expiraEm.getTime() <= agora) throw invalidar();
  if (b.acao === "CONSULTAR") return apresentarEntrevista(tx, e, agora);
  if (b.acao === "CONFIRMAR" && e.estado === "CONFIRMADA") return apresentarEntrevista(tx, e, agora);
  if (b.acao === "CANCELAR" && e.estado === "CANCELADA") return apresentarEntrevista(tx, e, agora);
  if (b.versao !== e.versao) throw new ErroNegocio("A escolha mudou. Consulte a entrevista antes de confirmar.", 409);
  if (e.estado === "CANCELADA") throw new ErroNegocio("Este convite foi cancelado.", 409);
  const c = await tx.candidaturaRecrutamento.findUniqueOrThrow({ where: { id: e.candidaturaId } });
  if (b.acao !== "CANCELAR" && ["ENCERRADO", "CONTRATADO"].includes(c.etapa)) throw new ErroNegocio("Seleção encerrada. Entre em contato com a Black.", 409);
  const dados: Prisma.EntrevistaRecrutamentoUpdateManyMutationInput = { versao: { increment: 1 } };
  if (b.acao === "ESCOLHER") {
    if (e.estado === "CONFIRMADA") throw new ErroNegocio("Cancele a entrevista antes de pedir nova data à Black.", 409);
    const j = (await horariosEntrevista(tx, e, agora)).find(j => j.inicio.toISOString() === b.inicio);
    if (!j) throw new ErroNegocio("Este horário não está mais disponível. Escolha outro.", 409);
    Object.assign(dados, { estado: "AGUARDA_CONFIRMACAO", propostaInicio: j.inicio, propostaExpiraEm: new Date(agora + 10 * 60_000) });
  } else if (b.acao === "CONFIRMAR") {
    if (e.estado !== "AGUARDA_CONFIRMACAO" || !e.propostaInicio || !e.propostaExpiraEm || +e.propostaExpiraEm <= agora) throw new ErroNegocio("Escolha novamente um horário e confirme os dados.", 409);
    const j = (await horariosEntrevista(tx, e, agora)).find(j => +j.inicio === +e.propostaInicio!);
    if (!j) throw new ErroNegocio("O horário foi ocupado na agenda do dono. Consulte novas opções.", 409);
    Object.assign(dados, { estado: "CONFIRMADA", inicio: j.inicio, fim: j.fim, confirmadoEm: new Date(agora), expiraEm: new Date(+j.fim + 86400_000) });
    const r = await tx.candidaturaRecrutamento.updateMany({ where: { id: c.id, versao: c.versao }, data: { etapa: "ENTREVISTA", versao: { increment: 1 } } });
    if (!r.count) throw new ErroNegocio("Seleção alterada. Consulte novamente a entrevista.", 409);
    await tx.historicoRecrutamento.create({ data: { candidaturaId: c.id, etapa: "ENTREVISTA", usuarioId: "CANDIDATO", motivo: `Entrevista presencial confirmada pelo candidato via ${origem}.` } });
  } else {
    if (e.inicio && +e.inicio <= agora) throw new ErroNegocio("Entrevista já iniciada. Contate a Black para registrar a ocorrência.", 409);
    Object.assign(dados, { estado: "CANCELADA", canceladoEm: new Date(agora), conversaId: null });
  }
  const atualizado = await tx.entrevistaRecrutamento.updateMany({ where: { id: e.id, versao: e.versao, tokenHash: e.tokenHash }, data: dados });
  if (!atualizado.count) throw new ErroNegocio("Entrevista alterada. Consulte novamente.", 409);
  await auditar(tx, null, `recrutamento.entrevista.${b.acao.toLowerCase()}`, "EntrevistaRecrutamento", e.id, { origem });
  e = await tx.entrevistaRecrutamento.findUniqueOrThrow({ where: { id: e.id } }); return apresentarEntrevista(tx, e, agora);
}
export async function apresentarEntrevista(tx: Tx, e: Entrevista, agora: number) {
  const c = await tx.candidaturaRecrutamento.findUniqueOrThrow({ where: { id: e.candidaturaId }, select: { etapa: true } });
  const selecaoEncerrada = ["ENCERRADO", "CONTRATADO"].includes(c.etapa);
  const slots = !selecaoEncerrada && ["CONVIDADO", "AGUARDA_CONFIRMACAO"].includes(e.estado) ? await horariosEntrevista(tx, e, agora) : [];
  const propostaValida = e.estado === "AGUARDA_CONFIRMACAO" && e.propostaInicio && e.propostaExpiraEm && +e.propostaExpiraEm > agora && slots.some(s => +s.inicio === +e.propostaInicio!);
  return { id: e.id, selecaoEncerrada, podeCancelar: e.estado !== "CANCELADA" && (!e.inicio || +e.inicio > agora), estado: e.estado === "AGUARDA_CONFIRMACAO" && !propostaValida ? "CONVIDADO" : e.estado, versao: e.versao, local: e.local, duracaoMin: e.duracaoMin, fuso: "America/Sao_Paulo", inicio: e.inicio?.toISOString() ?? null, propostaInicio: propostaValida ? e.propostaInicio!.toISOString() : null, propostaExpiraEm: propostaValida ? e.propostaExpiraEm!.toISOString() : null, horarios: slots.map(s => s.inicio.toISOString()) };
}
export async function candidatoEntrevista(token: string, entrada: AcaoEntrevista, agora?: number) {
  return db.$transaction(async tx => agirEntrevista(tx, await porTokenEntrevista(tx, token, agora ?? Date.now()), entrada, "PORTAL", agora), { timeout: 10_000 });
}
