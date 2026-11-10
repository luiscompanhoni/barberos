import { db } from "@/lib/db";
import { auditarMudanca } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { etiquetasDoServico, zSalvarEtiquetasServico, type EtiquetasServicoResposta } from "./etiquetas";

export async function consultarEtiquetasServico(id: string): Promise<EtiquetasServicoResposta> {
  const servico = await db.servico.findUnique({ where: { id }, select: { etiquetas: true, etiquetasVersao: true } });
  if (!servico) throw naoEncontrado("Serviço");
  return { etiquetas: etiquetasDoServico(servico.etiquetas), versao: servico.etiquetasVersao };
}

export async function salvarEtiquetasServico(id: string, usuarioId: string, entrada: unknown): Promise<EtiquetasServicoResposta> {
  const dados = zSalvarEtiquetasServico.parse(entrada);
  return db.$transaction(async tx => {
    const atual = await tx.servico.findUnique({ where: { id }, select: { nome: true, etiquetas: true, etiquetasVersao: true } });
    if (!atual) throw naoEncontrado("Serviço");
    const conflito = () => new ErroNegocio("As etiquetas foram alteradas por outra pessoa. Recarregue antes de salvar.", 409, "etiquetas_desatualizadas");
    if (atual.etiquetasVersao !== dados.versao) throw conflito();
    if (JSON.stringify(atual.etiquetas) === JSON.stringify(dados.etiquetas)) return { etiquetas: dados.etiquetas, versao: dados.versao };
    // A comparação na escrita impede que dois editores sobrescrevam a mesma versão.
    const gravado = await tx.servico.updateMany({
      where: { id, etiquetasVersao: dados.versao },
      data: { etiquetas: dados.etiquetas, etiquetasVersao: { increment: 1 } },
    });
    if (gravado.count !== 1) throw conflito();
    await auditarMudanca(tx, usuarioId, "alterar_etiquetas", "servico", id,
      { etiquetas: atual.etiquetas }, { etiquetas: dados.etiquetas }, { servico: atual.nome });
    return { etiquetas: dados.etiquetas, versao: dados.versao + 1 };
  });
}
