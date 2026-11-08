"use client";

import { useEffect, useState } from "react";
import { api, centavosParaTexto, paraCentavos, reais } from "@/lib/cliente-api";

type Dados = {
  ativa: boolean; saldoElegivelCentavos: number;
  assinaturas: { id: string; nome: string; precoCentavos: number; proximoVencimento: string | null }[];
  reservas: { id: string; assinaturaId: string; vencimento: string; valorCentavos: number; estado: string }[];
};
const ESTADO: Record<string, string> = { RESERVADA: "Reservado, aguardando aplicação", APLICANDO: "Em conferência de aplicação", CONFIRMADA: "Abatimento confirmado, aguardando pagamento", APLICADA: "Crédito utilizado em mensalidade paga", REVISAO: "A recepção precisa conferir" };
const data = (dia: string) => dia.split("-").reverse().join("/");

/** Solicitação explícita; nenhuma reserva automática ao abrir a carteira. */
export function CreditoAssinatura({ aoReservar }: { aoReservar?: () => void } = {}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [valor, setValor] = useState("");
  useEffect(() => {
    let vivo = true;
    api<Dados>("/api/cliente/saldo/assinatura").then((d) => { if (vivo) setDados(d); }).catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, []);
  async function reservar(assinaturaId: string) {
    const valorCentavos = valor.trim() ? paraCentavos(valor) : undefined;
    if (valorCentavos !== undefined && (!Number.isSafeInteger(valorCentavos) || valorCentavos <= 0 || valorCentavos > (dados?.saldoElegivelCentavos ?? 0))) {
      setErro("Informe um valor positivo dentro do crédito elegível disponível."); return;
    }
    setEnviando(true); setErro(""); setMensagem("");
    try {
      await api("/api/cliente/saldo/assinatura", { method: "POST", body: { assinaturaId, ...(valorCentavos === undefined ? {} : { valorCentavos }) } });
      setDados(await api<Dados>("/api/cliente/saldo/assinatura"));
      setMensagem("Solicitação registrada. Confira abaixo a situação do abatimento; isso não confirma pagamento da mensalidade.");
      setValor("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível confirmar. Peça ajuda à recepção antes de tentar novamente.");
      // O servidor pode ter reservado antes de uma falha externa; reler sem repetir a escrita.
      api<Dados>("/api/cliente/saldo/assinatura").then(setDados).catch(() => {});
    } finally { aoReservar?.(); setEnviando(false); }
  }
  if (!dados) return <p role="status" className="text-sm text-zinc-500">{erro || "Conferindo créditos para mensalidade…"}</p>;
  if (!dados.ativa && !dados.reservas.length) return null;
  return (
    <section className="cartao space-y-3" aria-labelledby="credito-assinatura-titulo">
      <h2 id="credito-assinatura-titulo" className="font-semibold">Crédito na próxima mensalidade</h2>
      <p className="text-sm text-zinc-600">Créditos elegíveis de indicação: {reais(dados.saldoElegivelCentavos)}. Solicite dentro da validade. A reserva vale para a próxima mensalidade indicada, mesmo se ela vencer depois dos 30 dias.</p>
      <p className="text-xs text-zinc-500">Reservar separa o valor da carteira e aguarda aplicação. Não confirma pagamento, não gera Pix e não permite saque. Cancelamento ou falha não estendem a validade original.</p>
      {dados.ativa && dados.saldoElegivelCentavos > 0 && <div className="space-y-1">
        <label htmlFor="valor-credito-assinatura" className="block text-sm">Valor a reservar (opcional)</label>
        <input id="valor-credito-assinatura" inputMode="decimal" className="rounded-lg border border-zinc-300 px-3 py-2" value={valor} placeholder={centavosParaTexto(dados.saldoElegivelCentavos)} disabled={enviando} onChange={(e) => setValor(e.target.value)} aria-describedby="ajuda-valor-credito" />
        <p id="ajuda-valor-credito" className="text-xs text-zinc-500">Em branco, solicita todo o crédito elegível. Para quitar a mensalidade inteira com crédito, peça conferência à recepção.</p>
      </div>}
      {dados.ativa && dados.saldoElegivelCentavos > 0 && dados.assinaturas.map((a) => {
        const existente = dados.reservas.some((r) => r.assinaturaId === a.id && r.vencimento === a.proximoVencimento);
        return <div key={a.id} className="space-y-2 border-t border-zinc-200 pt-3">
          <p className="text-sm">{a.nome}{a.proximoVencimento ? ` · próxima mensalidade em ${data(a.proximoVencimento)}` : " · vencimento em conferência"}</p>
          <button type="button" className="btn-primario px-4 py-2" disabled={enviando || existente || !a.proximoVencimento} onClick={() => reservar(a.id)}>{existente ? "Solicitação já registrada" : enviando ? "Conferindo…" : "Solicitar reserva para este ciclo"}</button>
        </div>;
      })}
      {dados.reservas.length > 0 && <ul className="space-y-2 text-sm">{dados.reservas.map((r) => <li key={r.id}>{reais(r.valorCentavos)} · {data(r.vencimento)} · {ESTADO[r.estado] ?? "Conferência com a recepção"}</li>)}</ul>}
      {mensagem && <p role="status" className="text-sm">{mensagem}</p>}
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    </section>
  );
}
