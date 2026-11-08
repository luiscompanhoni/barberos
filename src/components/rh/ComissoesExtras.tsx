"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { api, centavosParaTexto, paraCentavos } from "@/lib/cliente-api";
import { ComissaoDiferenciada, type AdicionalLinha } from "./ComissaoDiferenciada";
import type { ArredondamentoPote } from "@/lib/rh/rateio-assinaturas";

type Categoria = "BAR" | "LOJA";
type Adicionais = { hoje: string; fechadas: string[]; adicionais: AdicionalLinha[] };
type Dados = Adicionais & {
  revisao: string; vigenciaPadrao: string;
  assinaturas: { ativo: boolean; percentualBps: number; arredondamento: ArredondamentoPote; creditos: { servicoId: string; nome: string; creditos: number }[] };
  faixas: { categoria: Categoria; minimoCentavos: number; percentualBps: number }[];
  barbeiros: { id: string; nome: string }[];
};
// No formulario: percentuais como texto ("35", "5,5") e valores em reais ("100,00").
type Form = {
  ativo: boolean; percentual: string; arredondamento: ArredondamentoPote;
  creditos: Record<string, string>;
  faixas: { chave: number; categoria: Categoria; minimo: string; percentual: string }[];
};

const ROTULO: Record<Categoria, string> = { LOJA: "Loja (produtos)", BAR: "Conveniência (bar)" };
const pctTexto = (bps: number) => String(bps / 100).replace(".", ",");
const pctValor = (s: string) => Math.round(Number((s || "0").replace(",", ".")) * 100);
let seq = 0;

function paraForm(d: Dados): Form {
  return {
    ativo: d.assinaturas.ativo, percentual: pctTexto(d.assinaturas.percentualBps),
    arredondamento: d.assinaturas.arredondamento ?? "LEGADO",
    creditos: Object.fromEntries(d.assinaturas.creditos.map((f) => [f.servicoId, String(f.creditos)])),
    faixas: d.faixas.map((f) => ({ chave: ++seq, categoria: f.categoria, minimo: centavosParaTexto(f.minimoCentavos), percentual: pctTexto(f.percentualBps) })),
  };
}

