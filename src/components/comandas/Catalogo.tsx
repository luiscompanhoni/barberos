"use client";

import { useEffect, useMemo, useState } from "react";
import { Beer, Package, Plus, Scissors, Search } from "lucide-react";
import { api, paraCentavos, reais } from "@/lib/cliente-api";
import type { Produto } from "./tipos";

type ServicoCat = { id: string; nome: string; ativo: boolean; precoCentavos: number; barbeiros: { barbeiroId: string; precoCentavos: number | null }[] };
type BarbeiroCat = { id: string; nome: string; ativo: boolean };

/** Botoes dos produtos (toque = +1 na comanda), com busca e abas Bar / Loja / Servicos (adicional ao atendimento). */
export function Catalogo({ onProduto, onServico, barbeiroPadrao, onAvulso, podeAvulso, desabilitado }: {
  onProduto: (produtoId: string) => void;
  /** Servico adicional (ex.: sobrancelha junto do corte). Sem isso, a aba Servicos nao aparece. */
  onServico?: (servicoId: string, barbeiroId: string) => void;
  /** Barbeiro do atendimento da comanda (ja vem escolhido). */
  barbeiroPadrao?: string | null;
  onAvulso: (descricao: string, precoCentavos: number) => void;
  podeAvulso: boolean;
  desabilitado: boolean;
}) {
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [aba, setAba] = useState<"BAR" | "LOJA" | "SERVICO">("BAR");
  const [servicos, setServicos] = useState<ServicoCat[] | null>(null);
  const [barbeiros, setBarbeiros] = useState<BarbeiroCat[]>([]);
  const [barbeiro, setBarbeiro] = useState(barbeiroPadrao ?? "");
  const [busca, setBusca] = useState("");
  const [avulso, setAvulso] = useState({ descricao: "", preco: "" });

  useEffect(() => {
    api<Produto[]>("/api/produtos").then((ps) => setProdutos(ps.filter((p) => p.categoria !== "USO_INTERNO"))).catch(() => setProdutos([]));
  }, []);
  useEffect(() => {
    if (aba !== "SERVICO" || servicos) return;
    api<ServicoCat[]>("/api/servicos").then((s) => setServicos(s.filter((x) => x.ativo))).catch(() => setServicos([]));
    api<BarbeiroCat[]>("/api/barbeiros").then((b) => setBarbeiros(b.filter((x) => x.ativo))).catch(() => {});
  }, [aba, servicos]);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (produtos ?? []).filter((p) => (b ? p.nome.toLowerCase().includes(b) || p.codigoBarras === b : p.categoria === aba));
  }, [produtos, aba, busca]);

  function lancarAvulso(e: React.FormEvent) {
    e.preventDefault();
    const preco = paraCentavos(avulso.preco);
    if (avulso.descricao.trim().length < 2 || Number.isNaN(preco)) return;
    onAvulso(avulso.descricao.trim(), preco);
    setAvulso({ descricao: "", preco: "" });
  }

  return (
    <div className="cartao space-y-3">
      <div className="flex items-center gap-2">
        {!busca && (["BAR", "LOJA", ...(onServico ? ["SERVICO" as const] : [])] as const).map((c) => (
          <button key={c} onClick={() => setAba(c)} className={aba === c ? "btn-primario" : "btn"}>
            {c === "BAR" ? <Beer size={14} /> : c === "LOJA" ? <Package size={14} /> : <Scissors size={14} />} {c === "BAR" ? "Bar" : c === "LOJA" ? "Loja" : "Serviços"}
          </button>
        ))}
        <div className="relative ml-auto w-full max-w-48">
          <Search size={14} className="absolute top-2.5 left-3 text-zinc-500" />
          <input className="campo pl-8" placeholder="Buscar ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      {aba === "SERVICO" && !busca && onServico ? (
        <ServicosAdicionais servicos={servicos} barbeiros={barbeiros} barbeiro={barbeiro} setBarbeiro={setBarbeiro} desabilitado={desabilitado} onServico={onServico} />
      ) : !produtos ? (
        <p className="text-sm text-zinc-500">Carregando produtos...</p>
      ) : lista.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">
          {produtos.length === 0 ? "Nenhum produto cadastrado ainda. Cadastre em Estoque." : "Nada encontrado."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {lista.map((p) => (
            <button key={p.id} disabled={desabilitado} onClick={() => onProduto(p.id)}
              className="group flex min-h-20 flex-col justify-between rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-left transition hover:border-ouro active:scale-[0.98] disabled:opacity-50">
              <span className="line-clamp-2 text-sm font-semibold">{p.nome}</span>
              <span className="mt-2 flex items-end justify-between gap-1">
                <span className="text-sm font-bold text-ouro">{reais(p.precoCentavos)}</span>
                <span className={`text-[10px] ${p.estoque <= p.estoqueMinimo ? "font-bold text-red-600" : "text-zinc-500"}`}>{p.estoque} {p.unidade}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {podeAvulso && (
        <form onSubmit={lancarAvulso} className="flex gap-2 border-t border-zinc-200 pt-3">
          <input className="campo flex-1" placeholder="Item avulso (ex.: gorjeta)" value={avulso.descricao} onChange={(e) => setAvulso({ ...avulso, descricao: e.target.value })} />
          <input className="campo w-24" inputMode="decimal" placeholder="R$" value={avulso.preco} onChange={(e) => setAvulso({ ...avulso, preco: e.target.value })} />
          <button className="btn shrink-0" disabled={desabilitado} aria-label="Lançar item avulso"><Plus size={15} /></button>
        </form>
      )}
    </div>
  );
}

/** Servico adicional: escolhe o barbeiro (o do atendimento ja vem marcado) e toca no servico. */
function ServicosAdicionais({ servicos, barbeiros, barbeiro, setBarbeiro, desabilitado, onServico }: {
  servicos: ServicoCat[] | null; barbeiros: BarbeiroCat[]; barbeiro: string; setBarbeiro: (id: string) => void;
  desabilitado: boolean; onServico: (servicoId: string, barbeiroId: string) => void;
}) {
  if (!servicos) return <p className="text-sm text-zinc-500">Carregando serviços...</p>;
  const doBarbeiro = servicos.filter((s) => s.barbeiros.some((b) => b.barbeiroId === barbeiro));
  return (
    <div className="space-y-2">
      <div>
        <label className="rotulo">Quem faz</label>
        <select className="campo" value={barbeiro} onChange={(e) => setBarbeiro(e.target.value)}>
          <option value="">Escolha o barbeiro</option>
          {barbeiros.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
        </select>
      </div>
      {!barbeiro ? <p className="py-4 text-center text-sm text-zinc-500">Escolha quem vai fazer o serviço.</p> : !doBarbeiro.length ? (
        <p className="py-4 text-center text-sm text-zinc-500">Esse barbeiro não tem serviços cadastrados.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {doBarbeiro.map((s) => {
            const preco = s.barbeiros.find((b) => b.barbeiroId === barbeiro)?.precoCentavos ?? s.precoCentavos;
            return (
              <button key={s.id} disabled={desabilitado} onClick={() => onServico(s.id, barbeiro)}
                className="flex min-h-20 flex-col justify-between rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-left transition hover:border-ouro active:scale-[0.98] disabled:opacity-50">
                <span className="line-clamp-2 text-sm font-semibold">{s.nome}</span>
                <span className="mt-2 text-sm font-bold text-ouro">{reais(preco)}</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-zinc-500">Entra junto do atendimento da comanda: conta na comissão de quem fez e no plano do assinante (se o plano cobrir), sem ocupar horário na agenda.</p>
    </div>
  );
}
