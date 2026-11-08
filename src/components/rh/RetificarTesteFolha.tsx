"use client";

import { useEffect, useRef, useState } from "react";
import { useAcesso } from "@/components/AcessoContexto";
import { api, paraCentavos, reais } from "@/lib/cliente-api";
import { DECLARACAO_TESTE_FOLHA } from "@/lib/rh/retificacao-contrato";

type Previa = {
  revisao: string; podeRetificar: boolean; impedimentos: string[]; aviso: string; propostaPendente: boolean;
  folhaOriginal: { nome: string; competencia: string; liquidoCentavos: number; despesaId: string | null };
  substitutiva: { salario: number; comissao: number; adicionais: number; descontos: number; liquido: number };
};

/** Só o dono confirma um teste interno sem transferência; não serve para estornar pagamento real. */
export function RetificarTesteFolha({ folhaId, aoConcluir }: { folhaId: string; aoConcluir: () => Promise<void> }) {
  const dono = useAcesso().papel === "DONO";
  const [aberto, setAberto] = useState(false), [salario, setSalario] = useState(""), [motivo, setMotivo] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null), [confirmado, setConfirmado] = useState(false);
  const [msg, setMsg] = useState(""), [ocupado, setOcupado] = useState(false);
  const geracao = useRef(0), emVoo = useRef(false), chave = useRef<string | null>(null);
  useEffect(() => () => { geracao.current++; }, []);
  if (!dono) return null;

  function invalidar() { geracao.current++; chave.current = null; setPrevia(null); setConfirmado(false); setMsg(""); }
  async function consultar() {
    const valor = paraCentavos(salario);
    if (!Number.isSafeInteger(valor) || valor < 0 || valor > 100_000_000) return setMsg("Informe o valor fixo mensal correto para esta competência.");
    if (emVoo.current) return;
    const atual = ++geracao.current; emVoo.current = true; setOcupado(true); setMsg(""); setConfirmado(false); chave.current = null;
    try {
      const d = await api<Previa>(`/api/rh/folha/retificacao-teste?folhaId=${encodeURIComponent(folhaId)}&salarioSubstitutivoCentavos=${valor}`);
      if (geracao.current === atual) setPrevia(d);
    } catch (e) { if (geracao.current === atual) setMsg((e as Error).message); }
    finally { emVoo.current = false; setOcupado(false); }
  }
  async function confirmar() {
    if (emVoo.current || !previa?.podeRetificar || !confirmado || motivo.trim().length < 15) return;
    if (!confirm("Confirma que o registro de R$ 1,00 foi somente um teste interno, sem transferência real? A nova folha ficará aberta para conferência e não descontará o teste.")) return;
    const atual = ++geracao.current; emVoo.current = true; setOcupado(true); setMsg(""); chave.current ??= crypto.randomUUID();
    try {
      await api("/api/rh/folha/retificacao-teste", { method: "POST", body: {
        folhaId, revisao: previa.revisao, idempotencia: chave.current, motivo: motivo.trim(),
        salarioSubstitutivoCentavos: previa.substitutiva.salario, valorOriginalConfirmadoCentavos: 100, declaracao: DECLARACAO_TESTE_FOLHA,
      } });
      if (geracao.current === atual) await aoConcluir();
    } catch (e) { if (geracao.current === atual) setMsg(`${(e as Error).message} Confira o histórico antes de repetir. A mesma tentativa mantém sua chave de confirmação.`); }
    finally { emVoo.current = false; setOcupado(false); }
  }
  const id = `retificar-${folhaId}`;
  return <div className="space-y-2">
    <button type="button" className="btn text-xs" aria-expanded={aberto} aria-controls={id} disabled={ocupado} onClick={() => setAberto(v => !v)}>Conferir registro interno de teste</button>
    {aberto && <fieldset id={id} disabled={ocupado} aria-busy={ocupado} className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <legend className="font-semibold">Retificação de teste sem transferência</legend>
      <p>Use somente se o R$ 1,00 foi registrado para teste e nunca saiu da conta. Pagamentos reais precisam de outro procedimento. O original e sua auditoria serão preservados.</p>
      <label className="block" htmlFor={`${id}-salario`}>Valor fixo mensal correto nesta competência (R$)</label>
      <input id={`${id}-salario`} className="campo w-48" inputMode="decimal" value={salario} onChange={e => { invalidar(); setSalario(e.target.value); }} />
      <button type="button" className="btn" onClick={() => void consultar()}>Conferir prévia da retificação</button>
      {msg && <p role="alert">{msg}</p>}
      {previa && <>
        <p>{previa.folhaOriginal.nome} · {previa.folhaOriginal.competencia} · registro original: {reais(previa.folhaOriginal.liquidoCentavos)}.</p>
        <p>{previa.aviso}</p>
        <dl className="grid grid-cols-2 gap-1">
          <dt>Fixo proposto</dt><dd>{reais(previa.substitutiva.salario)}</dd><dt>Comissão da prévia atual</dt><dd>{reais(previa.substitutiva.comissao)}</dd>
          <dt>Adicionais</dt><dd>{reais(previa.substitutiva.adicionais)}</dd><dt>Vales e descontos existentes</dt><dd>{reais(previa.substitutiva.descontos)}</dd>
          <dt>Líquido da nova prévia</dt><dd>{reais(previa.substitutiva.liquido)}</dd>
        </dl>
        {previa.propostaPendente && <p role="alert">A nova prévia ainda tem valores ou vínculos pendentes de conferência. Esta retificação não aprova nem fecha a nova folha.</p>}
        {previa.impedimentos.length > 0 && <ul role="alert" className="list-inside list-disc">{previa.impedimentos.map(p => <li key={p}>{p}</li>)}</ul>}
        <label className="block" htmlFor={`${id}-motivo`}>Motivo e evidência de que foi apenas um teste</label>
        <textarea id={`${id}-motivo`} className="campo w-full" minLength={15} maxLength={500} value={motivo} onChange={e => { chave.current = null; setMotivo(e.target.value); setConfirmado(false); }} />
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} />Confirmo que não houve Pix, transferência ou saída do caixa e que conferi o valor fixo acima. Autorizo somente a retificação contábil interna do teste de R$ 1,00.</label>
        <button type="button" className="btn" disabled={!previa.podeRetificar || !confirmado || motivo.trim().length < 15} onClick={() => void confirmar()}>Retificar teste e preparar nova prévia</button>
      </>}
    </fieldset>}
  </div>;
}
