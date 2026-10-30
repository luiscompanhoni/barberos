"use client";

import { useEffect, useMemo, useState } from "react";
import { api, reais } from "@/lib/cliente-api";

export type DestaqueEncaixe = { chave: string; inicio: string; fim: string; quantidade: number };
type Dados = { profissionais: { barbeiroId: string; nome: string; servicos: { servicoId: string; nome: string; duracaoMin: number; precoCentavos: number; comissaoCentavos: number | null; quantidade: number; janelas: { inicio: string; fim: string; quantidade: number }[] }[] }[] };
export function EncaixesPainel(p: { data: string; barbeiroId?: string; servicoInicial?: string; destacarInicial?: boolean; versao: unknown; onDestacar: (d: DestaqueEncaixe[]) => void; onAgendar: (barbeiroId: string, servicoId: string, inicio: number, fim: number) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [selecionado, setSelecionado] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    api<Dados>(`/api/encaixes?${new URLSearchParams({ data: p.data, ...(p.barbeiroId ? { barbeiroId: p.barbeiroId } : {}) })}`)
      .then(d => { if (vivo) { setDados(d); setErro(""); } }).catch(e => vivo && setErro(e.message));
    return () => { vivo = false; };
  }, [p.data, p.barbeiroId, p.versao]);
  const opcoes = useMemo(() => dados?.profissionais.flatMap(b => b.servicos.map(s => ({ b, s, chave: `${b.barbeiroId}|${s.servicoId}` }))) ?? [], [dados]);
  const inicial = p.destacarInicial ? (opcoes.find(o => o.s.servicoId === p.servicoInicial) ?? opcoes[0]) : undefined;
  const escolha = selecionado === null ? inicial : opcoes.find(o => o.chave === selecionado);
  const destacar = p.onDestacar;
  useEffect(() => {
    destacar(escolha?.s.janelas.map(j => ({ ...j, chave: `${escolha.b.barbeiroId}|${p.data}` })) ?? []);
    return () => destacar([]);
  }, [escolha, p.data, destacar]);
  return <section className="cartao space-y-2" aria-label="Encaixes disponíveis">
    <p className="text-sm font-semibold">Encaixes de {p.data.split("-").reverse().join("/")}</p>
    <p className="text-xs text-zinc-500">Escolha um serviço para destacar as janelas. As opções são alternativas: não some vagas de serviços diferentes.</p>
    {erro && <p role="alert" className="text-red-600 text-sm">{erro}</p>}
    {!dados && !erro && <p className="text-sm">Consultando espaços livres…</p>}
    {dados && !opcoes.length && <p className="text-sm">Nenhum serviço cabe nos intervalos restantes deste dia.</p>}
    {!!opcoes.length && <label className="rotulo">Profissional e serviço<select className="campo" value={escolha?.chave ?? ""} onChange={e => setSelecionado(e.target.value)}>
      <option value="">Escolha para destacar na agenda</option>{opcoes.map(o => <option key={o.chave} value={o.chave}>{o.b.nome} · {o.s.nome} · {o.s.quantidade} encaixe(s) de {o.s.duracaoMin} min</option>)}
    </select></label>}
    {escolha && <div className="text-sm">
      <p>Por encaixe avulso: {reais(escolha.s.precoCentavos)}{escolha.s.comissaoCentavos !== null ? ` · comissão prevista ${reais(escolha.s.comissaoCentavos)}` : ""}. Venda sujeita à confirmação do cliente.</p>
      <div className="mt-2 flex flex-wrap gap-2">{escolha.s.janelas.map(j => <button key={j.inicio} className="btn" onClick={() => p.onAgendar(escolha.b.barbeiroId, escolha.s.servicoId, Date.parse(j.inicio), Date.parse(j.inicio) + escolha.s.duracaoMin * 60_000)}>
        Agendar às {new Date(j.inicio).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}
      </button>)}</div>
    </div>}
  </section>;
}
