"use client";

import { useEffect, useRef, useState } from "react";
import { api, reais } from "@/lib/cliente-api";

type Previa = {
  competencia: string; revisao: string; totalCentavos: number; excluidas: number; podeConferir: boolean;
  donoPodeConferir: boolean; envioHabilitado: false; bloqueioEnvio: string;
  lote: { id: string; criadoEm: string; conferidoEm: string | null } | null;
  itens: { folhaId: string; nome: string; valorCentavos: number; tipoChave: string | null; chaveMascarada: string; problemas: string[] }[];
};

export function LotePixFolha({ competencia, atualizacao }: { competencia: string; atualizacao: object }) {
  const [estado, setEstado] = useState<{ origem: object; dados: Previa } | null>(null);
  const [mensagem, setMensagem] = useState<{ origem: object; texto: string } | null>(null);
  const [operacao, setOperacao] = useState<object | null>(null);
  const geracaoAtual = useRef<{ ativa: boolean } | null>(null);
  // A troca de competência ou da folha oculta a prévia anterior já neste render.
  const d = estado?.origem === atualizacao && estado.dados.competencia === competencia ? estado.dados : null;
  const msg = mensagem?.origem === atualizacao ? mensagem.texto : "";
  const ocupado = operacao === atualizacao;
  useEffect(() => {
    const geracao = { ativa: true };
    geracaoAtual.current = geracao;
    api<Previa>(`/api/rh/folha/lote-pix?competencia=${competencia}`).then(r => {
      if (geracao.ativa) { setEstado({ origem: atualizacao, dados: r }); setMensagem(null); }
    }).catch((e: Error) => { if (geracao.ativa) { setEstado(null); setMensagem({ origem: atualizacao, texto: e.message }); } });
    return () => { geracao.ativa = false; };
  }, [competencia, atualizacao]);

  async function agir(acao: "preparar" | "conferir") {
    if (!d || ocupado) return;
    if (acao === "conferir" && !confirm(`Conferir a preparação de ${d.itens.length} item(ns), total ${reais(d.totalCentavos)}? Isso não autoriza nem envia Pix.`)) return;
    const geracao = geracaoAtual.current;
    setOperacao(atualizacao); setMensagem(null);
    try {
      const dados = await api<Previa>("/api/rh/folha/lote-pix", { method: "POST", body: { acao, competencia, revisao: d.revisao } });
      if (!geracao?.ativa || geracaoAtual.current !== geracao) return;
      setEstado({ origem: atualizacao, dados });
      setMensagem({ origem: atualizacao, texto: acao === "preparar" ? "Preparação salva para revisão. Nenhum pagamento enviado." : "Preparação conferida. Titularidade bancária e envio continuam bloqueados." });
    } catch (e) {
      if (!geracao?.ativa || geracaoAtual.current !== geracao) return;
      setMensagem({ origem: atualizacao, texto: (e as Error).message });
      // Uma revisão desatualizada nunca permanece disponível para outro clique.
      setEstado(null);
      try {
        const dados = await api<Previa>(`/api/rh/folha/lote-pix?competencia=${competencia}`);
        if (geracao.ativa && geracaoAtual.current === geracao) setEstado({ origem: atualizacao, dados });
      } catch { /* Mantém os dados privados removidos. */ }
    } finally { if (geracao?.ativa && geracaoAtual.current === geracao) setOperacao(null); }
  }

  return <section className="cartao space-y-3" aria-labelledby="lote-pix-titulo">
    <div><h2 id="lote-pix-titulo" className="font-semibold">Preparação do lote Pix</h2><p className="text-xs text-zinc-500">Somente folhas fechadas com líquido positivo. Preparar e conferir não movimenta dinheiro nem marca a folha como paga.</p></div>
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{d?.bloqueioEnvio ?? "Envio Pix desabilitado. Destinatários ainda não verificados pelo banco."}</p>
    {msg && <p className="text-sm" role="status">{msg}</p>}
    {!d ? <p className="text-sm text-zinc-500">{msg ? "Prévia indisponível." : "Carregando a preparação…"}</p> : <>
      <div className="flex flex-wrap items-center gap-3"><b>{d.itens.length} item(ns) · {reais(d.totalCentavos)}</b><span className="text-xs text-zinc-500">{d.excluidas} folha(s) paga(s) ou sem valor positivo fora do lote</span></div>
      {d.itens.length === 0 ? <p className="text-sm text-zinc-500">Feche as folhas antes de preparar o lote.</p> : <ul className="divide-y divide-zinc-200">
        {d.itens.map(item => <li key={item.folhaId} className="space-y-1 py-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><span>{item.nome}</span><b>{reais(item.valorCentavos)}</b></div>
          <p className="text-xs text-zinc-500">{item.tipoChave ?? "Chave"}: {item.chaveMascarada} · Destinatário não verificado pelo banco</p>
          {item.problemas.map(p => <p key={p} className="text-xs text-red-700">{p}</p>)}
        </li>)}
      </ul>}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={ocupado || !d.itens.length || !!d.lote} onClick={() => agir("preparar")}>{d.lote ? "Preparação salva" : "Preparar lote sem envio"}</button>
        {d.donoPodeConferir && <button className="btn" disabled={ocupado || !d.lote || !d.podeConferir || !!d.lote.conferidoEm} onClick={() => agir("conferir")}>{d.lote?.conferidoEm ? "Preparação conferida pelo dono" : "Conferir preparação"}</button>}
      </div>
      {d.lote?.conferidoEm && <p className="text-xs text-zinc-500">Conferência local válida para esta revisão. Não autoriza transferência; nenhuma titularidade foi confirmada no banco.</p>}
    </>}
  </section>;
}
