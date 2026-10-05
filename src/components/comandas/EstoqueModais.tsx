"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { api, centavosParaTexto, paraCentavos, reais } from "@/lib/cliente-api";
import { CATEGORIAS, type Produto } from "./tipos";

/** Cadastro/edicao do produto (so o dono). */
export function ProdutoModal({ produto, onFechar, onSalvo }: { produto: Produto | null; onFechar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState({
    nome: produto?.nome ?? "",
    categoria: produto?.categoria ?? "BAR",
    preco: produto ? centavosParaTexto(produto.precoCentavos) : "",
    custo: produto ? centavosParaTexto(produto.custoCentavos) : "",
    minimo: String(produto?.estoqueMinimo ?? 0),
    unidade: produto?.unidade ?? "un",
    codigo: produto?.codigoBarras ?? "",
    inicial: "",
  });
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const uso = f.categoria === "USO_INTERNO";

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const precoCentavos = uso ? 0 : paraCentavos(f.preco);
    const custoCentavos = f.custo.trim() ? paraCentavos(f.custo) : 0;
    const inicial = f.inicial.trim() ? Number(f.inicial) : 0;
    if (Number.isNaN(precoCentavos) || Number.isNaN(custoCentavos)) return setErro("Confira os valores (ex.: 12,50).");
    if (!Number.isInteger(inicial) || inicial < 0) return setErro("Estoque inicial precisa ser um número inteiro.");
    setErro("");
    setSalvando(true);
    try {
      const body = { nome: f.nome, categoria: f.categoria, precoCentavos, custoCentavos, estoqueMinimo: Number(f.minimo) || 0, unidade: f.unidade || "un", codigoBarras: f.codigo || null };
      if (produto) await api(`/api/produtos/${produto.id}`, { method: "PATCH", body });
      else {
        const p = await api<Produto>("/api/produtos", { method: "POST", body });
        if (inicial > 0) await api(`/api/produtos/${p.id}/movimentos`, { method: "POST", body: { tipo: "ENTRADA", quantidade: inicial, custoUnitarioCentavos: custoCentavos || null, motivo: "Estoque inicial" } });
      }
      onSalvo();
    } catch (e) {
      setErro((e as Error).message);
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={produto ? "Editar produto" : "Novo produto"} onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3">
        <div>
          <label className="rotulo" htmlFor="p-nome">Nome</label>
          <input id="p-nome" className="campo" autoFocus required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Cerveja long neck" />
        </div>
        <div>
          <p className="rotulo">Categoria</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(CATEGORIAS) as Produto["categoria"][]).map((c) => (
              <button type="button" key={c} onClick={() => setF({ ...f, categoria: c })} className={f.categoria === c ? "btn-primario" : "btn"}>{CATEGORIAS[c]}</button>
            ))}
          </div>
          {uso && <p className="mt-1 text-xs text-zinc-500">Insumo usado no atendimento (pomada, lâmina…). Não aparece na comanda; baixa por “consumo”.</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {!uso && (
            <div>
              <label className="rotulo" htmlFor="p-preco">Preço de venda</label>
              <input id="p-preco" className="campo" inputMode="decimal" required value={f.preco} onChange={(e) => setF({ ...f, preco: e.target.value })} placeholder="0,00" />
            </div>
          )}
          <div>
            <label className="rotulo" htmlFor="p-custo">Custo (compra)</label>
            <input id="p-custo" className="campo" inputMode="decimal" value={f.custo} onChange={(e) => setF({ ...f, custo: e.target.value })} placeholder="0,00" />
          </div>
          <div>
            <label className="rotulo" htmlFor="p-min">Avisar com</label>
            <input id="p-min" className="campo" inputMode="numeric" value={f.minimo} onChange={(e) => setF({ ...f, minimo: e.target.value.replace(/\D/g, "") })} />
          </div>
          <div>
            <label className="rotulo" htmlFor="p-un">Unidade</label>
            <input id="p-un" className="campo" value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value })} placeholder="un, lata, g" />
          </div>
          {!produto && (
            <div>
              <label className="rotulo" htmlFor="p-ini">Estoque inicial</label>
              <input id="p-ini" className="campo" inputMode="numeric" value={f.inicial} onChange={(e) => setF({ ...f, inicial: e.target.value.replace(/\D/g, "") })} placeholder="0" />
            </div>
          )}
          <div>
            <label className="rotulo" htmlFor="p-cod">Código de barras</label>
            <input id="p-cod" className="campo" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} placeholder="opcional" />
          </div>
        </div>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <button className="btn-primario w-full py-2.5" disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
        {produto?.ativo && (
          <button type="button" className="w-full text-xs font-semibold text-zinc-500 hover:text-red-600" disabled={salvando}
            onClick={() => api(`/api/produtos/${produto.id}`, { method: "PATCH", body: { ativo: false } }).then(onSalvo).catch((e) => setErro(e.message))}>
            Desativar produto (some da comanda; o histórico fica)
          </button>
        )}
      </form>
    </Modal>
  );
}

