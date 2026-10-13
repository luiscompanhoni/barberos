"use client";

import { useEffect, useMemo, useState } from "react";
import { Beer, Package, Plus, Search } from "lucide-react";
import { api, paraCentavos, reais } from "@/lib/cliente-api";
import type { Produto } from "./tipos";

/** Botoes dos produtos (toque = +1 na comanda), com busca e abas Bar / Loja. */
export function Catalogo({ onProduto, onAvulso, podeAvulso, desabilitado }: {
  onProduto: (produtoId: string) => void;
  onAvulso: (descricao: string, precoCentavos: number) => void;
  podeAvulso: boolean;
  desabilitado: boolean;
}) {
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [aba, setAba] = useState<"BAR" | "LOJA">("BAR");
  const [busca, setBusca] = useState("");
  const [avulso, setAvulso] = useState({ descricao: "", preco: "" });

  useEffect(() => {
    api<Produto[]>("/api/produtos").then((ps) => setProdutos(ps.filter((p) => p.categoria !== "USO_INTERNO"))).catch(() => setProdutos([]));
  }, []);

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
        {!busca && (["BAR", "LOJA"] as const).map((c) => (
          <button key={c} onClick={() => setAba(c)} className={aba === c ? "btn-primario" : "btn"}>
            {c === "BAR" ? <Beer size={14} /> : <Package size={14} />} {c === "BAR" ? "Bar" : "Loja"}
          </button>
        ))}
        <div className="relative ml-auto w-full max-w-48">
          <Search size={14} className="absolute top-2.5 left-3 text-zinc-500" />
          <input className="campo pl-8" placeholder="Buscar ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      {!produtos ? (
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
