"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Save } from "lucide-react";
import { SeloNivel, type Nivel } from "@/components/checklist/SeloNivel";
import { api, centavosParaTexto, paraCentavos, reais } from "@/lib/cliente-api";
import { useAcesso } from "@/components/AcessoContexto";

type Func = {
  id: string; nome: string; telefone: string; funcao: string; ativo: boolean; cargo: string | null; salarioCentavos: number;
  salarioAtualCentavos: number; salarioHomologado: boolean;
  pix: { mascara: string; tipo: string | null; estado: string }; revisaoPix: number;
  admissao: string | null; barbeiroId: string | null; pontos: number; nivel: Nivel;
};
type Dados = { barbeiros: { id: string; nome: string }[]; funcionarios: Func[]; competenciaAtual: string; competenciaSalarioPadrao: string };
type Form = { cargo: string; salario: string; competenciaSalario: string; salarioAlterado: boolean; chavePix: string; removerPix: boolean; admissao: string; barbeiroId: string };

const FUNCAO: Record<string, string> = { DIARISTA: "Diarista", BARBEIRO: "Barbeiro", GERENTE: "Gerente" };
const paraForm = (f: Func, competenciaSalario: string): Form => ({ cargo: f.cargo ?? "", salario: centavosParaTexto(f.salarioCentavos), competenciaSalario, salarioAlterado: false, chavePix: "", removerPix: false, admissao: f.admissao ?? "", barbeiroId: f.barbeiroId ?? "" });

/** Fichas dos funcionarios: cargo, salario, Pix, admissao e o barbeiro da agenda (comissao). */
export function Funcionarios() {
  const dono = useAcesso().papel === "DONO";
  const [d, setD] = useState<Dados | null>(null);
  const [forms, setForms] = useState<Record<string, Form>>({});
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);

  function aplicar(x: Dados) {
    setD(x);
    setForms(Object.fromEntries(x.funcionarios.map((f) => [f.id, paraForm(f, x.competenciaSalarioPadrao)])));
  }
  useEffect(() => { api<Dados>("/api/rh/funcionarios").then(aplicar).catch((e) => setMsg({ t: e.message, erro: true })); }, []);

  async function salvar(f: Func) {
    const v = forms[f.id];
    const salario = paraCentavos(v.salario || "0");
    if (Number.isNaN(salario)) return setMsg({ t: "Salário inválido.", erro: true });
    setMsg(null);
    try {
      aplicar(await api<Dados>("/api/rh/funcionarios", {
        method: "PATCH",
        body: { id: f.id, cargo: v.cargo.trim() || null, salarioCentavos: salario,
          ...(v.salarioAlterado ? { competenciaSalario: v.competenciaSalario } : {}),
          ...(v.removerPix || v.chavePix.trim() ? { chavePix: v.removerPix ? null : v.chavePix.trim(), revisaoPix: f.revisaoPix } : {}),
          admissao: v.admissao || null, barbeiroId: v.barbeiroId || null },
      }));
      setMsg({ t: `Ficha de ${f.nome} salva.` });
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    }
  }

  if (!d) return <div className="cartao text-sm text-zinc-500">{msg?.t ?? "Carregando…"}</div>;
  const muda = (id: string, x: Partial<Form>) => setForms((fs) => ({ ...fs, [id]: { ...fs[id], ...x } }));
  return (
    <div className="space-y-3">
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}
      <p className="text-sm text-zinc-500">O cadastro de pessoas é o mesmo do checklist. Para incluir alguém, vá em <Link href="/checklist" className="font-semibold text-ouro underline">Checklist → Tarefas e pessoas</Link>.</p>
      {d.funcionarios.length === 0 && <div className="cartao text-sm text-zinc-500">Ninguém cadastrado ainda.</div>}
      <div className="grid gap-3 lg:grid-cols-2">
        {d.funcionarios.map((f) => {
          const v = forms[f.id];
          if (!v) return null;
          return (
            <section key={f.id} className={`cartao space-y-3 ${f.ativo ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{f.nome}{!f.ativo && <span className="ml-2 text-xs text-zinc-500">(inativo)</span>}</h2>
                  <p className="text-xs text-zinc-500">{FUNCAO[f.funcao]} no checklist · {f.pontos} pts · salário atual {reais(f.salarioAtualCentavos)}</p>
                  {!f.salarioHomologado && <p className="text-xs text-amber-700">Valor legado sem histórico mensal homologado.</p>}
                </div>
                <SeloNivel nivel={f.nivel} pequeno />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div><label className="rotulo">Cargo</label><input className="campo" placeholder="Ex.: Barbeiro, Recepcionista" value={v.cargo} onChange={(e) => muda(f.id, { cargo: e.target.value })} /></div>
                <div><label className="rotulo" htmlFor={`salario-${f.id}`}>Salário base (R$)</label><input id={`salario-${f.id}`} className="campo" inputMode="decimal" value={v.salario} onChange={(e) => muda(f.id, { salario: e.target.value, salarioAlterado: true })} /></div>
                <div><label className="rotulo" htmlFor={`vigencia-${f.id}`}>Salário válido a partir de</label><input id={`vigencia-${f.id}`} type="month" min={d.competenciaAtual} className="campo" value={v.competenciaSalario} onChange={e => muda(f.id, { competenciaSalario: e.target.value, salarioAlterado: true })} /><p className="text-xs text-zinc-500">Padrão: próximo mês. Selecione o mês atual somente para aplicar a mudança agora.</p></div>
                <div>
                  <p className="rotulo">Pix cadastrado: {f.pix.mascara}{f.pix.tipo ? ` · ${f.pix.tipo}` : ""}</p>
                  {f.pix.estado === "LEGADO_PENDENTE" && <p className="text-xs text-amber-700">Conferência da proteção pendente. A chave foi preservada.</p>}
                  {dono && <>
                    <label className="rotulo" htmlFor={`pix-${f.id}`}>Nova chave Pix</label>
                    <input id={`pix-${f.id}`} className="campo" autoComplete="off" placeholder="Deixe vazio para manter a chave" value={v.chavePix} disabled={v.removerPix} onChange={(e) => muda(f.id, { chavePix: e.target.value })} />
                    {f.pix.estado !== "AUSENTE" && <label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" checked={v.removerPix} onChange={e => muda(f.id, { removerPix: e.target.checked, chavePix: "" })} /> Remover chave cadastrada ao salvar</label>}
                  </>}
                </div>
                <div><label className="rotulo">Admissão</label><input type="date" className="campo" value={v.admissao} onChange={(e) => muda(f.id, { admissao: e.target.value })} /></div>
                <div className="sm:col-span-2">
                  <label className="rotulo">Barbeiro da agenda (para a comissão)</label>
                  <select className="campo" value={v.barbeiroId} onChange={(e) => muda(f.id, { barbeiroId: e.target.value })}>
                    <option value="">Não atende na agenda</option>
                    {d.barbeiros.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
                  </select>
                </div>
              </div>
              <button className="btn" onClick={() => salvar(f)}><Save size={15} /> Salvar ficha</button>
            </section>
          );
        })}
      </div>
    </div>
  );
}
