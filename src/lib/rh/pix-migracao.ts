import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { decifrarChavePix, exigirProtecaoPix, protegerChavePix } from "./pix-protegido";
import { analisarChavePix } from "./pix-regras";

/** Chamado somente pelo script offline. Não é executado por migração SQL/startup/request. */
export async function migrarPixLegado() {
  exigirProtecaoPix(); // Sem segredo válido não consulta nem modifica dados.
  const ids = await db.checklistPessoa.findMany({ where: { chavePix: { not: null } }, select: { id: true } });
  let migradas = 0, preservadas = 0;
  for (const { id } of ids) {
    try {
      const mudou = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM checklist_pessoas WHERE id = ${id} FOR UPDATE`;
        const atual = await tx.checklistPessoa.findUnique({ where: { id } });
        if (!atual?.chavePix) return false;
        if (atual.chavePixCifrada) throw new ErroNegocio("Cadastro Pix conflitante; preserve o original para revisão.", 409, "pix_invalido");
        const protegido = protegerChavePix(id, atual.chavePix);
        if (!protegido.chavePixCifrada || decifrarChavePix(id, protegido.chavePixCifrada) !== analisarChavePix(atual.chavePix).normalizada) {
          throw new ErroNegocio("A restauração da chave Pix não foi validada.", 409, "pix_integridade");
        }
        await tx.checklistPessoa.update({ where: { id }, data: protegido });
        await auditar(tx, null, "rh_pix_proteger_legado", "checklist_pessoa", id, { versao: 1, restauracaoValidada: true });
        return true;
      });
      if (mudou) migradas++;
    } catch (e) {
      if (!(e instanceof ErroNegocio) || e.codigo !== "pix_invalido") throw e;
      preservadas++; // Inválida não é apagada nem exportada em relatório/log.
    }
  }
  return { migradas, preservadas, envioAutorizado: false };
}
