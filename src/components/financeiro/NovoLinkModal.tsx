"use client";

import { useEffect, useState } from "react";
import { Check, Copy, MessageCircle, Search, UserRound, X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { api, centavosParaTexto, paraCentavos, reais } from "@/lib/cliente-api";
import { VALIDADES_LINK_DIAS } from "@/lib/pagamentos/checkout-regras";

export type LinkPainel = {
  id: string; token: string; url: string; descricao: string; valorCentavos: number; nome: string; telefone: string;
  clienteId: string | null; comandaId: string | null; comandaNumero: number | null;
  status: "PENDENTE" | "PAGO" | "CANCELADO" | "EXPIRADO" | "ESTORNADO"; forma: "PIX" | "CARTAO" | "BOLETO" | null;
  parcelas: number | null; parcelasMax: number; pagoEm: string | null; expiraEm: string; criadoEm: string;
};
type ClienteBusca = { id: string; nome: string; telefone: string };

/** Copia o link e avisa por 2 s. */
export function BotaoCopiar({ texto, rotulo = "Copiar link", className = "btn" }: { texto: string; rotulo?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={`${className} ${ok ? "border-ouro text-ouro" : ""}`}
      onClick={async () => { await navigator.clipboard?.writeText(texto).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 2000); }}>
      {ok ? <Check size={15} /> : <Copy size={15} />} {ok ? "Copiado" : rotulo}
    </button>
  );
}

/**
 * Cria um link de pagamento: cliente cadastrado (busca) ou nome + celular, descricao,
 * valor, validade e parcelas. Da comanda: ja vem com o cliente e o que falta pagar.
 */