const TIPOS = {
  ENTRADA: { titulo: "Entrada (compra)", ajuda: "Quantas unidades chegaram?" },
  AJUSTE: { titulo: "Ajustar contagem", ajuda: "Quantas unidades tem de verdade na prateleira?" },
  CONSUMO: { titulo: "Consumo no atendimento", ajuda: "Quantas unidades foram usadas?" },
  PERDA: { titulo: "Perda", ajuda: "Quantas quebraram, venceram ou sumiram?" },
} as const;
export type TipoLancamento = keyof typeof TIPOS;

export function MovimentoModal({ produto, tipo, onFechar, onSalvo }: { produto: Produto; tipo: TipoLancamento; onFechar: () => void; onSalvo: () => void }) {
  const [qtd, setQtd] = useState("");
  const [custo, setCusto] = useState(produto.custoCentavos ? centavosParaTexto(produto.custoCentavos) : "");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const n = Number(qtd);
  const previsto = qtd === "" ? null : tipo === "ENTRADA" ? produto.estoque + n : tipo === "AJUSTE" ? n : produto.estoque - n;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (qtd === "" || !Number.isInteger(n)) return setErro("Informe a quantidade.");
    const custoUnitarioCentavos = tipo === "ENTRADA" && custo.trim() ? paraCentavos(custo) : null;
    if (Number.isNaN(custoUnitarioCentavos)) return setErro("Custo inválido.");
    setSalvando(true);
    try {
      await api(`/api/produtos/${produto.id}/movimentos`, { method: "POST", body: { tipo, quantidade: n, custoUnitarioCentavos, motivo: motivo || null } });
      onSalvo();
    } catch (e) {
      setErro((e as Error).message);
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={`${TIPOS[tipo].titulo} · ${produto.nome}`} onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3">
        <p className="text-sm text-zinc-500">Saldo atual: <b className="text-zinc-900">{produto.estoque} {produto.unidade}</b></p>
        <div>
          <label className="rotulo" htmlFor="m-qtd">{TIPOS[tipo].ajuda}</label>
          <input id="m-qtd" className="campo text-lg" inputMode="numeric" autoFocus value={qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, ""))} />
        </div>
        {tipo === "ENTRADA" && (
          <div>
            <label className="rotulo" htmlFor="m-custo">Custo por unidade</label>
            <input id="m-custo" className="campo" inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)} placeholder="0,00" />
          </div>
        )}
        <div>
          <label className="rotulo" htmlFor="m-mot">Observação</label>
          <input id="m-mot" className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={tipo === "ENTRADA" ? "Fornecedor / nota" : "opcional"} />
        </div>
        {previsto !== null && <p className="text-sm">Fica com <b className={previsto < 0 ? "text-red-600" : "text-ouro"}>{previsto} {produto.unidade}</b></p>}
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <button className="btn-primario w-full py-2.5" disabled={salvando}>{salvando ? "Salvando..." : "Confirmar"}</button>
      </form>
    </Modal>
  );
}

type Movimento = { id: string; tipo: string; quantidade: number; saldoApos: number; custoUnitarioCentavos: number | null; motivo: string | null; criadoEm: string; usuario: string | null };
const NOME_TIPO: Record<string, string> = { ENTRADA: "Entrada", VENDA: "Venda", CONSUMO: "Consumo", AJUSTE: "Ajuste", PERDA: "Perda", ESTORNO: "Estorno" };

export function HistoricoModal({ produto, onFechar }: { produto: Produto; onFechar: () => void }) {
  const [movs, setMovs] = useState<Movimento[] | null>(null);
  useEffect(() => { api<Movimento[]>(`/api/produtos/${produto.id}/movimentos`).then(setMovs).catch(() => setMovs([])); }, [produto.id]);
  return (
    <Modal titulo={`Histórico · ${produto.nome}`} onFechar={onFechar}>
      {!movs ? <p className="text-sm text-zinc-500">Carregando...</p> : movs.length === 0 ? <p className="text-sm text-zinc-500">Sem movimentos.</p> : (
        <ul className="divide-y divide-zinc-200 text-sm">
          {movs.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{NOME_TIPO[m.tipo] ?? m.tipo}{m.motivo && <span className="font-normal text-zinc-500"> · {m.motivo}</span>}</p>
                <p className="text-xs text-zinc-500">
                  {new Date(m.criadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
                  {m.usuario && ` · ${m.usuario}`}{m.custoUnitarioCentavos != null && ` · ${reais(m.custoUnitarioCentavos)}/un`}
                </p>
              </div>
              <span className={`font-bold ${m.quantidade > 0 ? "text-emerald-700" : "text-red-600"}`}>{m.quantidade > 0 ? "+" : ""}{m.quantidade}</span>
              <span className="w-10 text-right text-xs text-zinc-500">{m.saldoApos}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
