"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { api, centavosParaTexto, paraCentavos, reais } from "@/lib/cliente-api";

type Tipo = "PERCENTUAL" | "FIXO";
type Regra = { avulsoTipo: Tipo; avulsoValor: number; planoTipo: Tipo; planoValor: number };
type Dados = {
  sugestao: Regra;
  barbeiros: { id: string; nome: string }[];
  servicos: (Regra & { id: string; nome: string; precoCentavos: number; salvo: boolean })[];
  excecoes: (Regra & { servicoId: string; barbeiroId: string })[];
};
// No formulario os valores ficam como texto: "40" (%) ou "15,00" (R$).
type RegraForm = { avulsoTipo: Tipo; avulso: string; planoTipo: Tipo; plano: string };
type Excecao = RegraForm & { chave: string; servicoId: string; barbeiroId: string };

const paraTexto = (t: Tipo, v: number) => (t === "FIXO" ? centavosParaTexto(v) : String(v / 100).replace(".", ","));
const paraValor = (t: Tipo, s: string) => (t === "FIXO" ? paraCentavos(s || "0") : Math.round(Number((s || "0").replace(",", ".")) * 100));
const paraForm = (r: Regra): RegraForm => ({ avulsoTipo: r.avulsoTipo, avulso: paraTexto(r.avulsoTipo, r.avulsoValor), planoTipo: r.planoTipo, plano: paraTexto(r.planoTipo, r.planoValor) });
function paraRegra(f: RegraForm): Regra | null {
  const r = { avulsoTipo: f.avulsoTipo, avulsoValor: paraValor(f.avulsoTipo, f.avulso), planoTipo: f.planoTipo, planoValor: paraValor(f.planoTipo, f.plano) };
  return Number.isFinite(r.avulsoValor) && Number.isFinite(r.planoValor) && r.avulsoValor >= 0 && r.planoValor >= 0 ? r : null;
}
let seq = 0;


