import { z } from "zod";
import { zId } from "@/lib/validacao";
import { DECLARACAO_TESTE_FOLHA } from "./retificacao-contrato";

export { DECLARACAO_TESTE_FOLHA };
export const zSalarioSubstitutivo = z.number().int().min(0).max(100_000_000);
export const zRetificacaoTeste = z.object({
  folhaId: zId, revisao: z.string().regex(/^[a-f0-9]{64}$/), idempotencia: z.uuid().transform(v => v.toLowerCase()),
  motivo: z.string().trim().min(15).max(500), salarioSubstitutivoCentavos: zSalarioSubstitutivo,
  valorOriginalConfirmadoCentavos: z.literal(100), declaracao: z.literal(DECLARACAO_TESTE_FOLHA),
}).strict();
export type RetificacaoTesteEntrada = z.infer<typeof zRetificacaoTeste>;
type FolhaTeste = { ativa: boolean; versao: number; status: string; salarioCentavos: number; comissaoCentavos: number; adicionaisCentavos: number; descontosCentavos: number; liquidoCentavos: number; despesaId: string | null; pagoEm: Date | null };
type DespesaTeste = { id: string; status: string; categoria: string; valorCentavos: number; formaPagamento: string | null; movimentoCaixaId: string | null; recorrente: boolean; pagoEm: Date | null };
export type LoteTeste = { estado: string; enviadoEm: Date | null; referenciaBancaria: string | null; snapshot: unknown };

/** A ausência de modelo de envio não é tratada como prova de que um lote desconhecido seja local. */
export function loteImpedeRetificacao(l: LoteTeste) {
  if (!["PREPARADO", "CONFERIDO", "INVALIDADO"].includes(l.estado) || l.enviadoEm !== null || l.referenciaBancaria !== null) return true;
  const raiz = l.snapshot;
  if (!raiz || typeof raiz !== "object" || Array.isArray(raiz) || !("envioHabilitado" in raiz) || raiz.envioHabilitado !== false || !("itens" in raiz) || !Array.isArray(raiz.itens)) return true;
  const fila: unknown[] = [raiz]; let vistos = 0;
  while (fila.length) {
    if (++vistos > 10000) return true;
    const v = fila.pop();
    if (!v || typeof v !== "object") continue;
    for (const [chave, valor] of Object.entries(v)) {
      if (/^(enviadoEm|pagoEm|referenciaBancaria|endToEndId|e2eId|transferenciaId|transacaoId|comprovante)$/i.test(chave) && valor != null && valor !== "") return true;
      if (/^(status|estado|resultado)$/i.test(chave) && typeof valor === "string" && /^(ENVIADO|PAGO|PAGA|INCERTO|PROCESSANDO|SUCESSO|SUCCESS|SETTLED)$/i.test(valor)) return true;
      if (valor && typeof valor === "object") fila.push(valor);
    }
  }
  return false;
}

export function impedimentosTeste(f: FolhaTeste, d: DespesaTeste | null, auditoriaManual: boolean, vinculosBancarios: number, lotes: LoteTeste[]) {
  const problemas: string[] = [];
  if (!f.ativa || f.versao !== 1 || f.status !== "PAGA" || !f.pagoEm || f.salarioCentavos !== 100 || f.comissaoCentavos !== 0 || f.adicionaisCentavos !== 0 || f.descontosCentavos !== 0 || f.liquidoCentavos !== 100) problemas.push("A ferramenta é exclusiva do registro interno original de teste de R$ 1,00, sem comissão, adicional ou desconto.");
  if (!d || f.despesaId !== d.id || d.status !== "PAGA" || !d.pagoEm || d.categoria !== "FOLHA" || d.valorCentavos !== 100 || d.formaPagamento !== "PIX" || d.movimentoCaixaId !== null || d.recorrente) problemas.push("A despesa original deve ser da folha, de R$ 1,00, registrada como Pix manual, sem caixa ou recorrência.");
  if (!auditoriaManual) problemas.push("Não há auditoria compatível do registro manual original. Confira a origem antes de retificar.");
  if (vinculosBancarios) problemas.push("A despesa participou de conciliação bancária. Este fluxo não pode afirmar que não houve transferência.");
  if (lotes.some(loteImpedeRetificacao)) problemas.push("Há lote da competência enviado, pago, incerto ou sem prova de preparação exclusivamente local.");
  return problemas;
}
