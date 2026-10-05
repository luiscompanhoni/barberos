"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { api, ErroApi, reais } from "@/lib/cliente-api";
import { minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";
import { formatarTelefone } from "@/lib/telefone";

export type ServicoApi = {
  id: string;
  nome: string;
  duracaoMin: number;
  precoCentavos: number;
  ativo: boolean;
  barbeiros: { barbeiroId: string; duracaoMin: number | null; precoCentavos: number | null }[];
};
type ClienteApi = { id: string; nome: string; telefone: string; observacoes: string | null };
type Disp = { barbeiroId: string; nome: string; duracaoMin: number; precoCentavos: number; horarios: string[] };

export function EncaixeModal(p: {
  data: string;
  barbeiroId: string;
  inicio: number | null;
  fuso: string;
  barbeiros: { id: string; nome: string }[];
  servicos: ServicoApi[];
  onFechar: () => void;
  onCriado: (msg: string) => void;
}) {
  const [barbeiroId, setBarbeiroId] = useState(p.barbeiroId);
  const servicosDoBarbeiro = p.servicos.filter((s) => s.ativo && s.barbeiros.some((b) => b.barbeiroId === barbeiroId));
  const [servicoId, setServicoId] = useState(servicosDoBarbeiro[0]?.id ?? "");
  const [disp, setDisp] = useState<Disp | null>(null);
  const [horario, setHorario] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [sugestoes, setSugestoes] = useState<ClienteApi[]>([]);
  const [cliente, setCliente] = useState<ClienteApi | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [semPreferencia, setSemPreferencia] = useState(false);
  const [avulso, setAvulso] = useState<{ preco: number } | null>(null);
  const [planoCliente, setPlanoCliente] = useState<{ nome: string; valida: boolean } | null>(null);

  // Mostra se o cliente escolhido e assinante (o encaixe sai pelo plano).
  useEffect(() => {
    if (!cliente) return;
    let vivo = true;
    api<{ plano: { nome: string; valida: boolean } | null }>(`/api/clientes/${cliente.id}`)
      .then((r) => vivo && setPlanoCliente(r.plano))
      .catch(() => {});
    return () => { vivo = false; };
  }, [cliente]);

  // Horarios livres do servico escolhido (ja consideram a duracao do barbeiro).
  useEffect(() => {
    let vivo = true;
    if (!servicoId) {
      Promise.resolve().then(() => vivo && setDisp(null));
      return () => { vivo = false; };
    }
    api<Disp[]>(`/api/disponibilidade?${new URLSearchParams({ data: p.data, servicoId, barbeiroId })}`)
      .then((r) => {
        if (!vivo) return;
        const d = r[0] ?? null;
        setDisp(d);
        const alvo = p.inicio ? new Date(p.inicio).toISOString() : "";
        setHorario(d?.horarios.includes(alvo) ? alvo : "");
      })
      .catch((e) => vivo && setErro(e.message));
    return () => { vivo = false; };
  }, [servicoId, barbeiroId, p.data, p.inicio]);

  useEffect(() => {
    if (cliente || busca.trim().length < 2) return;
    const t = setTimeout(() => {
      api<ClienteApi[]>(`/api/clientes?busca=${encodeURIComponent(busca.trim())}`).then(setSugestoes).catch(() => setSugestoes([]));
    }, 250);
    return () => clearTimeout(t);
  }, [busca, cliente]);

  async function salvar(e: React.FormEvent, forcarAvulso = false) {
    e.preventDefault();
    setErro("");
    setAvulso(null);
    if (!servicoId) return setErro("Escolha o serviço.");
    if (!horario) return setErro("Escolha um horário livre.");
    if (!cliente && (!nome.trim() || telefone.replace(/\D/g, "").length < 10)) {
      return setErro("Informe nome e celular com DDD do cliente (ou escolha um cliente da busca).");
    }
    setSalvando(true);
    try {
      await api("/api/agendamentos", {
        method: "POST",
        body: { barbeiroId, servicoId, inicio: horario, semPreferencia, forcarAvulso, cliente: cliente ? { id: cliente.id } : { nome: nome.trim(), telefone } },
      });
      p.onCriado(`Encaixe criado às ${minParaHhmm(minutosLocal(Date.parse(horario), p.fuso))} para ${cliente?.nome ?? nome.trim()}.`);
    } catch (e) {
      setErro((e as Error).message);
      if (e instanceof ErroApi && e.codigo === "regra_plano") {
        setAvulso({ preco: (e.detalhes as { precoAvulso: number }).precoAvulso });
      }
      setSalvando(false);
    }
  }

  const hora = (iso: string) => minParaHhmm(minutosLocal(Date.parse(iso), p.fuso));

  return (
    <Modal titulo="Novo atendimento" onFechar={p.onFechar}>
      <form onSubmit={salvar} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="rotulo">Barbeiro</label>
            <select className="campo" value={barbeiroId} onChange={(e) => { setBarbeiroId(e.target.value); setServicoId(""); }}>
              {p.barbeiros.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="rotulo">Serviço</label>
            <select className="campo" value={servicoId} onChange={(e) => setServicoId(e.target.value)}>
              <option value="">Escolha...</option>
              {servicosDoBarbeiro.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>
        </div>
        {disp && <p className="text-xs text-zinc-500">{disp.duracaoMin} min · {reais(disp.precoCentavos)}</p>}

        <div>
          <label className="rotulo">Horário</label>
          {disp && disp.horarios.length === 0 ? (
            <p className="text-sm text-zinc-500">Sem horário livre para esse serviço nesse dia.</p>
          ) : (
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
              {disp?.horarios.map((h) => (
                <button type="button" key={h} onClick={() => setHorario(h)}
                  className={`rounded-md border px-2 py-1 text-sm ${h === horario ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:bg-zinc-50"}`}>
                  {hora(h)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="rotulo">Cliente</label>
          {cliente ? (
            <div className="flex items-center justify-between rounded-lg border border-zinc-300 px-3 py-2 text-sm">
              <span>
                <b>{cliente.nome}</b> · {formatarTelefone(cliente.telefone)}
                {planoCliente && (
                  <span className={`ml-2 rounded px-1.5 text-xs ${planoCliente.valida ? "bg-violet-100 text-violet-800" : "bg-red-100 text-red-800"}`}>
                    {planoCliente.nome}{planoCliente.valida ? "" : " (suspenso)"}
                  </span>
                )}
              </span>
              <button type="button" className="text-zinc-500 underline" onClick={() => { setCliente(null); setBusca(""); setPlanoCliente(null); }}>trocar</button>
            </div>
          ) : (
            <>
              <input className="campo" placeholder="Buscar por nome ou celular" value={busca} onChange={(e) => setBusca(e.target.value)} />
              {!cliente && busca.trim().length >= 2 && sugestoes.length > 0 && (
                <ul className="mt-1 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                  {sugestoes.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50" onClick={() => setCliente(c)}>
                        {c.nome} <span className="text-zinc-500">· {formatarTelefone(c.telefone)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-zinc-500">Cliente novo:</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <input className="campo" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
                <input className="campo" placeholder="(11) 99999-8888" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input type="checkbox" className="h-4 w-4" checked={semPreferencia} onChange={(e) => setSemPreferencia(e.target.checked)} />
          Cliente não tem preferência de barbeiro
        </label>

        {erro && <p className="text-sm text-red-600">{erro}</p>}
        {avulso && (
          <button type="button" className="btn w-full" onClick={(e) => salvar(e, true)}>
            Marcar como avulso por {reais(avulso.preco)}
          </button>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn" onClick={p.onFechar}>Voltar</button>
          <button className="btn-primario" disabled={salvando}>{salvando ? "Salvando..." : "Agendar"}</button>
        </div>
      </form>
    </Modal>
  );
}
