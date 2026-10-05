"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarDays, CalendarPlus, Check, Clock3, Crown, History, Scissors } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { IndiqueEsperas } from "./IndiqueEsperas";

type Ag = {
  id: string;
  inicio: string;
  status: string;
  precoCentavos: number;
  assinaturaId?: string | null;
  barbeiro: { id?: string; nome: string };
  servico: { id?: string; nome: string };
};

const FUSO = "America/Sao_Paulo";
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
  const [plano, setPlano] = useState<{ nome: string; valida: boolean; status: string; link: string | null; vencimento: string | null } | null | undefined>(undefined);

  const carregar = useCallback(() => {
    api<{ proximos: Ag[]; historico: Ag[]; prazoAlteracaoMin: number }>("/api/cliente/agendamentos").then(setDados).catch((e) => setErro(e.message));
    api<{ nome: string }>("/api/cliente/perfil").then(setPerfil).catch(() => {});
    api<{ atual: { plano: { nome: string }; valida: boolean; status: string; proximoVencimento: string | null; cobrancaEmAberto: { link: string | null } | null } | null }>("/api/cliente/assinatura")
      .then((r) => setPlano(r.atual ? {
        nome: r.atual.plano.nome, valida: r.atual.valida, status: r.atual.status,
        link: r.atual.cobrancaEmAberto?.link ?? null, vencimento: r.atual.proximoVencimento,
      } : null))
      .catch(() => setPlano(null));
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

  const hojeTexto = new Date(agora).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: FUSO });

  return (
    <div className="entrar-suave space-y-8">
      <div>
        <p className="eyebrow first-letter:uppercase">{hojeTexto}</p>
        <h1 className="titulo-marca mt-3 text-4xl">Olá, <span className="text-ouro">{perfil.nome.split(" ")[0]}.</span></h1>
      </div>

      {plano === null && (
        <Link href="/c/planos" className="cartao-clicavel flex items-center gap-4">
          <Crown className="shrink-0 text-ouro" size={22} />
          <span className="flex-1 text-sm">
            <b className="block text-zinc-900">Corte à vontade todo mês</b>
            <span className="text-zinc-500">Conheça os planos de assinatura</span>
          </span>
          <ArrowRight className="text-ouro" size={16} />
        </Link>
      )}
      {plano && (
        <section className={plano.valida ? "cartao-destaque" : "cartao border-red-200"}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-zinc-500">Seu plano</p>
              <h2 className="mt-1 text-xl font-bold">{plano.nome}</h2>
            </div>
            <span className={plano.valida ? "selo-ouro" : "rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-700 uppercase"}>
              {plano.status === "PENDENTE" ? "Aguardando pagamento" : plano.valida ? "Ativo" : "Atrasado"}
            </span>
          </div>
          <div className="my-4 h-px bg-zinc-200" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">{plano.valida ? "Próxima mensalidade" : "Mensalidade em aberto"}</span>
            {plano.link && !plano.valida
              ? <a className="btn-primario" href={plano.link}>Pagar agora</a>
              : <strong>{plano.vencimento ? new Date(plano.vencimento).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }) : "—"}</strong>}
          </div>
          <Link href="/c/planos" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-ouro">Ver meu plano <ArrowRight size={13} /></Link>
        </section>
      )}

      <Link href="/c/agendar" className="btn-primario w-full py-3.5"><CalendarPlus size={17} /> Agendar horário</Link>

      {aviso && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p>}
      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Próximos horários</h2>
          <span className="text-xs text-zinc-500">{dados.proximos.length} agendado{dados.proximos.length === 1 ? "" : "s"}</span>
        </div>
        {dados.proximos.length === 0 ? (
          <div className="cartao mt-4 py-8 text-center text-sm text-zinc-500">
            <CalendarDays className="mx-auto mb-3 text-zinc-400" size={26} />
            Nenhum horário marcado.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {dados.proximos.map((a) => {
              const d = new Date(a.inicio);
              return (
                <article key={a.id} className="cartao p-5">
                  <div className="flex gap-4">
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-ouro text-center text-fundo">
                      <div>
                        <strong className="block text-xl leading-none">{d.toLocaleDateString("pt-BR", { day: "2-digit", timeZone: FUSO })}</strong>
                        <span className="text-[9px] font-bold uppercase">{d.toLocaleDateString("pt-BR", { month: "short", timeZone: FUSO }).replace(".", "")}</span>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{a.servico.nome} com {a.barbeiro.nome}</p>
                      <p className="mt-1 flex items-center gap-2 text-xs text-zinc-500 first-letter:uppercase">
                        <Clock3 size={13} /> {d.toLocaleDateString("pt-BR", { weekday: "long", timeZone: FUSO })}, {d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO })}
                      </p>
                      {a.assinaturaId
                        ? <span className="selo-ouro mt-3"><Check size={11} /> Pelo plano</span>
                        : <p className="mt-2 text-xs font-semibold text-zinc-700">{reais(a.precoCentavos)}</p>}
                    </div>
                  </div>
                  {Date.parse(a.inicio) - agora < dados.prazoAlteracaoMin * 60_000 ? (
                    <p className="mt-4 text-xs text-zinc-500">
                      Faltam menos de {Math.round(dados.prazoAlteracaoMin / 6) / 10}h: para mudar ou cancelar, fale com a barbearia.
                    </p>
                  ) : confirmar === a.id ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-red-50 p-3 text-sm">
                      <span className="flex-1 text-red-800">Cancelar esse horário?</span>
                      <button className="btn" onClick={() => setConfirmar(null)}>Não</button>
                      <button className="btn-perigo" onClick={() => cancelar(a.id)}>Sim, cancelar</button>
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Link className="btn" href={`/c/agendar?remarcar=${a.id}&servico=${a.servico.id}&barbeiro=${a.barbeiro.id}`}>Remarcar</Link>
                      <button className="btn border-transparent text-red-600 hover:bg-red-50" onClick={() => setConfirmar(a.id)}>Cancelar</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <IndiqueEsperas />

      {dados.historico.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 text-lg font-bold"><History className="text-ouro" size={18} /> Histórico</h2>
          <ul className="mt-2">
            {dados.historico.map((a) => (
              <li key={a.id} className="flex items-center gap-4 border-b border-zinc-200 py-4">
                <Scissors className="shrink-0 text-zinc-500" size={17} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{a.servico.nome}</p>
                  <p className="text-xs text-zinc-500">com {a.barbeiro.nome} · {STATUS[a.status] ?? a.status}</p>
                </div>
                <span className="text-xs text-zinc-500">{new Date(a.inicio).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: FUSO }).replace(".", "")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
