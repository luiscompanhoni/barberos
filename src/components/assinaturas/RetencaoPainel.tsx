"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";

type Contagem = { CANCELOU: number; DESCONTO: number; PAUSA: number; GERENTE: number };
type Ofertas = { descontoAtivo: boolean; descontoPct: number; descontoMeses: number; pausaAtiva: boolean; pausaMaxDias: number };
type Dados = {
  mes: { total: Contagem; taxaRetencaoPct: number | null; motivos: ({ motivo: string; rotulo: string } & Contagem)[] };
  pausadas: number;
  encerrando: number;
  recentes: {
    id: string; assinaturaId: string; motivo: string; detalhe: string | null; desfecho: keyof Contagem; origem: string; criadoEm: string;
    cliente: { nome: string; telefone: string }; plano: string;
  }[];
  ofertas: Ofertas;
};

export const DESFECHO: Record<keyof Contagem, { texto: string; cor: string }> = {
  CANCELOU: { texto: "Cancelou", cor: "bg-red-100 text-red-800" },
  DESCONTO: { texto: "Ficou com desconto", cor: "bg-emerald-100 text-emerald-800" },
  PAUSA: { texto: "Pausou", cor: "bg-sky-100 text-sky-800" },
  GERENTE: { texto: "Falar com o gerente", cor: "bg-amber-100 text-amber-900" },
};
const ORIGEM: Record<string, string> = { SITE: "site", BOT: "WhatsApp", PAINEL: "equipe", RECEPCAO: "recepção", BARBEIRO: "barbeiro" };
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Cancelamentos e retencoes do mes por motivo + ofertas (so o dono edita). */
export function RetencaoPainel({ dono, onAbrir, versao }: { dono: boolean; onAbrir: (assinaturaId: string) => void; versao: number }) {
  const [d, setD] = useState<Dados | null>(null);
  const [editando, setEditando] = useState(false);
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => api<Dados>("/api/assinaturas/retencao").then(setD).catch((e) => setErro(e.message)), []);
  useEffect(() => { carregar(); }, [carregar, versao]);

  if (!d) return erro ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p> : null;
  const t = d.mes.total;
  return (
    <section className="cartao space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Cancelamentos e retenção no mês</h2>
        <span className="text-xs text-zinc-500">{d.pausadas} pausado{d.pausadas === 1 ? "" : "s"} agora · {d.encerrando} encerrando no fim do ciclo</span>
        {dono && <button className="btn ml-auto text-xs" onClick={() => setEditando(true)}>Ofertas de retenção</button>}
      </div>
      <div className="grid gap-2 sm:grid-cols-5">
        <Numero rotulo="Cancelaram" valor={t.CANCELOU} ruim={t.CANCELOU > 0} />
        <Numero rotulo="Desconto" valor={t.DESCONTO} />
        <Numero rotulo="Pausa" valor={t.PAUSA} />
        <Numero rotulo="Com o gerente" valor={t.GERENTE} />
        <Numero rotulo="Retidos" valor={d.mes.taxaRetencaoPct === null ? "—" : `${d.mes.taxaRetencaoPct}%`} />
      </div>
      {d.mes.motivos.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-zinc-500">
              <tr><th className="py-1 font-medium">Motivo</th><th className="font-medium">Cancelou</th><th className="font-medium">Desconto</th><th className="font-medium">Pausa</th><th className="font-medium">Gerente</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {d.mes.motivos.map((m) => (
                <tr key={m.motivo}><td className="py-1">{m.rotulo}</td><td>{m.CANCELOU}</td><td>{m.DESCONTO}</td><td>{m.PAUSA}</td><td>{m.GERENTE}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.recentes.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-zinc-500">Últimos pedidos</p>
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {d.recentes.map((r) => (
              <li key={r.id} className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-1.5 hover:bg-zinc-50" onClick={() => onAbrir(r.assinaturaId)}>
                <span className="text-xs text-zinc-500">{dataHora(r.criadoEm)}</span>
                <span className="font-medium">{r.cliente.nome}</span>
                <span className="text-xs text-zinc-500">{formatarTelefone(r.cliente.telefone)} · {r.plano} · pelo {ORIGEM[r.origem] ?? r.origem}</span>
                <span className="text-xs">{r.motivo}{r.detalhe && r.detalhe !== r.motivo ? `: "${r.detalhe}"` : ""}</span>
                <span className={`ml-auto rounded px-2 py-0.5 text-xs ${DESFECHO[r.desfecho].cor}`}>{DESFECHO[r.desfecho].texto}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editando && <EditarOfertas atual={d.ofertas} onFechar={() => setEditando(false)} onSalvo={() => { setEditando(false); carregar(); }} />}
    </section>
  );
}

function Numero(p: { rotulo: string; valor: number | string; ruim?: boolean }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-2">
      <p className="text-xs text-zinc-500">{p.rotulo}</p>
      <p className={`text-xl font-semibold ${p.ruim ? "text-red-700" : ""}`}>{p.valor}</p>
    </div>
  );
}

function EditarOfertas(p: { atual: Ofertas; onFechar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState(p.atual);
  const [erro, setErro] = useState("");
  const num = (k: keyof Ofertas) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/assinaturas/retencao", { method: "PUT", body: f });
      p.onSalvo();
    } catch (x) {
      setErro((x as Error).message);
    }
  }
  return (
    <Modal titulo="Ofertas de retenção" onFechar={p.onFechar}>
      <form onSubmit={salvar} className="space-y-4 text-sm">
        <p className="text-xs text-zinc-500">Oferecidas quando o cliente tenta cancelar pelo site ou pelo WhatsApp. Preço → desconto; não estou usando ou vou viajar → pausa; insatisfeito ou horários → gerente; mudou de cidade → cancela direto.</p>
        <fieldset className="space-y-2 rounded-lg border border-zinc-200 p-3">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.descontoAtivo} onChange={(e) => setF({ ...f, descontoAtivo: e.target.checked })} /> Oferecer desconto (motivo preço)</label>
          <div className="grid grid-cols-2 gap-2">
            <label className="rotulo">Desconto (%)<input className="campo mt-1" type="number" min={1} max={100} value={f.descontoPct} onChange={num("descontoPct")} /></label>
            <label className="rotulo">Por quantas mensalidades<input className="campo mt-1" type="number" min={1} max={12} value={f.descontoMeses} onChange={num("descontoMeses")} /></label>
          </div>
        </fieldset>
        <fieldset className="space-y-2 rounded-lg border border-zinc-200 p-3">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.pausaAtiva} onChange={(e) => setF({ ...f, pausaAtiva: e.target.checked })} /> Permitir pausar o plano</label>
          <label className="rotulo">Máximo de dias de pausa<input className="campo mt-1" type="number" min={7} max={180} value={f.pausaMaxDias} onChange={num("pausaMaxDias")} /></label>
          <p className="text-xs text-zinc-500">O cliente escolhe entre 30, 60 ou 90 dias, até esse máximo.</p>
        </fieldset>
        <p className="text-xs text-zinc-500">Cada cliente pode ganhar o desconto uma vez por ano e pausar uma vez a cada 6 meses. Assinaturas da Celcash e do CashBarber não aplicam desconto/pausa sozinhas: a oferta vira &quot;falar com o gerente&quot;.</p>
        {erro && <p className="text-red-600">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={p.onFechar}>Fechar</button>
          <button className="btn-primario">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}
