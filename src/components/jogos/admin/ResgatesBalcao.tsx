"use client";

/**
 * Recepcao: busca o premio pelo codigo (ou ve todos os abertos), entrega brinde e cancela (so gerencia, com motivo).
 * Servico gratis e desconto sao validados pela comanda do cliente (o desconto entra nela).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, Check, Search } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { descricaoPremio, ROTULO_STATUS } from "@/lib/jogos/tipos";
import { IconePremio } from "../kit/IconePremio";
import type { JogadaPainel, PremioBalcao } from "./tipos";

const quando = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export function ResgatesBalcao({ podeCancelar }: { podeCancelar: boolean }) {
  const [codigo, setCodigo] = useState("");
  const [lista, setLista] = useState<PremioBalcao[] | null>(null);
  const [buscado, setBuscado] = useState(false);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);

  const todos = useCallback(() => { setBuscado(false); api<PremioBalcao[]>("/api/premios").then(setLista).catch((e) => setMsg({ t: e.message, erro: true })); }, []);
  useEffect(() => { api<PremioBalcao[]>("/api/premios").then(setLista).catch((e) => setMsg({ t: e.message, erro: true })); }, []);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    if (!codigo.trim()) return todos();
    setMsg(null);
    try { setLista(await api<PremioBalcao[]>(`/api/premios?codigo=${encodeURIComponent(codigo)}`)); setBuscado(true); } catch (x) { setMsg({ t: (x as Error).message, erro: true }); }
  }
  async function acao(p: PremioBalcao, corpo: Record<string, unknown>, ok: string) {
    setMsg(null);
    try {
      await api(`/api/premios/${p.id}`, { method: "POST", body: corpo });
      setMsg({ t: ok });
      if (buscado) setLista(await api<PremioBalcao[]>(`/api/premios?codigo=${encodeURIComponent(p.codigo)}`)); else todos();
    } catch (x) { setMsg({ t: (x as Error).message, erro: true }); }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={buscar} className="cartao flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label className="rotulo">Código do prêmio</label>
          <input className="campo font-mono uppercase tracking-wider" placeholder="BB-XXXXXX" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        </div>
        <button className="btn-primario px-5 py-2.5"><Search size={15} /> Conferir</button>
        {buscado && <button type="button" className="btn" onClick={() => { setCodigo(""); todos(); }}>Ver todos</button>}
      </form>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      <section className="cartao">
        <h2 className="mb-2 font-semibold">{buscado ? "Resultado" : "Prêmios para usar"}</h2>
        {!lista ? <p className="text-sm text-zinc-500">Carregando…</p> : !lista.length ? <p className="text-sm text-zinc-500">{buscado ? "Nenhum prêmio com esse código." : "Nenhum prêmio esperando."}</p> : (
          <ul className="divide-y divide-zinc-200">
            {lista.map((p) => {
              const aberto = p.status === "DISPONIVEL" || p.status === "RESERVADO";
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <IconePremio icone={p.icone} tamanho={26} cor="#d3ab45" />
                  <div className="min-w-0 flex-1">
                    <p><b>{p.tipo === "CREDITO" ? reais(p.valorCentavos) : p.rotulo}</b> · {p.cliente.nome} <span className="font-mono text-xs text-zinc-500">{p.codigo}</span></p>
                    <p className="text-xs text-zinc-500">
                      {descricaoPremio(p)} · <b className={aberto ? "text-ouro" : ""}>{ROTULO_STATUS[p.status]}</b>
                      {p.agendamento && p.status === "RESERVADO" && <> · horário {quando(p.agendamento.inicio)}</>}
                      {p.expiraEm && aberto && <> · vale até {quando(p.expiraEm).slice(0, 5)}</>}
                      {p.descontoAplicadoCentavos > 0 && <> · descontou {reais(p.descontoAplicadoCentavos)}</>}
                    </p>
                  </div>
                  {aberto && p.tipo === "BRINDE" && <button className="btn py-1 text-xs" onClick={() => acao(p, { acao: "validar", codigo: p.codigo }, `${p.rotulo} entregue a ${p.cliente.nome}.`)}><Check size={14} /> Entregar brinde</button>}
                  {aberto && (p.tipo === "SERVICO" || p.tipo === "DESCONTO") && <Link className="btn py-1 text-xs" href="/comandas">Validar na comanda</Link>}
                  {p.status === "UTILIZADO" && p.tipo === "BRINDE" && <button className="btn py-1 text-xs" onClick={() => acao(p, { acao: "desfazer" }, "Entrega desfeita.")}>Desfazer</button>}
                  {podeCancelar && aberto && (
                    <button className="btn-perigo py-1 text-xs" onClick={() => { const m = prompt(`Motivo para cancelar "${p.rotulo}" de ${p.cliente.nome}:`); if (m) void acao(p, { acao: "cancelar", motivo: m }, "Prêmio cancelado."); }}>
                      <Ban size={14} /> Cancelar
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Ultimas jogadas (com IP e aparelho, para conferir tentativas de fraude). */
export function JogadasRecentes() {
  const [js, setJs] = useState<JogadaPainel[] | null>(null);
  useEffect(() => { api<JogadaPainel[]>("/api/jogos/jogadas?limite=80").then(setJs).catch(() => setJs([])); }, []);
  if (!js) return <p className="cartao text-sm text-zinc-500">Carregando…</p>;
  return (
    <section className="cartao overflow-x-auto">
      {!js.length ? <p className="text-sm text-zinc-500">Ninguém jogou ainda.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500"><th className="py-1">Quando</th><th>Cliente</th><th>Jogo</th><th>Origem</th><th>Resultado</th><th>IP / aparelho</th></tr></thead>
          <tbody className="divide-y divide-zinc-200">
            {js.map((j) => (
              <tr key={j.id} className="align-top">
                <td className="whitespace-nowrap py-1.5 text-xs text-zinc-500">{quando(j.criadoEm)}</td>
                <td>{j.cliente.nome}</td>
                <td className="text-xs">{j.jogoId}</td>
                <td className="text-xs">{j.origem.toLowerCase()}</td>
                <td>{j.premios.length ? j.premios.map((p) => `${p.rotulo} (${ROTULO_STATUS[p.status].toLowerCase()})`).join(", ") : <span className="text-zinc-500">sem prêmio</span>}{!j.revelada && <span className="ml-1 text-[10px] text-amber-700">não revelada</span>}</td>
                <td className="max-w-56 truncate text-[11px] text-zinc-500" title={j.dispositivo ?? ""}>{j.ip ?? "—"} · {j.dispositivo?.slice(0, 40) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
