import { z } from "zod";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { GESTAO } from "@/lib/auth/sessao";
import { ErroNegocio } from "@/lib/erros";

export const lancamentoPessoalSchema = z.object({
  tipo: z.enum(["RECEITA", "DESPESA"]),
  descricao: z.string().trim().min(2).max(150),
  categoria: z.string().trim().min(2).max(60),
  valorCentavos: z.number().int().min(1).max(100_000_000),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
    const d = new Date(s + "T00:00:00Z");
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
  }),
  realizado: z.boolean(),
});

export async function criarLancamentoPessoal(usuarioId: string, entrada: z.infer<typeof lancamentoPessoalSchema>,
  entradaWhatsApp?: { id: string; telefone: string }) {
  const b = lancamentoPessoalSchema.parse(entrada);
  const data = { ...b, usuarioId, data: new Date(b.data + "T00:00:00Z") };
  if (!entradaWhatsApp) return db.lancamentoPessoal.create({ data });
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lancamento-pessoal:${usuarioId}:${entradaWhatsApp.id}`}, 0))`;
    // Mantém o vínculo de identidade válido até o lançamento ser gravado.
    await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${usuarioId} FOR SHARE`;
    const autorizado = await tx.usuario.findFirst({ where: {
      id: usuarioId, telefone: entradaWhatsApp.telefone, ativo: true, telefoneVerificadoEm: { not: null },
      papel: { in: [...GESTAO, "BARBEIRO"] },
    }, select: { id: true } });
    if (!autorizado) throw new ErroNegocio("O acesso ao financeiro pessoal pelo WhatsApp precisa ser verificado.", 403, "proibido");
    const auditado = await tx.auditoria.findFirst({ where: {
      usuarioId, acao: "despesa_pessoal_whatsapp", entidade: "lancamento_pessoal", dados: { path: ["entrada"], equals: entradaWhatsApp.id },
    }, select: { entidadeId: true } });
    if (auditado) return tx.lancamentoPessoal.findFirstOrThrow({ where: { id: auditado.entidadeId, usuarioId } });
    const item = await tx.lancamentoPessoal.create({ data });
    await auditar(tx, usuarioId, "despesa_pessoal_whatsapp", "lancamento_pessoal", item.id, { entrada: entradaWhatsApp.id });
    return item;
  });
}
