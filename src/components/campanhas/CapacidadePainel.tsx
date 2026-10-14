"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/lib/cliente-api";
import type { Capacidade } from "@/lib/campanhas/capacidade";

const horas = (min: number) => `${(min / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const diaCurto = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Horarios livres nos proximos 3, 7 e 14 dias, por barbeiro, com os horarios ociosos. Avisa a capacidade para a campanha. */
export function CapacidadePainel({ onCarregar }: { onCarregar?: (c: Capacidade) => void }) {
  const [c, setC] = useState<Capacidade | null>(null);
  const [erro, setErro] = useState("");
  const [dias, setDias] = useState(7);
  const [aberto, setAberto] = useState<string | null>(null);
  useEffect(() => {
    api<Capacidade>("/api/campanhas/capacidade").then((x) => { setC(x); onCarregar?.(x); }).catch((e) => setErro(e.message));
  }, [onCarregar]);

  const h = c?.horizontes.find((x) => x.dias === dias);
  return (
    <section className="cartao space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Capacidade da agenda</h2>
        <div className="ml-auto flex gap-1">
          {[3, 7, 14].map((n) => <button key={n} className={dias === n ? "btn-primario py-1 text-xs" : "btn py-1 text-xs"} onClick={() => setDias(n)}>{n} dias</button>)}
        </div>
      </div>
      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {!c || !h ? !erro && <p className="text-sm text-zinc-500">Calculando…</p> : (
        <>
          <div className="cartao-destaque">
            <p className="text-sm">Capacidade disponível para aproximadamente</p>
            <p className="text-3xl font-black text-ouro">{h.vagas} novos agendamentos</p>
            <p className="text-xs text-zinc-500">
              Nos próximos {dias} dias: {horas(h.livresMin)} livres de {horas(h.capacidadeMin)} de agenda aberta ({pct(h.ocupacao)} ocupada).
              Vaga = {c.servico.nome} ({c.servico.duracaoMin} min{c.intervaloMin ? ` + ${c.intervaloMin} min de intervalo` : ""}), o serviço que mais sai.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 font-semibold">Barbeiro</th>
                <th className="py-1 text-right font-semibold">Livres</th>
                <th className="py-1 text-right font-semibold">Vagas</th>
                <th className="py-1 text-right font-semibold">Ocupação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {h.porBarbeiro.map((b) => {
                const ociosos = (c.ociosos.find((o) => o.id === b.id)?.janelas ?? []).filter((j) => diasDesde(c.hoje, j.data) < dias);
                return (
                  <Fragment key={b.id}>
                    <tr className="cursor-pointer hover:bg-zinc-50" onClick={() => setAberto(aberto === b.id ? null : b.id)}>
                      <td className="py-2">
                        <span className="inline-flex items-center gap-1 font-semibold">
                          {aberto === b.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{b.nome}
                        </span>
                        {b.duracaoMin !== c.servico.duracaoMin && <span className="text-xs text-zinc-500"> ({b.duracaoMin} min)</span>}
                      </td>
                      <td className="py-2 text-right">{horas(b.livresMin)}</td>
                      <td className="py-2 text-right font-semibold">{b.vagas}</td>
                      <td className="py-2 text-right">{pct(b.ocupacao)}</td>
                    </tr>
                    {aberto === b.id && (
                      <tr>
                        <td colSpan={4} className="pb-3">
                          {ociosos.length === 0 ? <p className="text-xs text-zinc-500">Sem horário ocioso nesse período.</p> : (
                            <ul className="grid gap-1 text-xs text-zinc-600 sm:grid-cols-2">
                              {ociosos.map((j) => (
                                <li key={`${j.data}${j.inicio}`} className="rounded-lg bg-zinc-100 px-2 py-1">
                                  <span className="first-letter:uppercase">{diaCurto(j.data)}</span> · {j.inicio}–{j.fim} · {j.vagas} vaga{j.vagas === 1 ? "" : "s"}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-zinc-500">Toque no barbeiro para ver os horários ociosos. Conta só daqui a {c.antecedenciaMin} min em diante (antecedência mínima), fora de folgas e agenda fechada.</p>
        </>
      )}
    </section>
  );
}

const diasDesde = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