/** Comissao das assinaturas (o "pote" do CashBarber), comissao diferenciada e comissao de produtos por faixa. */
export function ComissoesExtras() {
  const [d, setD] = useState<Dados | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [competencia, setCompetencia] = useState("");

  const aplicar = (x: Dados) => { setD(x); setF(paraForm(x)); setCompetencia(x.vigenciaPadrao); };
  useEffect(() => { api<Dados>("/api/rh/comissoes/extras").then(aplicar).catch((e) => setMsg({ t: e.message, erro: true })); }, []);

  async function salvar() {
    if (!d || !f) return;
    const body = {
      competencia, revisao: d.revisao,
      assinaturas: {
        ativo: f.ativo, percentualBps: pctValor(f.percentual),
        arredondamento: f.arredondamento,
        creditos: d.assinaturas.creditos.map((s) => ({ servicoId: s.servicoId, creditos: Math.round(Number(f.creditos[s.servicoId] || "0")) })),
      },
      faixas: f.faixas.map((x) => ({ categoria: x.categoria, minimoCentavos: paraCentavos(x.minimo || "0"), percentualBps: pctValor(x.percentual) })),
    };
    const nums = [body.assinaturas.percentualBps, ...body.assinaturas.creditos.map((x) => x.creditos), ...body.faixas.flatMap((x) => [x.minimoCentavos, x.percentualBps])];
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return setMsg({ t: "Confira os valores: tem campo inválido.", erro: true });
    setSalvando(true);
    setMsg(null);
    try {
      aplicar(await api<Dados>("/api/rh/comissoes/extras", { method: "PUT", body }));
      setMsg({ t: "Comissão das assinaturas e de produtos salvas." });
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    } finally {
      setSalvando(false);
    }
  }

  if (!d || !f) return <div className="cartao text-sm text-zinc-500">{msg?.t ?? "Carregando…"}</div>;
  const muda = (x: Partial<Form>) => setF({ ...f, ...x });
  return (
    <div className="space-y-4">
      <div className="cartao space-y-1"><label className="rotulo" htmlFor="vigencia-comissao-extras">Aplicar estas regras a partir de</label><input id="vigencia-comissao-extras" type="month" className="campo w-48" value={competencia} onChange={e => setCompetencia(e.target.value)} /><p className="text-xs text-zinc-500">O padrão é o próximo mês. Créditos, faixas e percentuais anteriores permanecem no histórico.</p></div>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      <section className="cartao space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">Comissão das assinaturas</h2>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.ativo} onChange={(e) => muda({ ativo: e.target.checked })} /> Ligada
          </label>
        </div>
        <div className="space-y-1 text-xs text-zinc-500">
          <p><b>Receita de Assinaturas</b>: mensalidades pagas no período. Menos os estornos, vira a <b>Receita Distribuível</b> (as taxas do meio de pagamento ficam com a barbearia).</p>
          <p>Cada atendimento pelo plano gera <b>Créditos de Atendimento</b> conforme o serviço (ex.: corte 40, barba 20). Valor do crédito = Receita Distribuível ÷ créditos de todos; receita atribuída ao barbeiro = créditos dele × valor do crédito.</p>
          <p>Comissão = receita atribuída × <b>{f.percentual || "0"}%</b> (percentual base) + a comissão diferenciada de cada um. Ligada, substitui a coluna “Pelo plano” das regras acima.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="pote-percentual" className="rotulo m-0">Percentual base das assinaturas (%)</label>
          <input id="pote-percentual" className="campo w-20 py-1.5 text-right" inputMode="decimal" value={f.percentual} onChange={(e) => muda({ percentual: e.target.value })} />
        </div>
        <div className="space-y-1">
          <label className="rotulo" htmlFor="pote-arredondamento">Distribuição dos centavos do pote</label>
          <select id="pote-arredondamento" className="campo" value={f.arredondamento} disabled={salvando} aria-describedby="pote-arredondamento-ajuda" onChange={e => muda({ arredondamento: e.target.value as ArredondamentoPote })}>
            <option value="LEGADO">Legado — arredondar cada comissão individualmente</option>
            <option value="MAIORES_RESTOS_V1">Maiores restos — distribuir todo o pote base</option>
          </select>
          <p id="pote-arredondamento-ajuda" className="text-xs text-zinc-500">Vale a partir da competência escolhida ao salvar. Maiores restos distribui os centavos pelas frações restantes; empates seguem o ID fixo da cadeira, em ordem crescente. Adicionais preservam a parte dos demais; incompatibilidades exigem conferência antes do fechamento. Folhas já fechadas são preservadas.</p>
        </div>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {d.assinaturas.creditos.map((s) => (
            <label key={s.servicoId} className="flex items-center justify-between gap-2 border-t border-zinc-200 py-1 text-sm">
              <span>{s.nome}</span>
              <span className="flex items-center gap-1">
                <input className="campo w-16 py-1 text-right" inputMode="numeric" value={f.creditos[s.servicoId] ?? "0"} onChange={(e) => muda({ creditos: { ...f.creditos, [s.servicoId]: e.target.value.replace(/\D/g, "") } })} />
                <span className="text-xs text-zinc-500">créditos</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="cartao space-y-3">
        <h2 className="font-semibold">Comissão de produtos</h2>
        <p className="text-xs text-zinc-500">
          Por faixa do que o barbeiro vendeu no período em cada categoria. Vale a maior faixa alcançada, sobre tudo o que ele vendeu
          (ex.: vendeu R$ 450 na loja → 10% de R$ 450). Abaixo da primeira faixa, não ganha.
        </p>
        {(["LOJA", "BAR"] as const).map((cat) => (
          <div key={cat} className="space-y-1">
            <h3 className="text-sm font-semibold">{ROTULO[cat]}</h3>
            {f.faixas.filter((x) => x.categoria === cat).map((x) => (
              <div key={x.chave} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xs text-zinc-500">a partir de R$</span>
                <input className="campo w-24 py-1 text-right" inputMode="decimal" value={x.minimo} onChange={(e) => muda({ faixas: f.faixas.map((y) => (y.chave === x.chave ? { ...y, minimo: e.target.value } : y)) })} />
                <input className="campo w-16 py-1 text-right" inputMode="decimal" value={x.percentual} onChange={(e) => muda({ faixas: f.faixas.map((y) => (y.chave === x.chave ? { ...y, percentual: e.target.value } : y)) })} />
                <span className="text-xs text-zinc-500">%</span>
                <button className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600" title="Remover faixa" onClick={() => muda({ faixas: f.faixas.filter((y) => y.chave !== x.chave) })}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="btn py-1 text-xs" onClick={() => muda({ faixas: [...f.faixas, { chave: ++seq, categoria: cat, minimo: "", percentual: "" }] })}><Plus size={13} /> Faixa</button>
          </div>
        ))}
      </section>

      <button className="btn-primario" disabled={salvando} onClick={salvar}><Save size={16} /> {salvando ? "Salvando…" : "Salvar assinaturas e produtos"}</button>

      <ComissaoDiferenciada barbeiros={d.barbeiros} inicial={d} percentualBase={d.assinaturas.percentualBps} />
    </div>
  );
}
