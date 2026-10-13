"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { api, reais } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";

type Plano = { id: string; nome: string; precoCentavos: number; ativo: boolean; formasPagamento: string[]; vagasRestantes: number | null };
type Cliente = { id: string; nome: string; telefone: string };
const FORMAS: Record<string, string> = { PIX: "Pix", CARTAO: "Cartão de crédito", BOLETO: "Boleto" };

/** Venda no balcao: gera a cobranca e manda o link para o cliente pagar no celular. */
export function NovaAssinatura(p: { onFechar: () => void; onCriada: () => void }) {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [planoId, setPlanoId] = useState("");
  const [forma, setForma] = useState("PIX");
  const [busca, setBusca] = useState("");
  const [sugestoes, setSugestoes] = useState<Cliente[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api<Plano[]>("/api/planos").then((ps) => {
      const ativos = ps.filter((x) => x.ativo);
      setPlanos(ativos);
      if (ativos[0]) setPlanoId(ativos[0].id);
    }).catch((e) => setErro(e.message));
  }, []);
  useEffect(() => {
    if (cliente || busca.trim().length < 2) return;
    const t = setTimeout(() => api<Cliente[]>(`/api/clientes?busca=${encodeURIComponent(busca.trim())}`).then(setSugestoes).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [busca, cliente]);

  const plano = planos.find((x) => x.id === planoId);

  async function vender(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!plano) return setErro("Escolha o plano.");
    if (!cliente && (nome.trim().length < 2 || telefone.replace(/\D/g, "").length < 10)) return setErro("Escolha um cliente ou informe nome e celular.");
    setSalvando(true);
    try {
      const r = await api<{ link: string | null }>("/api/assinaturas", {
        method: "POST",
        body: { cliente: cliente ? { id: cliente.id } : { nome: nome.trim(), telefone }, planoId, forma, cpf: cpf || undefined, email: email || undefined, enviarWhatsApp: true },
      });
      setLink(r.link);
      p.onCriada();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (link) {
    return (
      <Modal titulo="Link de pagamento enviado" onFechar={p.onFechar}>
        <div className="space-y-3 text-sm">
          <p>Mandamos o link no WhatsApp do cliente. Assim que ele pagar, o plano ativa sozinho e ele recebe a confirmação.</p>
          <div className="flex gap-2">
            <input className="campo" readOnly value={link} />
            <button className="btn" onClick={() => navigator.clipboard?.writeText(link)}>Copiar</button>
          </div>
          <button className="btn-primario" onClick={p.onFechar}>Fechar</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo="Vender plano" onFechar={p.onFechar}>
      <form onSubmit={vender} className="space-y-3 text-sm">
        <div>
          <label className="rotulo">Cliente</label>
          {cliente ? (
            <div className="flex items-center justify-between rounded-lg border border-zinc-300 px-3 py-2">
              <span><b>{cliente.nome}</b> · {formatarTelefone(cliente.telefone)}</span>
              <button type="button" className="text-zinc-500 underline" onClick={() => { setCliente(null); setBusca(""); }}>trocar</button>
            </div>
          ) : (
            <>
              <input className="campo" placeholder="Buscar por nome ou celular" value={busca} onChange={(e) => setBusca(e.target.value)} />
              {busca.trim().length >= 2 && sugestoes.length > 0 && (
                <ul className="mt-1 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                  {sugestoes.map((c) => (
                    <li key={c.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-zinc-50" onClick={() => setCliente(c)}>{c.nome} · {formatarTelefone(c.telefone)}</button></li>
                  ))}
                </ul>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input className="campo" placeholder="Nome (cliente novo)" value={nome} onChange={(e) => setNome(e.target.value)} />
                <input className="campo" placeholder="Celular" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
              </div>
            </>
          )}
        </div>
        <div>
          <label className="rotulo">Plano</label>
          <select className="campo" value={planoId} onChange={(e) => setPlanoId(e.target.value)}>
            {planos.map((x) => (
              <option key={x.id} value={x.id} disabled={x.vagasRestantes === 0}>
                {x.nome} · {reais(x.precoCentavos)}/mês{x.vagasRestantes === 0 ? " (lotado)" : x.vagasRestantes !== null ? ` (${x.vagasRestantes} vagas)` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="rotulo">Forma de pagamento</label>
            <select className="campo" value={forma} onChange={(e) => setForma(e.target.value)}>
              {(plano?.formasPagamento ?? ["PIX"]).map((f) => <option key={f} value={f}>{FORMAS[f]}</option>)}
            </select>
          </div>
          <div>
            <label className="rotulo">CPF do cliente</label>
            <input className="campo" placeholder="000.000.000-00" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="rotulo">E-mail do cliente (o meio de pagamento pode exigir)</label>
          <input className="campo" type="email" placeholder="cliente@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <p className="text-xs text-zinc-500">O cliente paga pelo link (cartão, Pix ou boleto). Ninguém da barbearia digita dados de cartão.</p>
        {erro && <p className="text-red-600">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={p.onFechar}>Voltar</button>
          <button className="btn-primario" disabled={salvando}>{salvando ? "Gerando..." : "Gerar link e enviar"}</button>
        </div>
      </form>
    </Modal>
  );
}
