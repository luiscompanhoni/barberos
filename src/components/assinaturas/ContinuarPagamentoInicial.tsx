"use client";

import { useState } from "react";

const FORMAS: Record<string, string> = { PIX: "Pix", CARTAO: "Cartão", BOLETO: "Boleto" };
/** Apenas apresenta a operação já criada. Troca depende do cancelamento comprovado. */
export function ContinuarPagamentoInicial(p: { forma: string; link: string | null; emConferencia: boolean; equipe?: boolean }) {
  const [mensagem, setMensagem] = useState("");
  async function copiar() {
    try { await navigator.clipboard.writeText(new URL(p.link!, window.location.origin).href); setMensagem("Link da operação existente copiado."); }
    catch { setMensagem("Não foi possível copiar. Use o link apresentado abaixo."); }
  }
  return <section className="space-y-3 rounded-xl border border-zinc-200 p-3" aria-label="Continuar pagamento existente">
    <p className="text-sm font-semibold">Manter o pagamento por {FORMAS[p.forma] ?? p.forma}</p>
    {p.emConferencia ? <p role="status" className="text-sm">O resultado ainda está em conferência. Atualize o status para verificar a operação antes de pagar novamente.</p>
      : p.link ? <div className="flex flex-wrap gap-2">{p.equipe && <button className="btn" onClick={copiar}>Copiar link existente</button>}<a href={p.link} className="btn-primario" target={p.equipe ? "_blank" : undefined} rel={p.equipe ? "noopener noreferrer" : undefined}>{p.equipe ? "Abrir pagamento existente" : "Continuar pagamento"}</a></div>
      : <p className="text-sm text-zinc-500">Ainda não há um link disponível. Atualize o status para consultar o provedor.</p>}
    <p className="text-xs text-zinc-500">Quer usar outra forma? Confirme o cancelamento desta operação primeiro. Assim evitamos duas cobranças para a mesma assinatura.</p>
    {mensagem && <p role="status" className="text-xs">{mensagem}</p>}
  </section>;
}
