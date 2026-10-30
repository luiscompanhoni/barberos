"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Sparkles } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import type { OportunidadeRecompra } from "@/lib/recompras/servico";
import type { EstadoOferta } from "@/lib/recompras/regras";
import { useAcesso } from "@/components/AcessoContexto";

export function RecomprasDoDia({ barbeiroId, data }: { barbeiroId: string; data: string }) {
  const { permissoes } = useAcesso();
  const [lista, setLista] = useState<OportunidadeRecompra[] | null>(null);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [descontos, setDescontos] = useState<Record<string, boolean>>({});
  const [lembrar, setLembrar] = useState<Record<string, string>>({});
  const carregar = useCallback(async () => {
    try {
      const itens = await api<OportunidadeRecompra[]>(`/api/recompras?${new URLSearchParams({ barbeiroId, data })}`);
      setLista(itens); setErro("");
    } catch (e) { setErro((e as Error).message); }
  }, [barbeiroId, data]);
  useEffect(() => { let viva = true; api<OportunidadeRecompra[]>(`/api/recompras?${new URLSearchParams({ barbeiroId, data })}`).then(itens => { if (viva) { setLista(itens); setErro(""); } }).catch(e => { if (viva) setErro(e.message); }); return () => { viva = false; }; }, [barbeiroId, data]);

  async function registrar(o: OportunidadeRecompra, estado: EstadoOferta) {
    const chave = `${o.agendamentoId}:${o.servicoId}`;
    if (estado === "ACEITOU" && !confirm(`Agendar ${o.servicoNome} após este atendimento e incluir o serviço na comanda? O valor previsto é ${reais(o.precoCentavos - (descontos[chave] ? o.descontoCentavos : 0))}.`)) return;
    if (estado === "LEMBRAR" && !lembrar[chave]) { setErro("Escolha quando lembrar novamente."); return; }
    setOcupado(true); setErro(""); setMensagem("");
    try {
      await api("/api/recompras", { method: "POST", body: { agendamentoId: o.agendamentoId, servicoId: o.servicoId, estado, aplicarDesconto: estado === "ACEITOU" && !!descontos[chave], ...(estado === "LEMBRAR" ? { lembrarEm: new Date(lembrar[chave]).toISOString() } : {}) } });
      setMensagem(estado === "ACEITOU" ? "Serviço agendado e incluído na comanda. Confira a agenda atualizada." : "Resposta registrada.");
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }

  return <section className="cartao space-y-4" aria-label="Recomendações de recompra">
    <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold"><Sparkles size={18} className="text-ouro" /> Recompras para hoje</h2><button type="button" className="btn" aria-label="Atualizar recompras" onClick={carregar} disabled={ocupado}><RefreshCw size={15} /></button></div>
    <p className="text-sm text-zinc-500">Sugestões pelo histórico do cliente. O aceite reserva o tempo necessário e lança somente o serviço escolhido.</p>
    {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
    {mensagem && <p role="status" className="text-sm text-emerald-700">{mensagem} <Link className="underline" href="/recepcao">Ver agenda</Link></p>}
    {!lista ? <p className="text-sm text-zinc-500">Carregando sugestões…</p> : !lista.length ? <p className="text-sm text-zinc-500">Nenhuma recompra elegível neste dia. Os intervalos são definidos pelo dono em Recompra e custos.</p> : <div className="grid gap-3 md:grid-cols-2">{lista.map(o => {
      const chave = `${o.agendamentoId}:${o.servicoId}`;
      return <article className="rounded-xl border border-zinc-200 p-3 space-y-2" key={chave}>
        <p className="font-semibold">{o.clienteNome} · {o.servicoNome}</p>
        <p className="text-sm text-zinc-500">{o.motivo}</p>
        <p className="text-sm">{o.duracaoMin} minutos · {o.cobertoPlano ? "Incluído no plano" : reais(o.precoCentavos)}{o.comissaoCentavos !== null && <> · comissão prevista {reais(o.comissaoCentavos)}</>}</p>
        <p className={`text-xs ${o.podeEncaixar ? "text-emerald-700" : "text-amber-700"}`}>{o.podeEncaixar ? `Cabe após o atendimento, às ${new Date(o.inicioSugerido).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}.` : "Sem espaço suficiente após o atendimento. Consulte os encaixes na agenda."}</p>
        {o.descontoCentavos > 0 && permissoes.desconto && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!descontos[chave]} onChange={e => setDescontos({ ...descontos, [chave]: e.target.checked })} /> Aplicar oferta autorizada: {reais(o.precoCentavos - o.descontoCentavos)}. A comissão será recalculada.</label>}
        <div className="flex flex-wrap gap-2"><button type="button" disabled={ocupado || o.oferta?.estado === "OFERECIDO"} className="btn" onClick={() => registrar(o, "OFERECIDO")}>Oferecido</button><button type="button" disabled={ocupado || !o.podeEncaixar} className="btn-primario" onClick={() => registrar(o, "ACEITOU")}>Aceitou · agendar</button><button type="button" disabled={ocupado} className="btn" onClick={() => registrar(o, "RECUSOU")}>Não quis</button></div>
        <div className="flex flex-wrap items-end gap-2"><label className="text-xs text-zinc-500">Lembrar em<input type="datetime-local" className="campo mt-1" value={lembrar[chave] ?? ""} onChange={e => setLembrar({ ...lembrar, [chave]: e.target.value })} /></label><button type="button" disabled={ocupado || !lembrar[chave]} className="btn" onClick={() => registrar(o, "LEMBRAR")}>Lembrar depois</button></div>
      </article>;
    })}</div>}
  </section>;
}
