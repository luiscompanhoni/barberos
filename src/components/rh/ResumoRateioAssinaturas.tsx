import { reais } from "@/lib/cliente-api";
import type { ConciliacaoAssinaturas } from "@/lib/rh/rateio-assinaturas";

/** Compara o recálculo do pote; não substitui os retratos de folhas fechadas. */
export function ResumoRateioAssinaturas({ dados, nomes = {} }: { dados: ConciliacaoAssinaturas; nomes?: Record<string, string> }) {
  return <section role={dados.pendente ? "alert" : undefined} className={`space-y-2 rounded-xl p-3 text-sm ${dados.pendente ? "bg-amber-50 text-amber-900" : "bg-zinc-100 text-zinc-700"}`}>
    <h2 className="font-semibold">{dados.pendente ? "Confira o rateio das assinaturas" : "Conferência do pote de assinaturas"}</h2>
    <p>{dados.metodo === "MAIORES_RESTOS_V1" ? "O pote base usa maiores restos, com desempate fixo." : "Regra de arredondamento do cadastro legado."} Este quadro mostra o recálculo atual; folhas fechadas preservam seus valores.</p>
    <dl className="grid grid-cols-1 gap-2 tabular-nums sm:grid-cols-3">
      <div><dt>Pote base previsto</dt><dd className="font-semibold">{reais(dados.poteBaseAlvoCentavos)}</dd></div>
      <div><dt>Pote base distribuído</dt><dd className="font-semibold">{reais(dados.poteBaseSomaCentavos)}</dd></div>
      <div><dt>Diferença do pote base</dt><dd className="font-semibold">{reais(dados.poteBaseResiduoCentavos)}</dd></div>
      <div><dt>Total com adicionais previsto</dt><dd>{reais(dados.totalFinalAlvoCentavos)}</dd></div>
      <div><dt>{dados.pendente ? "Valor provisório da prévia" : "Total com adicionais apurado"}</dt><dd>{reais(dados.totalFinalSomaCentavos)}</dd></div>
      <div><dt>{dados.pendente ? "Diferença para o total previsto" : "Diferença após adicionais"}</dt><dd>{reais(dados.totalFinalDiferencaCentavos)}</dd></div>
    </dl>
    {dados.naoRateadoCentavos > 0 && <p>Valor sem atendimentos elegíveis para rateio: <b>{reais(dados.naoRateadoCentavos)}</b>. Confira a produção e os créditos dos serviços.</p>}
    {dados.motivos.length > 0 && <ul className="list-inside list-disc space-y-1">{dados.motivos.map(m => <li key={m}>{m}</li>)}</ul>}
    {dados.pendente && <p>O rateio precisa de conferência antes do fechamento das comissões de assinaturas. Nenhuma diferença foi absorvida ou descontada automaticamente.</p>}
    <details>
      <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2">Critério e desempate do rateio</summary>
      <p className="mt-2">Regra: {dados.metodo}. {dados.metodo === "LEGADO" ? "Cada comissão é arredondada individualmente, sem redistribuição dos centavos." : "Empates seguem a ordem fixa dos identificadores dos profissionais."}</p>
      {dados.metodo !== "LEGADO" && dados.ordemDesempate.length > 0 && <ol className="mt-1 list-inside list-decimal break-words">{dados.ordemDesempate.map(id => <li key={id}>{nomes[id] ?? "Profissional"} <span className="text-xs">(cadastro {id})</span></li>)}</ol>}
    </details>
  </section>;
}
