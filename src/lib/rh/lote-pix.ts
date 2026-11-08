import { Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { exigirPermissao } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, proibido } from "@/lib/erros";
import { planejarLotePix, zCompetenciaPix } from "./lote-pix-regras";

type Tx = Prisma.TransactionClient;

async function contexto(tx: Tx, competencia: string) {
  const folhas = await tx.folhaPagamento.findMany({
    where: { competencia }, orderBy: { id: "asc" },
    include: { pessoa: { select: { nome: true, chavePix: true, chavePixCifrada: true, chavePixMascarada: true, chavePixTipo: true, chavePixHash: true, ativo: true, revisaoPix: true } } },
  });
  return planejarLotePix(competencia, folhas);
}

async function vista(tx: Tx, competencia: string, podeConferir: boolean) {
  const plano = await contexto(tx, competencia);
  const lote = await tx.folhaLotePix.findUnique({ where: { competencia_revisao: { competencia, revisao: plano.revisao } } });
  return {
    ...plano, donoPodeConferir: podeConferir,
    // Hash da chave serve à deduplicação/snapshot no servidor, não à conferência na tela.
    itens: plano.itens.map(i => ({ folhaId: i.folhaId, pessoaId: i.pessoaId, nome: i.nome, valorCentavos: i.valorCentavos, tipoChave: i.tipoChave, chaveMascarada: i.chaveMascarada, problemas: i.problemas, destinatario: i.destinatario })),
    lote: lote ? { id: lote.id, criadoEm: lote.criadoEm, conferidoEm: lote.conferidoEm } : null,
  };
}

export async function previaLotePix(s: Sessao, competencia: string) {
  await exigirPermissao(s, "folha");
  zCompetenciaPix.parse(competencia);
  return db.$transaction(tx => vista(tx, competencia, s.papel === "DONO"), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/** Só prepara/confere dados locais. Este módulo não tem integração bancária nem quita a folha. */
export async function prepararLotePix(s: Sessao, d: { competencia: string; revisao: string; acao: "preparar" | "conferir" }) {
  await exigirPermissao(s, "folha");
  zCompetenciaPix.parse(d.competencia);
  try {
    return await db.$transaction(async tx => {
      // Serializa pedidos iguais antes de ler a revisão, sem executar nenhum efeito financeiro.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`folha-pix:${d.competencia}`}))`;
      const u = await tx.usuario.findUnique({ where: { id: s.usuarioId }, select: { ativo: true, papel: true } });
      if (!u?.ativo || (d.acao === "conferir" && u.papel !== "DONO")) throw proibido();
      const plano = await contexto(tx, d.competencia);
      if (plano.revisao !== d.revisao) throw new ErroNegocio("A folha ou o cadastro Pix mudou. Atualize a prévia antes de continuar.", 409, "lote_mudou");
      if (!plano.itens.length) throw new ErroNegocio("Não há folhas fechadas com valor positivo para preparar.", 409, "lote_vazio");
      const where = { competencia_revisao: { competencia: d.competencia, revisao: plano.revisao } };
      let lote = await tx.folhaLotePix.findUnique({ where });
      if (!lote) {
        if (d.acao === "conferir") throw new ErroNegocio("Prepare e revise o lote antes de conferir.", 409, "lote_nao_preparado");
        lote = await tx.folhaLotePix.create({ data: {
          competencia: d.competencia, revisao: plano.revisao, totalCentavos: plano.totalCentavos,
          snapshot: plano as unknown as Prisma.InputJsonValue, criadoPorId: s.usuarioId,
        } });
        await auditar(tx, s.usuarioId, "rh_pix_preparar", "folha_lote_pix", lote.id, { competencia: d.competencia, revisao: plano.revisao, totalCentavos: plano.totalCentavos, pessoas: plano.itens.length });
      }
      if (d.acao === "conferir" && !lote.conferidoEm) {
        if (!plano.podeConferir) throw new ErroNegocio("Corrija as pendências de cadastro antes de conferir a preparação.", 409, "pix_pendencias");
        await tx.folhaLotePix.update({ where: { id: lote.id }, data: { conferidoPorId: s.usuarioId, conferidoEm: new Date() } });
        await auditar(tx, s.usuarioId, "rh_pix_conferir_preparacao", "folha_lote_pix", lote.id, { revisao: plano.revisao, totalCentavos: plano.totalCentavos, autorizaEnvio: false });
      }
      return vista(tx, d.competencia, u.papel === "DONO");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(e.code)) throw new ErroNegocio("Houve outra alteração durante a preparação. Atualize a prévia e confira novamente.", 409, "lote_concorrente");
    throw e;
  }
}
