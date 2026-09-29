"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, reais } from "@/lib/cliente-api";

type Ag = {
  id: string;
  inicio: string;
  status: string;
  precoCentavos: number;
  barbeiro: { id?: string; nome: string };
  servico: { id?: string; nome: string };
};

const FUSO = "America/Sao_Paulo";
const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: FUSO });
const STATUS: Record<string, string> = { CONCLUIDO: "Atendido", FALTOU: "Faltou", CANCELADO: "Cancelado", MARCADO: "Marcado", CONFIRMADO: "Confirmado" };

/** Pagina inicial do cliente: proximos horarios (com cancelar/remarcar) e historico. */
export function MeusHorarios() {
  const [dados, setDados] = useState<{ proximos: Ag[]; historico: Ag[]; prazoAlteracaoMin: number } | null>(null);
  const [perfil, setPerfil] = useState<{ nome: string } | null>(null);
  const [nome, setNome] = useState("");
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [agora] = useState(() => Date.now());

  const carregar = useCallback(() => {
    api<{ proximos: Ag[]; historico: Ag[]; prazoAlteracaoMin: number }>("/api/cliente/agendamentos").then(setDados).catch((e) => setErro(e.message));
    api<{ nome: string }>("/api/cliente/perfil").then(setPerfil).catch(() => {});
  }, []);
  useEffect(carregar, [carregar]);

  async function cancelar(id: string) {
    setErro("");
    try {
      await api(`/api/cliente/agendamentos/${id}`, { method: "DELETE" });
      setAviso("Horário cancelado.");
      setConfirmar(null);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function salvarNome(e: React.FormEvent) {
    e.preventDefault();
    if (nome.trim().length < 2) return setErro("Digite seu nome.");
    try {
      await api("/api/cliente/perfil", { method: "PATCH", body: { nome: nome.trim() } });
      setErro("");
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (!dados || !perfil) return <p className="text-sm text-zinc-500">Carregando...</p>;

  if (!perfil.nome.trim()) {
    return (
      <form onSubmit={salvarNome} className="cartao space-y-3">
        <h1 className="text-lg font-semibold">Bem-vindo! Como podemos te chamar?</h1>
        <input className="campo" placeholder="Seu nome" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} />
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <button className="btn-primario">Continuar</button>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">Olá, {perfil.nome.split(" ")[0]}!</h1>
      {aviso && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p>}
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-600">Próximos horários</h2>
        {dados.proximos.length === 0 ? (
          <div className="cartao text-sm text-zinc-600">
            Nenhum horário marcado. <Link href="/c/agendar" className="font-medium underline">Agendar agora</Link>
          </div>
        ) : (
          dados.proximos.map((a) => (
            <div key={a.id} className="cartao space-y-2">
              <p className="font-semibold first-letter:uppercase">{quando(a.inicio)}</p>
              <p className="text-sm text-zinc-600">{a.servico.nome} com {a.barbeiro.nome} · {reais(a.precoCentavos)}</p>
              {Date.parse(a.inicio) - agora < dados.prazoAlteracaoMin * 60_000 ? (
                <p className="text-xs text-zinc-500">
                  Faltam menos de {Math.round(dados.prazoAlteracaoMin / 6) / 10}h: para mudar ou cancelar, fale com a barbearia.
                </p>
              ) : confirmar === a.id ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-2 text-sm">
                  <span className="flex-1 text-red-800">Cancelar esse horário?</span>
                  <button className="btn" onClick={() => setConfirmar(null)}>Não</button>
                  <button className="btn-perigo" onClick={() => cancelar(a.id)}>Sim, cancelar</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Link className="btn" href={`/c/agendar?remarcar=${a.id}&servico=${a.servico.id}&barbeiro=${a.barbeiro.id}`}>Remarcar</Link>
                  <button className="btn-perigo" onClick={() => setConfirmar(a.id)}>Cancelar</button>
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {dados.historico.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-600">Histórico</h2>
          <ul className="cartao divide-y divide-zinc-100 p-0 text-sm">
            {dados.historico.map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-4 py-2">
                <span className="first-letter:uppercase">{quando(a.inicio)}</span>
                <span className="text-zinc-500">· {a.servico.nome} · {a.barbeiro.nome}</span>
                <span className="ml-auto text-xs text-zinc-500">{STATUS[a.status] ?? a.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
