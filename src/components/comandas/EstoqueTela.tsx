"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History, PackagePlus, Pencil, Plus, Search } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { HistoricoModal, MovimentoModal, ProdutoModal, type TipoLancamento } from "./EstoqueModais";
import { CATEGORIAS, type Produto } from "./tipos";

type Relatorio = {
  valorEmEstoqueCentavos: number;
  valorDeVendaCentavos: number;
  acabando: number;
  maisVendidos: { produtoId: string; nome: string; quantidade: number }[];
  vendasMes: { totalCentavos: number; porTipo: { servicos: number; bar: number; loja: number; outros: number } };
};
type Filtro = "TODOS" | Produto["categoria"] | "ACABANDO";

export function EstoqueTela({ dono }: { dono: boolean }) {
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [rel, setRel] = useState<Relatorio | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [busca, setBusca] = useState("");
  const [editar, setEditar] = useState<Produto | null | "novo">(null);
  const [lancar, setLancar] = useState<{ produto: Produto; tipo: TipoLancamento } | null>(null);
  const [historico, setHistorico] = useState<Produto | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(() => {
    api<Produto[]>("/api/produtos?todos=1").then(setProdutos).catch((e) => setErro(e.message));
    api<Relatorio>("/api/estoque/relatorio").then(setRel).catch(() => {});
  }, []);
  useEffect(carregar, [carregar]);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (produtos ?? []).filter((p) =>
      (b ? p.nome.toLowerCase().includes(b) || p.codigoBarras === b : true) &&
      (filtro === "TODOS" ? p.ativo : filtro === "ACABANDO" ? p.ativo && p.estoque <= p.estoqueMinimo : p.ativo && p.categoria === filtro));
  }, [produtos, filtro, busca]);
  const inativos = (produtos ?? []).filter((p) => !p.ativo);

  const depois = () => { setEditar(null); setLancar(null); carregar(); };

  if (!produtos) return <p className="text-sm text-zinc-500">{erro || "Carregando..."}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="eyebrow">Bar e loja</p>
          <h1 className="titulo-marca text-2xl">Estoque</h1>
        </div>
        {dono && <button className="btn-primario ml-auto" onClick={() => setEditar("novo")}><Plus size={15} /> Novo produto</button>}
      </div>

      {rel && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Cartao rotulo="Valor em estoque (custo)" valor={reais(rel.valorEmEstoqueCentavos)} nota={`${reais(rel.valorDeVendaCentavos)} a preço de venda`} />
          <Cartao rotulo="Acabando" valor={String(rel.acabando)} nota="no mínimo ou abaixo" alerta={rel.acabando > 0} onClick={() => setFiltro("ACABANDO")} />
          <Cartao rotulo="Vendas do mês · bar" valor={reais(rel.vendasMes.porTipo.bar)} nota={`loja ${reais(rel.vendasMes.porTipo.loja)}`} />
          <div className="cartao">
            <p className="text-xs text-zinc-500">Mais vendidos no mês</p>
            {rel.maisVendidos.length === 0 ? <p className="mt-2 text-sm text-zinc-500">Nada vendido ainda.</p> : (
              <ol className="mt-2 space-y-0.5 text-sm">
                {rel.maisVendidos.slice(0, 3).map((m) => <li key={m.produtoId} className="flex justify-between gap-2"><span className="truncate">{m.nome}</span><b>{m.quantidade}</b></li>)}
              </ol>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(["TODOS", "BAR", "LOJA", "USO_INTERNO", "ACABANDO"] as Filtro[]).map((f) => (
          <button key={f} onClick={() => setFiltro(f)} className={`rounded-full px-3 py-1 text-sm ${filtro === f ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`}>
            {f === "TODOS" ? "Todos" : f === "ACABANDO" ? "Acabando" : CATEGORIAS[f]}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-60">
          <Search size={14} className="absolute top-2.5 left-3 text-zinc-500" />
          <input className="campo pl-8" placeholder="Buscar produto ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      {lista.length === 0 ? (
        <p className="cartao py-8 text-center text-sm text-zinc-500">
          {produtos.length === 0 ? "Nenhum produto ainda. Cadastre cervejas, refrigerantes, pomadas e o que mais vender." : "Nada nesse filtro."}
        </p>
      ) : (
        <div className="cartao overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] text-zinc-500 uppercase">
                <th className="px-4 py-2.5 font-bold">Produto</th>
                <th className="px-2 py-2.5 font-bold">Preço</th>
                <th className="px-2 py-2.5 font-bold">Custo</th>
                <th className="px-2 py-2.5 font-bold">Saldo</th>
                <th className="px-4 py-2.5 text-right font-bold">Lançar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {lista.map((p) => {
                const baixo = p.estoque <= p.estoqueMinimo;
                return (
                  <tr key={p.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{p.nome}</p>
                      <p className="text-xs text-zinc-500">{CATEGORIAS[p.categoria]}{p.codigoBarras && ` · ${p.codigoBarras}`}</p>
                    </td>
                    <td className="px-2 py-2.5">{p.categoria === "USO_INTERNO" ? "—" : reais(p.precoCentavos)}</td>
                    <td className="px-2 py-2.5 text-zinc-500">{p.custoCentavos ? reais(p.custoCentavos) : "—"}</td>
                    <td className="px-2 py-2.5">
                      <span className={`font-bold ${p.estoque < 0 ? "text-red-600" : baixo ? "text-amber-700" : ""}`}>{p.estoque}</span>
                      <span className="text-xs text-zinc-500"> {p.unidade}</span>
                      {baixo && <p className="text-[10px] text-amber-700">mín. {p.estoqueMinimo}</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button className="btn py-1 text-xs" onClick={() => setLancar({ produto: p, tipo: "ENTRADA" })}><PackagePlus size={13} /> Entrada</button>
                        <select className="campo w-auto py-1 text-xs" value="" aria-label="Outros lançamentos"
                          onChange={(e) => e.target.value && setLancar({ produto: p, tipo: e.target.value as TipoLancamento })}>
                          <option value="">Mais…</option>
                          <option value="AJUSTE">Ajustar contagem</option>
                          <option value="CONSUMO">Consumo</option>
                          <option value="PERDA">Perda</option>
                        </select>
                        <button className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100" onClick={() => setHistorico(p)} title="Histórico" aria-label="Histórico"><History size={15} /></button>
                        {dono && <button className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100" onClick={() => setEditar(p)} title="Editar" aria-label="Editar"><Pencil size={15} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dono && inativos.length > 0 && (
        <details className="text-sm text-zinc-500">
          <summary className="cursor-pointer">Desativados ({inativos.length})</summary>
          <ul className="mt-2 space-y-1">
            {inativos.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                {p.nome}
                <button className="text-xs text-ouro underline" onClick={() => api(`/api/produtos/${p.id}`, { method: "PATCH", body: { ativo: true } }).then(carregar)}>reativar</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {editar && (
        <ProdutoModal produto={editar === "novo" ? null : editar} onFechar={() => setEditar(null)} onSalvo={depois} />
      )}
      {lancar && <MovimentoModal produto={lancar.produto} tipo={lancar.tipo} onFechar={() => setLancar(null)} onSalvo={depois} />}
      {historico && <HistoricoModal produto={historico} onFechar={() => setHistorico(null)} />}
    </div>
  );
}

function Cartao({ rotulo, valor, nota, alerta, onClick }: { rotulo: string; valor: string; nota?: string; alerta?: boolean; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`cartao text-left ${onClick ? "transition hover:border-zinc-400" : ""} ${alerta ? "border-amber-300" : ""}`}>
      <p className="text-xs text-zinc-500">{rotulo}</p>
      <p className={`mt-1 text-2xl font-black ${alerta ? "text-amber-700" : ""}`}>{valor}</p>
      {nota && <p className="mt-0.5 text-xs text-zinc-500">{nota}</p>}
    </Tag>
  );
}
