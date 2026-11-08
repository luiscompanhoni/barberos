"use client";
import { useState } from "react";
import { useAcesso } from "@/components/AcessoContexto";
import { api, reais } from "@/lib/cliente-api";

export type ConciliacaoDespesasDados = {
  coincidenciasDistintas: number;
  possiveisDuplicatas: { movimentoId: string; descricao: string; data: string; valorCentavos: number; despesas: { id: string; descricao: string; pagoEm: string | null; forma: string | null }[] }[];
  vinculos: { id: string; movimentoId: string; despesaId: string; descricao: string; valorCentavos: number; valido: boolean }[];
};
export type ConferenciaDados = { fonte: "CELCASH" | "STONE"; hashDados: string; conferida: boolean; ultima: { id: string; criadoEm: string } | null };

export function ConciliacaoDespesas({ mes, dados, conferencias, aoMudar, aoOcupar }: { mes: string; dados: ConciliacaoDespesasDados; conferencias: ConferenciaDados[]; aoMudar: () => void; aoOcupar: (ocupado: boolean) => void }) {
  const dono = useAcesso().papel === "DONO";
  const [ocupado, setOcupado] = useState(false), [erro, setErro] = useState("");
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const data = (v: string) => new Date(v).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  async function executar(body: unknown) {
    setOcupado(true); aoOcupar(true); setErro("");
    try { await api("/api/financeiro/conciliacao-despesas", { method: "POST", body }); aoMudar(); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); aoOcupar(false); }
  }
  function justificar(body: object, pergunta: string) {
    const motivo = window.prompt(pergunta);
    if (motivo && motivo.trim().length >= 5) void executar({ ...body, motivo: motivo.trim() });
    else if (motivo !== null) setErro("Escreva uma justificativa com pelo menos 5 caracteres.");
  }
  return <section className="cartao space-y-4">
    <div><h2 className="font-semibold">Conciliação de despesas e cobertura dos extratos</h2><p className="mt-1 text-xs text-zinc-600">Valores iguais são apenas sugestões. O dono precisa conferir o comprovante antes de vincular; nenhum pagamento será criado.</p></div>
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    <div className="flex flex-wrap gap-3">{conferencias.map(c => <div key={c.fonte} className="rounded-lg border border-zinc-200 p-3 text-sm">
      <p>{c.fonte === "CELCASH" ? "Celcash" : "Stone"}: <b>{c.conferida ? "mês conferido" : c.ultima ? "revisão necessária" : "cobertura pendente"}</b></p>
      {dono && !c.conferida && <button className="btn mt-2" disabled={ocupado} onClick={() => justificar({ acao: "CONFERIR", mes, fonte: c.fonte, hashDados: c.hashDados, mesCompleto: true }, `Você conferiu o extrato completo de ${mes}, do primeiro ao último dia, incluindo dias sem movimentação? Informe a origem do comprovante e a justificativa da cobertura:`)}>Confirmar mês completo</button>}
    </div>)}</div>
    {!!dados.possiveisDuplicatas.length && <div><h3 className="text-sm font-semibold">Possíveis despesas repetidas ({dados.possiveisDuplicatas.length})</h3><ul className="divide-y divide-zinc-200">{dados.possiveisDuplicatas.map(m => <li key={m.movimentoId} className="space-y-2 py-3 text-sm">
      <p className="break-words">{data(m.data)} · {m.descricao} · <b>{reais(m.valorCentavos)}</b></p>
      <label className="block text-xs text-zinc-600" htmlFor={`despesa-${m.movimentoId}`}>Despesa local para conferir</label>
      <select id={`despesa-${m.movimentoId}`} className="campo" disabled={!dono || ocupado} value={escolhas[m.movimentoId] ?? ""} onChange={e => setEscolhas(x => ({ ...x, [m.movimentoId]: e.target.value }))}>
        <option value="">Escolha após conferir o comprovante</option>{m.despesas.map(d => <option key={d.id} value={d.id}>{d.descricao} · {d.pagoEm ? data(d.pagoEm) : "sem data"} · {d.forma ?? "sem forma"}</option>)}
      </select>
      {dono && <div className="flex flex-wrap gap-2"><button className="btn" disabled={ocupado || !escolhas[m.movimentoId]} onClick={() => justificar({ acao: "VINCULAR", movimentoId: m.movimentoId, despesaId: escolhas[m.movimentoId] }, "Qual comprovante demonstra que este movimento e a despesa representam o mesmo pagamento?")}>Vincular o mesmo pagamento</button><button className="btn" disabled={ocupado || !escolhas[m.movimentoId]} onClick={() => justificar({ acao: "DISTINTOS", movimentoId: m.movimentoId, despesaId: escolhas[m.movimentoId] }, "Que evidência confirma que são dois pagamentos diferentes, apesar do mesmo valor? Os dois custos serão preservados.")}>São pagamentos diferentes</button></div>}
    </li>)}</ul></div>}
    {!!dados.vinculos.length && <details><summary className="cursor-pointer text-sm font-semibold">Vínculos registrados ({dados.vinculos.length})</summary><ul className="mt-2 space-y-2">{dados.vinculos.map(v => <li key={v.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-0 flex-1 break-words">{v.descricao} · {reais(v.valorCentavos)} · {v.valido ? "conferido" : "divergência: revisar"}</span>{dono && <button className="btn text-xs" disabled={ocupado} onClick={() => justificar({ acao: "ANULAR", vinculoId: v.id }, "Por que este vínculo deve ser anulado? O histórico será preservado e os dois registros voltarão à revisão.")}>Anular vínculo</button>}</li>)}</ul></details>}
    {!dados.possiveisDuplicatas.length && <p className="text-xs text-zinc-600">Nenhuma coincidência pendente de valor entre despesas pagas e saídas deste mês. Isso não comprova, por si só, a completude dos extratos.</p>}
    {!!dados.coincidenciasDistintas && <p className="text-xs text-zinc-600">{dados.coincidenciasDistintas} coincidência(s) confirmada(s) pelo dono como pagamentos diferentes. Os custos foram preservados.</p>}
  </section>;
}
