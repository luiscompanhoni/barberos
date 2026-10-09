"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, CreditCard, Link2, MessageCircle, Plus, QrCode, RefreshCw } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { BotaoCopiar, NovoLinkModal, type LinkPainel } from "./NovoLinkModal";

type Filtro = "PENDENTE" | "PAGO" | "FECHADO" | "TODOS";
const FILTROS: { k: Filtro; r: string }[] = [{ k: "PENDENTE", r: "Em aberto" }, { k: "PAGO", r: "Pagos" }, { k: "FECHADO", r: "Cancelados/expirados" }, { k: "TODOS", r: "Todos" }];
const SELO: Record<LinkPainel["status"], { r: string; c: string }> = {
  PENDENTE: { r: "Em aberto", c: "bg-amber-50 text-amber-800" },
  PAGO: { r: "Pago", c: "bg-emerald-50 text-emerald-700" },
  CANCELADO: { r: "Cancelado", c: "bg-zinc-100 text-zinc-600" },
  EXPIRADO: { r: "Expirado", c: "bg-zinc-100 text-zinc-600" },
};
const quando = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Links de pagamento: criar, copiar, mandar no WhatsApp, acompanhar e cancelar. */
export function LinksPagamentoTela() {
  const [links, setLinks] = useState<LinkPainel[] | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("PENDENTE");
  const [novo, setNovo] = useState(false);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [agora] = useState(() => Date.now());

  const carregar = useCallback(() => api<{ links: LinkPainel[] }>("/api/financeiro/links").then((r) => setLinks(r.links)).catch((e) => setMsg({ t: e.message, erro: true })), []);
  useEffect(() => { carregar(); }, [carregar]);

  async function agir(l: LinkPainel, acao: "cancelar" | "enviar" | "conferir") {
    if (acao === "cancelar" && !window.confirm(`Cancelar o link de ${reais(l.valorCentavos)} para ${l.nome}?`)) return;
    setMsg(null);
    setOcupado(l.id);
    try {
      const r = await api<{ links: LinkPainel[]; envio: { ok: boolean; erro: string | null } | null }>(`/api/financeiro/links/${l.id}`, { method: "PATCH", body: { acao } });
      setLinks(r.links);
      if (acao === "enviar") setMsg(r.envio?.ok ? { t: "Link enviado no WhatsApp. ✅" } : { t: `Não foi possível enviar: ${r.envio?.erro ?? "erro"}`, erro: true });
      else if (acao === "cancelar") setMsg({ t: "Link cancelado." });
      else setMsg({ t: r.links.find((x) => x.id === l.id)?.status === "PAGO" ? "Pagamento confirmado. ✅" : "Ainda não foi pago." });
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    } finally {
      setOcupado(null);
    }
  }

  const lista = (links ?? []).filter((l) => filtro === "TODOS" || (filtro === "FECHADO" ? l.status === "CANCELADO" || l.status === "EXPIRADO" : l.status === filtro));
  const emAberto = (links ?? []).filter((l) => l.status === "PENDENTE");
  const pagos30 = (links ?? []).filter((l) => l.status === "PAGO" && l.pagoEm && agora - Date.parse(l.pagoEm) < 30 * 86_400_000);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="cartao"><p className="rotulo">Em aberto</p><p className="text-xl font-black">{reais(emAberto.reduce((t, l) => t + l.valorCentavos, 0))}</p><p className="text-xs text-zinc-500">{emAberto.length} link(s)</p></div>
        <div className="cartao"><p className="rotulo">Recebido (30 dias)</p><p className="text-xl font-black text-ouro">{reais(pagos30.reduce((t, l) => t + l.valorCentavos, 0))}</p><p className="text-xs text-zinc-500">{pagos30.length} pagamento(s) · entra na conciliação como online</p></div>
        <button className="btn-primario py-3 text-base sm:h-full" onClick={() => setNovo(true)}><Plus size={18} /> Novo link</button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => <button key={f.k} className={filtro === f.k ? "btn-primario" : "btn"} onClick={() => setFiltro(f.k)}>{f.r}</button>)}
        <button className="btn ml-auto" onClick={carregar} aria-label="Atualizar"><RefreshCw size={15} /></button>
      </div>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      {links === null ? (
        <p className="text-sm text-zinc-500">Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="cartao py-10 text-center text-sm text-zinc-500">
          <Link2 className="mx-auto mb-2 text-zinc-400" />
          Nenhum link {filtro === "PENDENTE" ? "em aberto" : "aqui"}. Crie um para cobrar por Pix ou cartão à distância.
        </div>
      ) : (
        <ul className="space-y-2">
          {lista.map((l) => (
            <li key={l.id} className="cartao space-y-2">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{l.descricao}{l.comandaNumero ? <span className="ml-1 text-xs font-normal text-zinc-500">· comanda #{l.comandaNumero}</span> : null}</p>
                  <p className="text-xs text-zinc-500">{l.nome} · criado {quando(l.criadoEm)}{l.status === "PENDENTE" && ` · vale até ${quando(l.expiraEm)}`}</p>
                </div>
                <div className="text-right">
                  <p className="font-black">{reais(l.valorCentavos)}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${SELO[l.status].c}`}>{SELO[l.status].r}</span>
                </div>
              </div>
              {l.status === "PAGO" && (
                <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                  {l.forma === "CARTAO" ? <CreditCard size={13} /> : <QrCode size={13} />}
                  {l.forma === "CARTAO" ? `Cartão${l.parcelas && l.parcelas > 1 ? ` em ${l.parcelas}x` : ""}` : "Pix"} · pago {l.pagoEm ? quando(l.pagoEm) : ""}
                </p>
              )}
              {l.status === "PENDENTE" && (
                <div className="flex flex-wrap gap-2">
                  <BotaoCopiar texto={l.url} className="btn py-1.5 text-xs" />
                  <button className="btn py-1.5 text-xs" disabled={ocupado === l.id} onClick={() => agir(l, "enviar")}><MessageCircle size={14} /> Enviar no WhatsApp</button>
                  <button className="btn py-1.5 text-xs" disabled={ocupado === l.id} onClick={() => agir(l, "conferir")}><RefreshCw size={14} /> Conferir</button>
                  <button className="btn py-1.5 text-xs hover:text-red-600" disabled={ocupado === l.id} onClick={() => agir(l, "cancelar")}><Ban size={14} /> Cancelar</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {novo && <NovoLinkModal onFechar={() => setNovo(false)} onCriado={() => carregar()} />}
    </div>
  );
}
