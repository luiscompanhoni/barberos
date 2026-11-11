"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { dataLocal } from "@/lib/agenda/tempo";
import { api, reais } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";
import { formasPagamentoRegistrado, vencimentoDoRegistro } from "@/lib/assinaturas/registro-manual-regras";

type Cliente = { id: string; nome: string; telefone: string };
type Plano = { id: string; nome: string; precoCentavos: number; ativo: boolean; compravel: boolean };
const ROTULOS = { PIX: "Pix", CARTAO: "Cartão", BOLETO: "Boleto" };
const dataBr = (data: string) => data.split("-").reverse().join("/");

export function AtivarPlanoManual({ onFechar, onRegistrada }: { onFechar: () => void; onRegistrada: (id: string) => void }) {
  const [busca, setBusca] = useState("");
  const [sugestoes, setSugestoes] = useState<Cliente[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [planoId, setPlanoId] = useState("");
  const [forma, setForma] = useState("");
  const [pagoEm, setPagoEm] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [hoje] = useState(() => dataLocal(Date.now()));

  useEffect(() => {
    api<Plano[]>("/api/planos").then(r => setPlanos(r.filter(p => p.ativo))).catch(e => setErro(e.message));
  }, []);

  useEffect(() => {
    if (cliente || busca.trim().length < 2) return;
    let vigente = true;
    const timer = setTimeout(() => {
      api<Cliente[]>(`/api/clientes?busca=${encodeURIComponent(busca.trim())}`).then(r => {
        if (vigente) setSugestoes(r);
      }).catch(e => { if (vigente) setErro(e.message); });
    }, 250);
    return () => { vigente = false; clearTimeout(timer); };
  }, [busca, cliente]);

  const plano = planos.find(p => p.id === planoId);
  const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(pagoEm) && pagoEm <= hoje;
  const dataPrevista = dataValida ? vencimentoDoRegistro(pagoEm, vencimento || undefined) : "";

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (!cliente || !plano || !forma || !dataValida || salvando) return;
    setErro("");
    setSalvando(true);
    try {
      const r = await api<{ id: string }>("/api/assinaturas/registro-manual", {
        method: "POST",
        body: { clienteId: cliente.id, planoId, forma, pagoEm, proximoVencimento: vencimento || undefined, precoPlanoCentavos: plano.precoCentavos },
      });
      onRegistrada(r.id);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal titulo="Registrar plano já pago" onFechar={() => { if (!salvando) onFechar(); }}>
      <form className="space-y-3 text-sm" onSubmit={registrar}>
        <p>Use quando o cliente já tiver pago fora do BarberOS. Confira o cadastro, o plano e o período antes de liberar o acesso.</p>
        {cliente ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-300 px-3 py-2">
            <span><b>{cliente.nome}</b> · {formatarTelefone(cliente.telefone)}</span>
            <button type="button" className="btn" onClick={() => { setCliente(null); setBusca(""); setSugestoes([]); }}>Trocar cliente</button>
          </div>
        ) : (
          <div>
            <label className="rotulo" htmlFor="registro-manual-cliente">Cliente cadastrado</label>
            <input id="registro-manual-cliente" className="campo" placeholder="Buscar por nome ou celular" maxLength={60} value={busca}
              onChange={e => { setBusca(e.target.value); setSugestoes([]); }} />
            {sugestoes.length > 0 && (
              <ul className="mt-1 max-h-40 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200" aria-label="Clientes encontrados">
                {sugestoes.map(c => (
                  <li key={c.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-zinc-50" onClick={() => setCliente(c)}>
                    {c.nome} · {formatarTelefone(c.telefone)}
                  </button></li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div>
          <label className="rotulo" htmlFor="registro-manual-plano">Plano já contratado</label>
          <select id="registro-manual-plano" className="campo" required value={planoId} onChange={e => setPlanoId(e.target.value)}>
            <option value="">Selecione o plano</option>
            {planos.map(p => <option key={p.id} value={p.id}>{p.nome} · {reais(p.precoCentavos)}/mês{p.compravel ? "" : " (consulte a gestão)"}</option>)}
          </select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="rotulo" htmlFor="registro-manual-forma">Forma do último pagamento</label>
            <select id="registro-manual-forma" className="campo" required value={forma} onChange={e => setForma(e.target.value)}>
              <option value="">Selecione a forma</option>
              {formasPagamentoRegistrado.map(f => <option key={f} value={f}>{ROTULOS[f]}</option>)}
            </select>
          </div>
          <div>
            <label className="rotulo" htmlFor="registro-manual-pago">Data do último pagamento</label>
            <input id="registro-manual-pago" className="campo" type="date" required max={hoje} value={pagoEm} onChange={e => setPagoEm(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="rotulo" htmlFor="registro-manual-vencimento">Próximo vencimento do contrato (opcional)</label>
          <input id="registro-manual-vencimento" className="campo" type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
            aria-describedby="registro-manual-regra" />
          <p id="registro-manual-regra" className="mt-1 text-xs text-zinc-500">Se ficar em branco, será usado o mesmo dia do mês seguinte ou o último dia daquele mês.</p>
        </div>
        {dataPrevista && <p role="status" className="font-medium">Vencimento a registrar em {dataBr(dataPrevista)}.</p>}
        <p className="text-xs text-zinc-500">Este registro libera o plano até o vencimento informado. O pagamento segue no canal original.</p>
        {erro && <p role="alert" className="text-red-600">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" disabled={salvando} onClick={onFechar}>Voltar</button>
          <button className="btn-primario" disabled={salvando || !cliente || !plano || !forma || !dataValida}>
            {salvando ? "Registrando..." : "Registrar e ativar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