export function NovoLinkModal(p: {
  comanda?: { id: string; numero: number; faltaCentavos: number; cliente: ClienteBusca | null; nomeAvulso: string | null };
  onFechar: () => void;
  onCriado: (l: LinkPainel) => void;
}) {
  const [cliente, setCliente] = useState<ClienteBusca | null>(p.comanda?.cliente ?? null);
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<ClienteBusca[]>([]);
  const [nome, setNome] = useState(p.comanda?.nomeAvulso ?? "");
  const [telefone, setTelefone] = useState("");
  const [descricao, setDescricao] = useState(p.comanda ? `Comanda #${p.comanda.numero}` : "");
  const [valor, setValor] = useState(p.comanda && p.comanda.faltaCentavos > 0 ? centavosParaTexto(p.comanda.faltaCentavos) : "");
  const [validade, setValidade] = useState(p.comanda ? 1 : 3);
  const [parcelas, setParcelas] = useState(1);
  const [enviar, setEnviar] = useState(true);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [criado, setCriado] = useState<{ link: LinkPainel; envio: { ok: boolean; erro: string | null } | null } | null>(null);

  useEffect(() => {
    if (cliente || busca.trim().length < 2) return;
    const t = setTimeout(() => {
      api<ClienteBusca[]>(`/api/clientes?busca=${encodeURIComponent(busca.trim())}`).then(setAchados).catch(() => setAchados([]));
    }, 250);
    return () => clearTimeout(t);
  }, [busca, cliente]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    const v = paraCentavos(valor);
    if (!(v > 0)) return setErro("Informe o valor.");
    setOcupado(true);
    try {
      const r = await api<{ link: LinkPainel; envio: { ok: boolean; erro: string | null } | null }>("/api/financeiro/links", {
        method: "POST",
        body: {
          clienteId: cliente?.id ?? null, nome: cliente ? null : nome, telefone: cliente ? null : telefone, comandaId: p.comanda?.id ?? null,
          descricao, valorCentavos: v, validadeDias: validade, parcelasMax: parcelas, enviar,
        },
      });
      setCriado(r);
      p.onCriado(r.link);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function reenviar() {
    if (!criado) return;
    setOcupado(true);
    setErro("");
    try {
      const r = await api<{ envio: { ok: boolean; erro: string | null } }>(`/api/financeiro/links/${criado.link.id}`, { method: "PATCH", body: { acao: "enviar" } });
      setCriado({ ...criado, envio: r.envio });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (criado) {
    const l = criado.link;
    return (
      <Modal titulo="Link criado" onFechar={p.onFechar}>
        <div className="space-y-3 text-sm">
          <p><b>{l.descricao}</b> · {reais(l.valorCentavos)} para {l.nome}</p>
          <input className="campo font-mono text-xs" readOnly value={l.url} onFocus={(e) => e.target.select()} aria-label="Link de pagamento" />
          {criado.envio && (
            <p className={`rounded-xl p-3 text-xs ${criado.envio.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
              {criado.envio.ok ? "Enviado no WhatsApp do cliente. ✅" : `Não foi possível enviar no WhatsApp: ${criado.envio.erro ?? "erro"}. Copie e mande por fora.`}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <BotaoCopiar texto={l.url} />
            <button type="button" className="btn" disabled={ocupado} onClick={reenviar}><MessageCircle size={15} /> {criado.envio ? "Enviar de novo" : "Enviar no WhatsApp"}</button>
          </div>
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <button type="button" className="btn-primario w-full" onClick={p.onFechar}>Pronto</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo={p.comanda ? `Cobrar comanda #${p.comanda.numero} por link` : "Novo link de pagamento"} onFechar={p.onFechar}>
      <form onSubmit={criar} className="space-y-3">
        <div>
          <p className="rotulo">Quem vai pagar</p>
          {cliente ? (
            <div className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm">
              <UserRound size={15} className="text-ouro" />
              <span className="flex-1 font-medium">{cliente.nome}</span>
              {!p.comanda?.cliente && <button type="button" className="p-1 text-zinc-500 hover:text-red-600" aria-label="Trocar cliente" onClick={() => setCliente(null)}><X size={14} /></button>}
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={15} className="absolute top-2.5 left-3 text-zinc-500" />
                <input className="campo pl-9" placeholder="Buscar cliente (nome ou telefone)" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              {busca.trim().length >= 2 && achados.length > 0 && (
                <div className="mt-1 space-y-1">
                  {achados.map((c) => (
                    <button type="button" key={c.id} onClick={() => setCliente(c)} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-zinc-100">
                      <UserRound size={14} className="text-ouro" /> {c.nome} <span className="ml-auto text-xs text-zinc-500">{c.telefone.replace(/^55/, "")}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-zinc-500">Sem cadastro? Preencha nome e celular:</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <input className="campo" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
                <input className="campo" inputMode="tel" placeholder="Celular com DDD" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
              </div>
            </>
          )}
        </div>
        <div>
          <label className="rotulo" htmlFor="lk-desc">Descrição</label>
          <input id="lk-desc" className="campo" maxLength={120} placeholder="Ex.: Pomada + corte" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="rotulo" htmlFor="lk-valor">Valor (R$)</label>
            <input id="lk-valor" className="campo" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          <div>
            <label className="rotulo" htmlFor="lk-val">Vale por</label>
            <select id="lk-val" className="campo" value={validade} onChange={(e) => setValidade(Number(e.target.value))}>
              {VALIDADES_LINK_DIAS.map((d) => <option key={d} value={d}>{d === 1 ? "1 dia" : `${d} dias`}</option>)}
            </select>
          </div>
          <div>
            <label className="rotulo" htmlFor="lk-parc">Cartão</label>
            <select id="lk-parc" className="campo" value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => <option key={n} value={n}>{n === 1 ? "À vista" : `Até ${n}x`}</option>)}
            </select>
          </div>
        </div>
        {p.comanda && <p className="text-[11px] text-zinc-500">Falta pagar na comanda: {reais(p.comanda.faltaCentavos)}. Pago, o valor entra sozinho na comanda.</p>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enviar} onChange={(e) => setEnviar(e.target.checked)} className="accent-[#d3ab45]" /> Enviar no WhatsApp do cliente
        </label>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <button className="btn-primario w-full py-2.5" disabled={ocupado}>{ocupado ? "Criando…" : "Criar link"}</button>
      </form>
    </Modal>
  );
}
