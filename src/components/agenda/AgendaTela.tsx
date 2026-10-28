"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/cliente-api";
import { dataLocal, minParaHhmm, minutosLocal, somarDias } from "@/lib/agenda/tempo";
import { DetalheModal } from "./DetalheModal";
import { type ServicoApi } from "./EncaixeModal";
import { useAcesso } from "@/components/AcessoContexto";
import { HorarioModal } from "./HorarioModal";
import { EncaixesPainel, type DestaqueEncaixe } from "./EncaixesPainel";
import { ConfiguracaoAgenda } from "./ConfiguracaoAgenda";
import { Grade } from "./Grade";
import { montarColunas, type AgendamentoApi, type Coluna } from "./tipos";
import { useAgenda } from "./useAgenda";

const FUSO = "America/Sao_Paulo";

/** Segunda-feira da semana de `data` (a grade semanal comeca na segunda). */
function inicioSemana(data: string) {
  const ds = new Date(`${data}T12:00:00Z`).getUTCDay();
  return somarDias(data, ds === 0 ? -6 : 1 - ds);
}

export function AgendaTela(p: {
  modoInicial: "dia" | "semana";
  permitirTrocarModo?: boolean;
  /** Barbeiro fixo (minha agenda). */
  barbeiroFixo?: string;
  /** Mostra seletor de barbeiro na semana. */
  escolherBarbeiro?: boolean;
  dataInicial?: string;
  barbeiroInicial?: string;
  servicoInicial?: string;
  encaixesInicial?: boolean;
  papel: string;
  meuBarbeiroId: string | null;
}) {
  const { permissoes } = useAcesso();
  const [mostrarEncaixes, setMostrarEncaixes] = useState(p.encaixesInicial ?? false);
  const [arrastarToque, setArrastarToque] = useState(false);
  const [configurar, setConfigurar] = useState(false);
  const [destaques, setDestaques] = useState<DestaqueEncaixe[]>([]);
  const [modo, setModo] = useState(p.modoInicial);
  const [data, setData] = useState(() => p.dataInicial ?? dataLocal(Date.now(), FUSO));
  const [barbeiroSel, setBarbeiroSel] = useState<string | undefined>(p.barbeiroFixo ?? p.barbeiroInicial);
  const [servicos, setServicos] = useState<ServicoApi[]>([]);
  const [todosBarbeiros, setTodosBarbeiros] = useState<{ id: string; nome: string; ativo: boolean }[]>([]);
  const [encaixe, setEncaixe] = useState<{ coluna: Coluna | null; inicio: number | null; fim?: number; servicoInicial?: string } | null>(null);
  const [aberto, setAberto] = useState<AgendamentoApi | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);

  const dias = modo === "semana" ? 7 : 1;
  const dataConsulta = modo === "semana" ? inicioSemana(data) : data;
  // Na semana sem barbeiro escolhido, usa o primeiro.
  const filtro = p.barbeiroFixo ?? (modo === "semana" ? (barbeiroSel ?? todosBarbeiros.find((b) => b.ativo)?.id) : barbeiroSel);
  const { agenda, erro, aoVivo, recarregar } = useAgenda(dataConsulta, dias, modo === "semana" && !filtro ? "__nenhum__" : filtro);

  useEffect(() => {
    api<ServicoApi[]>("/api/servicos").then(setServicos).catch(() => {});
    api<{ id: string; nome: string; ativo: boolean }[]>("/api/barbeiros").then(setTodosBarbeiros).catch(() => {});
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4500);
    return () => clearTimeout(t);
  }, [aviso]);

  const colunas = useMemo(() => (agenda ? montarColunas(agenda, modo) : []), [agenda, modo]);
  const podeEditar = useCallback(
    (barbeiroId: string) => p.papel !== "BARBEIRO" || barbeiroId === p.meuBarbeiroId,
    [p.papel, p.meuBarbeiroId],
  );

  async function mover(ag: AgendamentoApi, col: Coluna, inicio: number, fim: number) {
    try {
      await api(`/api/agendamentos/${ag.id}`, {
        method: "PATCH",
        body: { inicio: new Date(inicio).toISOString(), fim: new Date(fim).toISOString(), barbeiroId: col.barbeiroId },
      });
      const nomeB = agenda?.barbeiros.find((b) => b.id === col.barbeiroId)?.nome ?? "";
      setAviso({ texto: `${ag.cliente.nome}: ${minParaHhmm(minutosLocal(inicio, FUSO))} às ${minParaHhmm(minutosLocal(fim, FUSO))} com ${nomeB}.` });
    } catch (e) {
      setAviso({ texto: (e as Error).message, erro: true });
    }
    await recarregar();
  }

  const rotuloData = new Date(`${data}T12:00:00Z`).toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", timeZone: "UTC",
  });
  const passo = modo === "semana" ? 7 : 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button className="btn" onClick={() => setData(somarDias(data, -passo))} aria-label="Anterior">‹</button>
          <button className="btn" onClick={() => setData(dataLocal(Date.now(), FUSO))}>Hoje</button>
          <button className="btn" onClick={() => setData(somarDias(data, passo))} aria-label="Próximo">›</button>
        </div>
        <input aria-label="Data da agenda" type="date" className="campo w-auto" value={data} onChange={(e) => e.target.value && setData(e.target.value)} />
        <span className="text-sm font-medium capitalize text-zinc-700">
          {modo === "semana" ? `Semana de ${new Date(`${dataConsulta}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}` : rotuloData}
        </span>

        {p.permitirTrocarModo && (
          <div className="flex rounded-lg border border-zinc-300 bg-white p-0.5 text-sm">
            {(["dia", "semana"] as const).map((m) => (
              <button key={m} className={`rounded-md px-3 py-1 capitalize ${modo === m ? "bg-zinc-900 text-white" : ""}`} onClick={() => setModo(m)}>{m}</button>
            ))}
          </div>
        )}
        {p.escolherBarbeiro && !p.barbeiroFixo && (
          <select aria-label="Profissional da agenda" className="campo w-auto" value={filtro ?? ""} onChange={(e) => setBarbeiroSel(e.target.value || undefined)}>
            {modo === "dia" && <option value="">Todos os profissionais</option>}
            {todosBarbeiros.filter((b) => b.ativo).map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </select>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className={`flex items-center gap-1.5 text-xs ${aoVivo ? "text-emerald-700" : "text-zinc-400"}`}>
            <span className={`h-2 w-2 rounded-full ${aoVivo ? "bg-emerald-500" : "bg-zinc-300"}`} />
            {aoVivo ? "Ao vivo" : "Reconectando"}
          </span>
          <button className="btn-primario" onClick={() => setEncaixe({ coluna: null, inicio: null })}>+ Atendimento</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn" aria-pressed={mostrarEncaixes} onClick={() => setMostrarEncaixes(!mostrarEncaixes)}>{mostrarEncaixes ? "Ocultar encaixes" : "Mostrar encaixes"}</button>
        <button className="btn md:hidden" aria-pressed={arrastarToque} onClick={() => setArrastarToque(!arrastarToque)}>{arrastarToque ? "Voltar a rolar" : "Arrastar intervalo no celular"}</button>
        {p.papel === "DONO" && <button className="btn" onClick={() => setConfigurar(true)}>Cadeiras e limites</button>}
      </div>
      {mostrarEncaixes && <EncaixesPainel data={data} barbeiroId={filtro} servicoInicial={p.servicoInicial} destacarInicial={p.encaixesInicial} versao={agenda} onDestacar={setDestaques} onAgendar={(barbeiroId, servicoInicial, inicio, fim) => setEncaixe({ coluna: colunas.find(c => c.barbeiroId === barbeiroId && c.data === data) ?? null, inicio, fim, servicoInicial })} />}
      {configurar && <ConfiguracaoAgenda onFechar={() => { setConfigurar(false); recarregar(); }} />}
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {!agenda ? (
        <div className="cartao text-sm text-zinc-500">Carregando agenda...</div>
      ) : colunas.length === 0 ? (
        <div className="cartao text-sm text-zinc-500">Nenhum barbeiro ativo. Cadastre a equipe em Equipe e serviços.</div>
      ) : (
        <Grade
          colunas={colunas}
          agendamentos={agenda.agendamentos}
          fuso={agenda.fuso}
          granularidadeMin={agenda.granularidadeMin}
          podeEditar={podeEditar}
          podeDuracao={permissoes.duracao}
          arrastarToque={arrastarToque}
          destaques={destaques}
          intervaloEntreClientesMin={agenda.intervaloEntreClientesMin}
          onMover={mover}
          onVazio={(coluna, inicio, fim) => setEncaixe({ coluna, inicio, fim })}
          onAbrir={setAberto}
        />
      )}
      <p className="text-xs text-zinc-500">
        Arraste um intervalo vazio para agendar ou bloquear. Use “+ Atendimento” para escolher pelo teclado. Mova o cartão ou use “Alterar horário” para ajustar uma reserva.
      </p>

      {encaixe && agenda && (
        <HorarioModal
          data={encaixe.coluna?.data ?? data}
          barbeiroId={encaixe.coluna?.barbeiroId ?? filtro ?? p.meuBarbeiroId ?? agenda.barbeiros[0]?.id ?? ""}
          inicio={encaixe.inicio}
          fim={encaixe.fim}
          servicoInicial={encaixe.servicoInicial}
          fuso={agenda.fuso}
          barbeiros={(p.papel === "BARBEIRO" ? todosBarbeiros.filter((b) => b.id === p.meuBarbeiroId) : todosBarbeiros).filter((b) => b.ativo)}
          servicos={servicos}
          onFechar={() => setEncaixe(null)}
          onCriado={(msg) => { setEncaixe(null); setAviso({ texto: msg }); recarregar(); }}
        />
      )}
      {aberto && agenda && (
        <DetalheModal
          ag={aberto}
          fuso={agenda.fuso}
          barbeiroNome={agenda.barbeiros.find((b) => b.id === aberto.barbeiroId)?.nome ?? ""}
          podeEditar={podeEditar(aberto.barbeiroId)}
          papel={p.papel}
          onFechar={() => setAberto(null)}
          onAlterado={(msg) => { setAberto(null); setAviso({ texto: msg }); recarregar(); }}
        />
      )}

      {aviso && (
        <div role="status" className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm shadow-lg ${aviso.erro ? "bg-red-600 text-white" : "bg-zinc-900 text-white"}`}>
          {aviso.texto}
        </div>
      )}
    </div>
  );
}
