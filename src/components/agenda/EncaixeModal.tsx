"use client";

import { useEffect, useRef, useState } from "react";
import { useAcesso } from "@/components/AcessoContexto";
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
  fim?: number;
  servicoInicial?: string;
  cabecalho?: React.ReactNode;
  fuso: string;
  barbeiros: { id: string; nome: string }[];
  servicos: ServicoApi[];
  onFechar: () => void;
  onCriado: (msg: string) => void;
}) {
  const { permissoes } = useAcesso();
  const [duracao, setDuracao] = useState(p.fim && p.inicio && permissoes.duracao ? String((p.fim - p.inicio) / 60_000) : "");
  const [cadeiraId, setCadeiraId] = useState("padrao");
  const [cadeiras, setCadeiras] = useState<{ id: string; nome: string; ativa: boolean }[]>([]);
  useEffect(() => { api<typeof cadeiras>("/api/cadeiras").then(setCadeiras).catch(() => {}); }, []);
  const [barbeiroId, setBarbeiroId] = useState(p.barbeiroId);
  const servicosDoBarbeiro = p.servicos.filter((s) => s.ativo && s.barbeiros.some((b) => b.barbeiroId === barbeiroId));
  const [servicoId, setServicoId] = useState(p.servicoInicial ?? servicosDoBarbeiro[0]?.id ?? "");
  const [respostaDisp, setRespostaDisp] = useState<{ chave: string; valor: Disp | null; erro?: string } | null>(null);
  const [escolhaHorario, setEscolhaHorario] = useState<{ chave: string; valor: string } | null>(null);
  const [revisaoDisp, setRevisaoDisp] = useState(0);
  const [busca, setBusca] = useState("");
  const [sugestoes, setSugestoes] = useState<ClienteApi[]>([]);
  const [cliente, setCliente] = useState<ClienteApi | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [semPreferencia, setSemPreferencia] = useState(false);
  const [realizado, setRealizado] = useState(false);
  const [limiteRealizado, setLimiteRealizado] = useState(() => Date.now());
  const [ofertaAvulso, setOfertaAvulso] = useState<{ chave: string; preco: number } | null>(null);
  const [planoCliente, setPlanoCliente] = useState<{ nome: string; valida: boolean } | null>(null);
  const enviando = useRef(false);
  const consulta = new URLSearchParams({ data: p.data, servicoId, barbeiroId, ...(duracao ? { duracaoMin: duracao } : {}), ...(cadeiraId !== "padrao" ? { cadeiraId } : {}) }).toString();
  const chaveDisp = `${consulta}&revisao=${revisaoDisp}`;
  const respostaAtual = respostaDisp?.chave === chaveDisp ? respostaDisp : null;
  const disp = respostaAtual?.valor ?? null;
  const horario = escolhaHorario?.chave === chaveDisp ? escolhaHorario.valor : "";
  const chaveAceite = JSON.stringify([chaveDisp, horario, cliente?.id ?? null, nome, telefone, semPreferencia, realizado]);
  const avulso = ofertaAvulso?.chave === chaveAceite ? ofertaAvulso : null;
  function invalidarAceite() { setOfertaAvulso(null); setErro(""); }
  function invalidarDisponibilidade() { invalidarAceite(); setRespostaDisp(null); setEscolhaHorario(null); }

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
    if (!servicoId) return;
    let vivo = true;
    api<Disp[]>(`/api/disponibilidade?${consulta}`)
      .then((r) => {
        if (!vivo) return;
        const d = r[0] ?? null;
        setRespostaDisp({ chave: chaveDisp, valor: d });
        setLimiteRealizado(Date.now());
        const alvo = p.inicio ? new Date(p.inicio).toISOString() : "";
        setEscolhaHorario({ chave: chaveDisp, valor: d?.horarios.includes(alvo) ? alvo : "" });
      })
      .catch((e) => vivo && setRespostaDisp({ chave: chaveDisp, valor: null, erro: e.message }));
    return () => { vivo = false; };
  }, [servicoId, consulta, chaveDisp, p.inicio]);

  useEffect(() => {
    if (cliente || busca.trim().length < 2) return;
    const t = setTimeout(() => {
      api<ClienteApi[]>(`/api/clientes?busca=${encodeURIComponent(busca.trim())}`).then(setSugestoes).catch(() => setSugestoes([]));
    }, 250);
    return () => clearTimeout(t);
  }, [busca, cliente]);

  async function salvar(e: React.FormEvent, forcarAvulso = false) {
    e.preventDefault();
    if (enviando.current) return;
    setErro("");
    if (!servicoId) return setErro("Escolha o serviço.");
    if (!disp || !horario || !disp.horarios.includes(horario)) return setErro("Aguarde a consulta atual e escolha um horário livre.");
    if (forcarAvulso && !avulso) return setErro("A seleção mudou. Confira novamente o valor antes de aceitar o avulso.");
    if (realizado && disp && Date.parse(horario) + disp.duracaoMin * 60_000 > Date.now()) {
      return setErro("Escolha um horário em que o atendimento já tenha terminado.");
    }
    if (!cliente && (!nome.trim() || telefone.replace(/\D/g, "").length < 10)) {
      return setErro("Informe nome e celular com DDD do cliente (ou escolha um cliente da busca).");
    }
    enviando.current = true; setSalvando(true); setOfertaAvulso(null);
    try {
      await api("/api/agendamentos", {
        method: "POST",
        body: { barbeiroId, servicoId, duracaoEsperadaMin: disp.duracaoMin,
          ...(forcarAvulso ? { precoEsperadoCentavos: avulso!.preco } : {}),
          ...(duracao ? { duracaoMin: Number(duracao) } : {}), ...(cadeiraId !== "padrao" ? { cadeiraId: cadeiraId || null } : {}), inicio: horario, semPreferencia, forcarAvulso, realizado, cliente: cliente ? { id: cliente.id } : { nome: nome.trim(), telefone } },
      });
      p.onCriado(`${realizado ? "Atendimento realizado registrado" : "Encaixe criado"} às ${minParaHhmm(minutosLocal(Date.parse(horario), p.fuso))} para ${cliente?.nome ?? nome.trim()}.`);
    } catch (e) {
      setErro((e as Error).message);
      if (e instanceof ErroApi && e.codigo === "regra_plano") {
        setOfertaAvulso({ chave: chaveAceite, preco: (e.detalhes as { precoAvulso: number }).precoAvulso });
      } else {
        setRevisaoDisp(n => n + 1);
      }
      setSalvando(false);
    } finally { enviando.current = false; }
  }

  const hora = (iso: string) => minParaHhmm(minutosLocal(Date.parse(iso), p.fuso));
  const horarios = disp?.horarios.filter((h) => !realizado || Date.parse(h) + disp.duracaoMin * 60_000 <= limiteRealizado) ?? [];

  return (
    <Modal titulo="Novo horário" onFechar={p.onFechar}>
      {p.cabecalho}
      <form onSubmit={salvar} onChangeCapture={invalidarAceite}>
        <fieldset disabled={salvando} className="space-y-3">
        <label className="flex items-start gap-3 rounded-xl border border-ouro/30 bg-ouro/5 p-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-ouro" checked={realizado} onChange={(e) => { setRealizado(e.target.checked); setLimiteRealizado(Date.now()); }} />
          <span><b className="block">Atendimento já realizado</b><span className="text-xs text-zinc-600">Use o horário real do corte. O registro entra como concluído; o recebimento é conferido na comanda.</span></span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="rotulo">Barbeiro</label>
            <select className="campo" value={barbeiroId} onChange={(e) => { invalidarDisponibilidade(); setBarbeiroId(e.target.value); setServicoId(""); }}>
              {p.barbeiros.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="rotulo">Serviço</label>
            <select className="campo" value={servicoId} onChange={(e) => { invalidarDisponibilidade(); setServicoId(e.target.value); }}>
              <option value="">Escolha...</option>
              {servicosDoBarbeiro.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {permissoes.duracao && <label className="rotulo">Duração deste atendimento (min)
            <input className="campo" type="number" min={5} max={480} value={duracao} placeholder="Padrão do serviço" onChange={e => { invalidarDisponibilidade(); setDuracao(e.target.value); }} />
          </label>}
          <label className="rotulo">Cadeira<select className="campo" value={cadeiraId} onChange={e => { invalidarDisponibilidade(); setCadeiraId(e.target.value); }}>
            <option value="padrao">Padrão do profissional</option><option value="">Não informada</option>
            {cadeiras.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select></label>
        </div>
        {disp && <p className="text-xs text-zinc-500">{disp.duracaoMin} min · {reais(disp.precoCentavos)}</p>}
        {servicoId && !respostaAtual && <p role="status" className="text-sm text-zinc-500">Consultando horários, valor e duração…</p>}
        {respostaAtual?.erro && <div className="space-y-2"><p role="alert" className="text-sm text-red-600">{respostaAtual.erro}</p><button type="button" className="btn" onClick={() => { invalidarAceite(); setRevisaoDisp(n => n + 1); }}>Tentar consultar novamente</button></div>}
        {respostaAtual && !disp && !respostaAtual.erro && <p className="text-sm text-zinc-500">Não há disponibilidade para esta seleção. Escolha outro serviço ou profissional.</p>}

        <div>
          <label className="rotulo">{realizado ? "Horário em que o atendimento começou" : "Horário"}</label>
          {disp && horarios.length === 0 ? (
            <p className="text-sm text-zinc-500">{realizado ? "Sem horário passado livre para registrar esse serviço nesse dia." : "Sem horário livre para esse serviço nesse dia."}</p>
          ) : (
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
              {horarios.map((h) => (
                <button type="button" key={h} onClick={() => { invalidarAceite(); setEscolhaHorario({ chave: chaveDisp, valor: h }); }}
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
              <button type="button" className="text-zinc-500 underline" onClick={() => { invalidarAceite(); setCliente(null); setBusca(""); setPlanoCliente(null); }}>trocar</button>
            </div>
          ) : (
            <>
              <input className="campo" placeholder="Buscar por nome ou celular" value={busca} onChange={(e) => setBusca(e.target.value)} />
              {!cliente && busca.trim().length >= 2 && sugestoes.length > 0 && (
                <ul className="mt-1 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                  {sugestoes.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50" onClick={() => { invalidarAceite(); setCliente(c); }}>
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

        {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
        {avulso && (
          <button type="button" className="btn w-full" disabled={salvando || !disp || !horario} onClick={(e) => salvar(e, true)}>
            Marcar como avulso por {reais(avulso.preco)}
          </button>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn" onClick={p.onFechar}>Voltar</button>
          <button className="btn-primario" disabled={salvando || !disp || !horario}>{salvando ? "Salvando..." : realizado ? "Registrar atendimento" : "Agendar"}</button>
        </div>
        </fieldset>
      </form>
    </Modal>
  );
}
