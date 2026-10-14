"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { Modal } from "@/components/Modal";
import { BotaoEstorno } from "@/components/estornos/BotaoEstorno";
import { CadastroCliente } from "./CadastroCliente";
import { api, reais } from "@/lib/cliente-api";
import { minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";
import { formatarTelefone } from "@/lib/telefone";
import { ROTULO_ORIGEM, ROTULO_STATUS, type AgendamentoApi, type Status } from "./tipos";

/** Fluxo do atendimento no dia: chegou -> na cadeira -> concluido (ou faltou). */
const PROXIMOS: Partial<Record<Status, Status[]>> = {
  MARCADO: ["CHEGOU", "FALTOU"],
  CONFIRMADO: ["CHEGOU", "FALTOU"],
  CHEGOU: ["EM_ATENDIMENTO", "FALTOU"],
  EM_ATENDIMENTO: ["CONCLUIDO"],
  CONCLUIDO: ["EM_ATENDIMENTO"],
  FALTOU: ["MARCADO"],
};

type Resumo = {
  cliente: { dataNascimento: string | null; origem: string | null; origemDetalhe: string | null };
  plano: { nome: string; status: string; valida: boolean } | null;
  atendidos: number;
  faltas: number;
  ultimos: { id: string; inicio: string; status: string; servico: { nome: string }; barbeiro: { nome: string } }[];
};

export function DetalheModal(p: {
  ag: AgendamentoApi;
  fuso: string;
  barbeiroNome: string;
  podeEditar: boolean;
  papel?: string;
  onFechar: () => void;
  onAlterado: (msg: string) => void;
}) {
  const { ag } = p;
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmarCancel, setConfirmarCancel] = useState(false);
  const hora = (iso: string) => minParaHhmm(minutosLocal(Date.parse(iso), p.fuso));
  const [resumo, setResumo] = useState<Resumo | null>(null);

  useEffect(() => {
    let vivo = true;
    api<Resumo>(`/api/clientes/${ag.cliente.id}`).then((r) => vivo && setResumo(r)).catch(() => {});
    return () => { vivo = false; };
  }, [ag.cliente.id]);

  async function status(s: Status) {
    setErro("");
    setOcupado(true);
    try {
      await api(`/api/agendamentos/${ag.id}`, { method: "PATCH", body: { status: s } });
      p.onAlterado(`${ag.cliente.nome}: ${ROTULO_STATUS[s].toLowerCase()}.`);
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }

  const router = useRouter();
  /** Abre (ou reaproveita) a comanda do cliente com este servico ja lancado. */
  async function comanda() {
    setErro("");
    setOcupado(true);
    try {
      const r = await api<{ id: string }>("/api/comandas", { method: "POST", body: { agendamentoId: ag.id } });
      router.push(`/comandas/${r.id}`);
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }

  const whats = `https://wa.me/${ag.cliente.telefone}`;

  return (
    <Modal titulo={ag.cliente.nome} onFechar={p.onFechar}>
      <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
        <dt className="text-zinc-500">Horário</dt><dd>{hora(ag.inicio)} às {hora(ag.fim)}</dd>
        <dt className="text-zinc-500">Serviço</dt><dd>{ag.servico.nome} · {ag.assinante ? "pelo plano" : reais(ag.precoCentavos)}{ag.pagoAntes && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">pago online</span>}</dd>
        <dt className="text-zinc-500">Barbeiro</dt>
        <dd>{p.barbeiroNome}{ag.semPreferencia && <span className="ml-2 rounded bg-sky-100 px-1.5 text-xs text-sky-800">sem preferência: pode trocar</span>}</dd>
        <dt className="text-zinc-500">Situação</dt><dd>{ROTULO_STATUS[ag.status]}</dd>
        <dt className="text-zinc-500">Celular</dt>
        <dd><a className="underline" href={whats} target="_blank" rel="noreferrer">{formatarTelefone(ag.cliente.telefone)}</a></dd>
        <dt className="text-zinc-500">Marcado por</dt><dd>{ROTULO_ORIGEM[ag.origem] ?? ag.origem}</dd>
        {ag.cliente.observacoes && (<><dt className="text-zinc-500">Preferências</dt><dd>{ag.cliente.observacoes}</dd></>)}
        {ag.observacao && (<><dt className="text-zinc-500">Obs.</dt><dd>{ag.observacao}</dd></>)}
      </dl>

      {resumo && (
        <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm">
          {resumo.plano && (
            <p className={resumo.plano.valida ? "font-medium text-violet-800" : "font-medium text-red-700"}>
              {resumo.plano.nome} · {resumo.plano.valida ? (resumo.plano.status === "ATRASADA" ? "pagamento atrasado (ainda na tolerância)" : "em dia") : resumo.plano.status === "PENDENTE" ? "aguardando 1º pagamento" : "pagamento atrasado: plano suspenso"}
            </p>
          )}
          <p className="text-zinc-600">
            {resumo.atendidos} atendimento(s) concluído(s)
            {resumo.faltas > 0 && <span className="text-red-700"> · {resumo.faltas} falta(s)</span>}
          </p>
          {resumo.ultimos.filter((u) => u.id !== ag.id).length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-zinc-500">
              {resumo.ultimos.filter((u) => u.id !== ag.id).map((u) => (
                <li key={u.id}>
                  {new Date(u.inicio).toLocaleDateString("pt-BR", { timeZone: p.fuso })} · {u.servico.nome} com {u.barbeiro.nome}
                  {u.status === "FALTOU" ? " · faltou" : ""}
                </li>
              ))}
            </ul>
          )}
          {p.podeEditar && <CadastroCliente key={ag.cliente.id} clienteId={ag.cliente.id} inicial={resumo.cliente} />}
        </div>
      )}

      {ag.pagoAntes && (p.papel === "DONO" || p.papel === "GERENTE" || p.papel === "RECEPCAO") && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-3 text-sm">
          <span className="flex-1">Pago online antes: {reais(ag.precoCentavos)}</span>
          <BotaoEstorno tipo="ANTECIPADO" id={ag.id} />
        </div>
      )}

      {p.podeEditar && ag.status !== "CANCELADO" && (
        <div className="mt-5 space-y-2">
          <div className="flex flex-wrap gap-2">
            {(PROXIMOS[ag.status] ?? []).map((s) => (
              <button key={s} className={s === "FALTOU" ? "btn-perigo" : "btn-primario"} disabled={ocupado} onClick={() => status(s)}>
                {s === "MARCADO" ? "Desfazer falta" : ROTULO_STATUS[s]}
              </button>
            ))}
            {ag.status !== "FALTOU" && (
              <button className="btn" disabled={ocupado} onClick={comanda}><Receipt size={14} /> Comanda</button>
            )}
          </div>
          <p className="text-xs text-zinc-500">Para mudar horário, barbeiro ou duração, arraste o cartão na agenda.</p>
          {ag.status !== "CONCLUIDO" && (
            confirmarCancel ? (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 p-2 text-sm">
                <span className="flex-1 text-red-800">Cancelar o atendimento de {ag.cliente.nome}?</span>
                <button className="btn" onClick={() => setConfirmarCancel(false)}>Não</button>
                <button className="btn-perigo" disabled={ocupado} onClick={() => status("CANCELADO")}>Cancelar</button>
              </div>
            ) : (
              <button className="text-sm text-red-700 underline" onClick={() => setConfirmarCancel(true)}>Cancelar atendimento</button>
            )
          )}
        </div>
      )}
      {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}
    </Modal>
  );
}
