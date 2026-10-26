import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { VERSAO_FORMULARIO, zCandidatura, zEtapa, zVaga } from "./regras";
export const camposPublicosVaga = { id: true, titulo: true, cidade: true, descricao: true, privacidade: true } as const;
export async function criarVaga(usuarioId: string, dados: z.infer<typeof zVaga>) {
  return db.$transaction(async (tx) => {
    const v = await tx.vagaRecrutamento.create({ data: { ...dados, criadoPorId: usuarioId } });
    await auditar(tx, usuarioId, "recrutamento.vaga.criada", "VagaRecrutamento", v.id, { ativa: v.ativa }); return v;
  });
}
export async function receberCandidatura(vagaId: string, b: z.infer<typeof zCandidatura>) {
  const conteudoHash = createHash("sha256").update(JSON.stringify({ vagaId, ...b })).digest("hex");
  const repetida = async () => {
    const c = await db.candidaturaRecrutamento.findUnique({ where: { envioId: b.envioId }, select: { conteudoHash: true } });
    if (!c) return false;
    if (c.conteudoHash !== conteudoHash) throw new ErroNegocio("Este envio já foi utilizado. Reabra o formulário para uma nova candidatura.", 409);
    return true;
  };
  if (await repetida()) return;
  try {
    await db.$transaction(async (tx) => {
      const vaga = await tx.vagaRecrutamento.findFirst({ where: { id: vagaId, ativa: true } });
      if (!vaga) throw naoEncontrado("Vaga aberta");
      // Mesmo WhatsApp na mesma vaga: fica a primeira candidatura (evita duplicata e enxurrada).
      const ja = await tx.candidaturaRecrutamento.findFirst({ where: { vagaId, candidato: { telefone: b.telefone! } }, select: { id: true } });
      if (ja) return;
      const candidato = await tx.candidatoRecrutamento.create({ data: { nome: b.nome, telefone: b.telefone!, cidade: b.cidade } });
      const c = await tx.candidaturaRecrutamento.create({ data: {
        envioId: b.envioId, conteudoHash, vagaId, candidatoId: candidato.id, experienciaMeses: b.experienciaMeses, servicos: b.servicos,
        disponibilidade: b.disponibilidade, portfolio: b.portfolio, instagram: b.instagram, futurasOportunidades: b.futurasOportunidades,
        formularioVersao: VERSAO_FORMULARIO, avisoPrivacidade: vaga.privacidade, origem: b.origem,
      } });
      await auditar(tx, null, "recrutamento.candidatura.recebida", "CandidaturaRecrutamento", c.id, { vagaId, formularioVersao: VERSAO_FORMULARIO });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && await repetida()) return;
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") throw new ErroNegocio("Tente enviar novamente em alguns instantes.", 409);
    throw e;
  }
}
export async function mudarEtapa(id: string, usuarioId: string, b: z.infer<typeof zEtapa>) {
  return db.$transaction(async (tx) => {
    const c = await tx.candidaturaRecrutamento.findUnique({ where: { id } });
    if (!c) throw naoEncontrado("Candidatura");
    if (b.etapa === "BANCO" && !c.futurasOportunidades) throw new ErroNegocio("A pessoa não autorizou futuras oportunidades.");
    const r = await tx.candidaturaRecrutamento.updateMany({ where: { id, versao: b.versao }, data: { etapa: b.etapa, versao: { increment: 1 } } });
    if (!r.count) throw new ErroNegocio("Outra pessoa atualizou esta candidatura. Atualize a lista.", 409);
    await tx.historicoRecrutamento.create({ data: { candidaturaId: id, usuarioId, etapa: b.etapa, motivo: b.motivo } });
    await auditar(tx, usuarioId, "recrutamento.etapa.alterada", "CandidaturaRecrutamento", id, { antes: c.etapa, depois: b.etapa });
  });
}
