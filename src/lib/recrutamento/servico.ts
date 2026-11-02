import { hashesCandidatura } from "./hash-candidatura";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { VERSAO_FORMULARIO, zCandidatura, zEtapa, zVaga } from "./regras";
import { exigirGestaoRecrutamento } from "./formularios";
import { conferirFormulario } from "./vinculo-formulario";
import { validarRespostas, zDefinicao } from "./formularios-regras";
export const camposPublicosVaga = { id: true, titulo: true, cidade: true, descricao: true, privacidade: true } as const;
export async function criarVaga(usuarioId: string, dados: z.infer<typeof zVaga>) {
  return db.$transaction(async (tx) => {
    await exigirGestaoRecrutamento(tx, usuarioId);
    await conferirFormulario(tx, dados.formularioId);
    const v = await tx.vagaRecrutamento.create({ data: { ...dados, criadoPorId: usuarioId } });
    await auditar(tx, usuarioId, "recrutamento.vaga.criada", "VagaRecrutamento", v.id, { ativa: v.ativa }); return v;
  });
}
export async function receberCandidatura(vagaId: string, b: z.infer<typeof zCandidatura>) {
  const { conteudoHash, legadoHash } = hashesCandidatura(vagaId, b);
  const repetida = async () => {
    const c = await db.candidaturaRecrutamento.findUnique({ where: { envioId: b.envioId }, select: { conteudoHash: true } });
    if (!c) return false;
    if (c.conteudoHash !== conteudoHash && c.conteudoHash !== legadoHash) throw new ErroNegocio("Este envio já foi utilizado. Reabra o formulário para uma nova candidatura.", 409);
    return true;
  };
  if (await repetida()) return;
  try {
    await db.$transaction(async (tx) => {
      const vaga = await tx.vagaRecrutamento.findFirst({ where: { id: vagaId, ativa: true }, include: { formulario: true } });
      if (!vaga) throw naoEncontrado("Vaga aberta");
      const formulario = vaga.formulario;
      if ((vaga.formularioId ?? undefined) !== b.formularioId) throw new ErroNegocio("O formulário mudou. Reabra a página antes de enviar.", 409);
      if (formulario && formulario.estado !== "APROVADO") throw new ErroNegocio("Formulário indisponível.", 409);
      const definicao = formulario ? zDefinicao.parse(formulario.definicao) : null;
      const respostas = definicao ? validarRespostas(definicao, b.respostas ?? {}) : undefined;
      if (!definicao && (b.respostas || !b.servicos.length)) throw new ErroNegocio("Revise os serviços do formulário original.");
      // Mesmo WhatsApp na mesma vaga: avisa em vez de duplicar (e sem descartar em silencio quem quer corrigir).
      const ja = await tx.candidaturaRecrutamento.findFirst({ where: { vagaId, candidato: { telefone: b.telefone! } }, select: { id: true } });
      if (ja) throw new ErroNegocio("Já recebemos uma candidatura deste WhatsApp para esta vaga. Para corrigir algum dado, fale com a barbearia.", 409, "candidatura_repetida");
      const candidato = await tx.candidatoRecrutamento.create({ data: { nome: b.nome, telefone: b.telefone!, cidade: b.cidade } });
      const c = await tx.candidaturaRecrutamento.create({ data: {
        envioId: b.envioId, conteudoHash, vagaId, candidatoId: candidato.id, experienciaMeses: b.experienciaMeses, servicos: b.servicos,
        disponibilidade: b.disponibilidade, portfolio: b.portfolio, instagram: b.instagram, futurasOportunidades: b.futurasOportunidades,
        vagaSnapshot: { titulo: vaga.titulo, cidade: vaga.cidade, descricao: vaga.descricao, funcao: formulario?.funcao ?? "BARBEIRO", formularioTitulo: formulario?.titulo ?? "Modelo original", formularioId: formulario?.id ?? null },
        formularioVersao: formulario?.id ?? VERSAO_FORMULARIO, formularioSnapshot: definicao ?? undefined, respostas, avisoPrivacidade: vaga.privacidade, origem: b.origem,
      } });
      await auditar(tx, null, "recrutamento.candidatura.recebida", "CandidaturaRecrutamento", c.id, { vagaId, formularioVersao: formulario?.id ?? VERSAO_FORMULARIO });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && await repetida()) return;
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") throw new ErroNegocio("Tente enviar novamente em alguns instantes.", 409);
    throw e;
  }
}
export async function mudarEtapa(id: string, usuarioId: string, b: z.infer<typeof zEtapa>) {
  return db.$transaction(async (tx) => {
    await exigirGestaoRecrutamento(tx, usuarioId);
    const c = await tx.candidaturaRecrutamento.findUnique({ where: { id } });
    if (!c) throw naoEncontrado("Candidatura");
    if (b.etapa === "BANCO" && !c.futurasOportunidades) throw new ErroNegocio("A pessoa não autorizou futuras oportunidades.");
    const r = await tx.candidaturaRecrutamento.updateMany({ where: { id, versao: b.versao }, data: { etapa: b.etapa, versao: { increment: 1 } } });
    if (!r.count) throw new ErroNegocio("Outra pessoa atualizou esta candidatura. Atualize a lista.", 409);
    await tx.historicoRecrutamento.create({ data: { candidaturaId: id, usuarioId, etapa: b.etapa, motivo: b.motivo } });
    await auditar(tx, usuarioId, "recrutamento.etapa.alterada", "CandidaturaRecrutamento", id, { antes: c.etapa, depois: b.etapa });
  });
}

/** Apaga a candidatura (pedido da pessoa ou decisao da gestao) e o candidato, se nao tiver outra candidatura. */
export async function excluirCandidatura(id: string, usuarioId: string | null) {
  await db.$transaction(async (tx) => {
    if (usuarioId) await exigirGestaoRecrutamento(tx, usuarioId);
    const c = await tx.candidaturaRecrutamento.findUnique({ where: { id }, select: { candidatoId: true, vagaId: true } });
    if (!c) throw naoEncontrado("Candidatura");
    await tx.candidaturaRecrutamento.delete({ where: { id } });
    if (!(await tx.candidaturaRecrutamento.count({ where: { candidatoId: c.candidatoId } }))) await tx.candidatoRecrutamento.delete({ where: { id: c.candidatoId } });
    // Sem dado pessoal na auditoria: so que a candidatura saiu.
    await auditar(tx, usuarioId, "recrutamento.candidatura.excluida", "CandidaturaRecrutamento", id, { vagaId: c.vagaId, pelo: usuarioId ? "gestao" : "retencao" });
  });
}

/** Retencao (LGPD): sem autorizacao para futuras oportunidades e sem contratacao, a candidatura sai em 12 meses. */
export const RETENCAO_CANDIDATURA_DIAS = 365;
export async function apagarCandidaturasVencidas(agora = Date.now()) {
  const limite = new Date(agora - RETENCAO_CANDIDATURA_DIAS * 86_400_000);
  const vencidas = await db.candidaturaRecrutamento.findMany({
    where: { futurasOportunidades: false, etapa: { not: "CONTRATADO" }, criadoEm: { lt: limite } },
    select: { id: true }, take: 200,
  });
  for (const v of vencidas) await excluirCandidatura(v.id, null);
  return vencidas.length;
}