/** Regras de comissao: geral por servico (avulso e plano) e excecoes por barbeiro. */
export function ComissoesConfig() {
  const [d, setD] = useState<Dados | null>(null);
  const [gerais, setGerais] = useState<Record<string, RegraForm>>({});
  const [excecoes, setExcecoes] = useState<Excecao[]>([]);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);

  function aplicar(x: Dados) {
    setD(x);
    setGerais(Object.fromEntries(x.servicos.map((s) => [s.id, paraForm(s)])));
    setExcecoes(x.excecoes.map((e) => ({ ...paraForm(e), chave: `e${++seq}`, servicoId: e.servicoId, barbeiroId: e.barbeiroId })));
  }
  useEffect(() => { api<Dados>("/api/rh/comissoes").then(aplicar).catch((e) => setMsg({ t: e.message, erro: true })); }, []);

  async function salvar() {
    if (!d) return;
    const gs = d.servicos.map((s) => ({ servicoId: s.id, regra: paraRegra(gerais[s.id]) }));
    const es = excecoes.map((e) => ({ servicoId: e.servicoId, barbeiroId: e.barbeiroId, regra: paraRegra(e) }));
    if ([...gs, ...es].some((x) => !x.regra) || es.some((e) => !e.servicoId || !e.barbeiroId)) return setMsg({ t: "Confira os valores: tem campo inválido ou exceção sem barbeiro/serviço.", erro: true });
    setSalvando(true);
    setMsg(null);
    try {
      aplicar(await api<Dados>("/api/rh/comissoes", {
        method: "PUT",
        body: { gerais: gs.map((g) => ({ servicoId: g.servicoId, ...g.regra! })), excecoes: es.map((e) => ({ servicoId: e.servicoId, barbeiroId: e.barbeiroId, ...e.regra! })) },
      }));
      setMsg({ t: "Regras de comissão salvas." });
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    } finally {
      setSalvando(false);
    }
  }

  if (!d) return <div className="cartao text-sm text-zinc-500">{msg?.t ?? "Carregando…"}</div>;
  const naoSalvos = d.servicos.filter((s) => !s.salvo).length;
  return (
    <div className="space-y-4">
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}
      {naoSalvos > 0 && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          {naoSalvos} serviço(s) ainda sem regra salva: preenchemos com a sugestão (avulso {d.sugestao.avulsoValor / 100}% e plano {reais(d.sugestao.planoValor)} fixo por corte). Ajuste e clique em salvar — sem regra salva, o atendimento não gera comissão.
        </p>
      )}
      <section className="cartao space-y-2 overflow-x-auto">
        <h2 className="font-semibold">Regra geral por serviço</h2>
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-xs text-zinc-500"><th className="py-1">Serviço</th><th>Tabela</th><th>Avulso</th><th>Pelo plano</th></tr></thead>
          <tbody>
            {d.servicos.map((s) => (
              <tr key={s.id} className="border-t border-zinc-200">
                <td className="py-1.5 font-medium">{s.nome}{!s.salvo && <span className="ml-1 text-[10px] text-amber-700">sugestão</span>}</td>
                <td className="text-zinc-500">{reais(s.precoCentavos)}</td>
                {(["avulso", "plano"] as const).map((lado) => (
                  <td key={lado}>{gerais[s.id] && <Lado f={gerais[s.id]} lado={lado} preco={s.precoCentavos} muda={(x) => setGerais((g) => ({ ...g, [s.id]: { ...g[s.id], ...x } }))} />}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-zinc-500">Avulso: % do valor cobrado no atendimento. Plano: % do preço de tabela do serviço ou R$ fixo por corte (o cliente do plano não paga no dia).</p>
      </section>

      <section className="cartao space-y-2">
        <h2 className="font-semibold">Exceções por barbeiro (opcional)</h2>
        <p className="text-xs text-zinc-500">Quando um barbeiro tem uma regra diferente num serviço, ela substitui a regra geral.</p>
        {excecoes.map((e) => (
          <div key={e.chave} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 p-2">
            <select className="campo w-40 py-1.5" value={e.barbeiroId} onChange={(ev) => setExcecoes((xs) => xs.map((x) => (x.chave === e.chave ? { ...x, barbeiroId: ev.target.value } : x)))}>
              <option value="">Barbeiro…</option>
              {d.barbeiros.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
            <select className="campo w-48 py-1.5" value={e.servicoId} onChange={(ev) => setExcecoes((xs) => xs.map((x) => (x.chave === e.chave ? { ...x, servicoId: ev.target.value } : x)))}>
              <option value="">Serviço…</option>
              {d.servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
            {(["avulso", "plano"] as const).map((lado) => (
              <span key={lado} className="flex items-center gap-1">
                <span className="text-xs text-zinc-500">{lado === "avulso" ? "Avulso" : "Plano"}</span>
                <Lado f={e} lado={lado} preco={d.servicos.find((s) => s.id === e.servicoId)?.precoCentavos ?? 0} muda={(x) => setExcecoes((xs) => xs.map((y) => (y.chave === e.chave ? { ...y, ...x } : y)))} />
              </span>
            ))}
            <button className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600" title="Remover" onClick={() => setExcecoes((xs) => xs.filter((x) => x.chave !== e.chave))}><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="btn" onClick={() => setExcecoes((xs) => [...xs, { ...paraForm(d.sugestao), chave: `e${++seq}`, servicoId: "", barbeiroId: "" }])}><Plus size={15} /> Adicionar exceção</button>
      </section>

      <button className="btn-primario" disabled={salvando} onClick={salvar}><Save size={16} /> {salvando ? "Salvando…" : "Salvar regras"}</button>
    </div>
  );
}

/** Tipo (% ou R$) e valor de um lado da regra (avulso ou plano), com o exemplo em reais. */
function Lado({ f, lado, muda, preco }: { f: RegraForm; lado: "avulso" | "plano"; muda: (x: Partial<RegraForm>) => void; preco: number }) {
  const tk = lado === "avulso" ? "avulsoTipo" : "planoTipo";
  const t = f[tk];
  const v = paraValor(t, f[lado]);
  return (
    <div className="flex items-center gap-1 py-1">
      <select className="campo w-16 px-2 py-1.5 text-xs" value={t} onChange={(e) => muda({ [tk]: e.target.value as Tipo })}>
        <option value="PERCENTUAL">%</option>
        <option value="FIXO">R$</option>
      </select>
      <input className="campo w-20 py-1.5 text-right" inputMode="decimal" value={f[lado]} onChange={(e) => muda({ [lado]: e.target.value })} />
      {t === "PERCENTUAL" && Number.isFinite(v) && <span className="text-[11px] text-zinc-500">= {reais(Math.round((preco * v) / 10000))}</span>}
    </div>
  );
}
