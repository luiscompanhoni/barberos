"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Save, ShieldCheck } from "lucide-react";
import { api } from "@/lib/cliente-api";

type Papel = "GERENTE" | "RECEPCAO" | "BARBEIRO";
type Celula = { permitido: boolean; padrao: boolean } | null;
type Linha = { chave: string; rotulo: string; detalhe: string; papeis: Record<Papel, Celula> };

const PAPEIS: { k: Papel; r: string }[] = [{ k: "GERENTE", r: "Gerente" }, { k: "RECEPCAO", r: "Recepção" }, { k: "BARBEIRO", r: "Barbeiro" }];

/** Matriz de permissoes por acao (so o dono): o que gerente, recepcao e barbeiro podem fazer. */
export function PermissoesTela() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [salvo, setSalvo] = useState<Linha[] | null>(null);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    api<Linha[]>("/api/permissoes").then((r) => { setLinhas(r); setSalvo(r); }).catch((e) => setMsg({ t: e.message, erro: true }));
  }, []);
  useEffect(carregar, [carregar]);

  const marcar = (chave: string, papel: Papel, v: boolean) =>
    setLinhas((ls) => ls && ls.map((l) => (l.chave === chave && l.papeis[papel] ? { ...l, papeis: { ...l.papeis, [papel]: { ...l.papeis[papel]!, permitido: v } } } : l)));
  const padrao = () => setLinhas((ls) => ls && ls.map((l) => ({ ...l, papeis: Object.fromEntries(PAPEIS.map(({ k }) => [k, l.papeis[k] && { ...l.papeis[k]!, permitido: l.papeis[k]!.padrao }])) as Record<Papel, Celula> })));
  const mudou = JSON.stringify(linhas) !== JSON.stringify(salvo);

  async function salvar() {
    if (!linhas) return;
    setOcupado(true);
    try {
      const corpo = Object.fromEntries(PAPEIS.map(({ k }) => [k, Object.fromEntries(linhas.filter((l) => l.papeis[k]).map((l) => [l.chave, l.papeis[k]!.permitido]))]));
      const r = await api<Linha[]>("/api/permissoes", { method: "PUT", body: corpo });
      setLinhas(r); setSalvo(r);
      setMsg({ t: "Permissões salvas. Valem na hora para quem já está logado." });
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="cartao space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-ouro" />
        <h2 className="font-semibold">Permissões</h2>
      </div>
      <p className="text-sm text-zinc-500">
        O dono pode tudo, sempre. Aqui você escolhe o que o gerente, a recepção e os barbeiros podem fazer nas ações sensíveis.
        Acessos, permissões, WhatsApp e auditoria são só do dono. Toda mudança fica na auditoria.
      </p>
      {!linhas ? <p className="text-sm text-zinc-500">Carregando...</p> : (
        <div className="divide-y divide-zinc-200">
          <div className="flex items-end gap-2 pb-2 text-xs font-semibold text-zinc-500">
            <span className="flex-1">Ação</span>
            {PAPEIS.map((p) => <span key={p.k} className="w-14 text-center sm:w-20">{p.r}</span>)}
          </div>
          {linhas.map((l) => (
            <div key={l.chave} className="flex items-center gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{l.rotulo}</p>
                <p className="text-xs text-zinc-500">{l.detalhe}</p>
              </div>
              {PAPEIS.map((p) => {
                const c = l.papeis[p.k];
                return (
                  <span key={p.k} className="flex w-14 justify-center sm:w-20">
                    {c ? (
                      <input type="checkbox" className="h-5 w-5 accent-[#d3ab45]" checked={c.permitido} aria-label={`${l.rotulo}: ${p.r}`}
                        title={c.permitido === c.padrao ? "Padrão" : "Mudado (o padrão é " + (c.padrao ? "sim" : "não") + ")"}
                        onChange={(e) => marcar(l.chave, p.k, e.target.checked)} />
                    ) : <span className="text-zinc-400" title="Não se aplica a esse papel">—</span>}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primario" disabled={!mudou || ocupado} onClick={salvar}><Save size={15} /> {ocupado ? "Salvando…" : "Salvar permissões"}</button>
        <button className="btn" disabled={!linhas || ocupado} onClick={padrao}><RotateCcw size={15} /> Voltar ao padrão</button>
      </div>
      {msg && <p className={`text-sm ${msg.erro ? "text-red-600" : "text-emerald-700"}`}>{msg.t}</p>}
    </section>
  );
}
