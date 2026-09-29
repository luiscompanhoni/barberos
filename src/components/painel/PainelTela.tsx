"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, reais } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";

type Painel = {
  dia: {
    atendimentos: number;
    concluidos: number;
    faltas: number;
    previstoCentavos: number;
    realizadoCentavos: number;
    ocupacao: number | null;
    livresMin: number;
    porBarbeiro: { id: string; nome: string; atendimentos: number; ocupacao: number | null }[];
  };
  mes: {
    atual: { centavos: number; atendimentos: number };
    anterior: { centavos: number; atendimentos: number };
    clientesNovos: number;
    faltas: number;
  } | null;
  pendencias: {
    semBaixa: { id: string; inicio: string; cliente: { nome: string }; barbeiro: { nome: string }; servico: { nome: string } }[];
    conversas: { id: string; telefone: string; nomePerfil: string | null; naoLidas: number; cliente: { nome: string } | null }[];
    foraDoExpediente: { id: string; inicio: string; barbeiroNome: string; cliente: { nome: string; telefone: string }; servico: { nome: string } }[];
    sumidos: { id: string; nome: string; telefone: string; ultimaVisita: string }[];
    faltosos: { id: string; nome: string; telefone: string; faltas: number }[];
    fuso: string;
  };
  pico: { dias: number; horas: number[]; linhas: { diaSemana: number; valores: (number | null)[] }[] } | null;
};

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const quando = (iso: string, fuso: string) =>
  new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: fuso });
const diasAtras = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
const MSG_VOLTA = encodeURIComponent("Oi! Faz tempo que você não passa aqui na barbearia. Quer que a gente reserve um horário pra você esta semana?");

/** Cor do mapa de pico, na mesma escala que a equipe ja conhece (azul vazio -> vermelho lotado). */
function corPico(v: number | null) {
  if (v === null) return "bg-zinc-100";
  if (v < 0.2) return "bg-sky-300";
  if (v < 0.4) return "bg-lime-300";
  if (v < 0.6) return "bg-amber-300";
  if (v < 0.8) return "bg-orange-400";
  return "bg-red-500";
}

export function PainelTela({ nome, dono }: { nome: string; dono: boolean }) {
  const [p, setP] = useState<Painel | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(() => api<Painel>("/api/painel").then(setP).catch((e) => setErro(e.message)), []);
  useEffect(() => {
    carregar();
    const es = new EventSource("/api/eventos");
    let t: ReturnType<typeof setTimeout> | undefined;
    es.onmessage = () => { clearTimeout(t); t = setTimeout(carregar, 1500); };
    return () => { clearTimeout(t); es.close(); };
  }, [carregar]);

  async function baixa(id: string, status: "CONCLUIDO" | "FALTOU") {
    try {
      await api(`/api/agendamentos/${id}`, { method: "PATCH", body: { status } });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (!p) return <p className="text-sm text-zinc-500">{erro || "Carregando painel..."}</p>;
  const { dia, mes, pendencias: pe, pico } = p;
  const variacao = mes && mes.anterior.centavos ? (mes.atual.centavos - mes.anterior.centavos) / mes.anterior.centavos : null;
  const hora = new Date().getHours();
  const totalPend = pe.semBaixa.length + pe.conversas.length + pe.foraDoExpediente.length;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite"}, {nome.split(" ")[0]}</h1>
        <p className="text-sm text-zinc-500">
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })} · {dia.atendimentos} atendimento(s) hoje
        </p>
      </div>
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica rotulo="Ocupação hoje" valor={pct(dia.ocupacao)} detalhe={`${Math.floor(dia.livresMin / 60)}h${String(dia.livresMin % 60).padStart(2, "0")} livres na agenda`}
          barra={dia.ocupacao} />
        <Metrica rotulo="Previsto hoje" valor={reais(dia.previstoCentavos)} detalhe={`${reais(dia.realizadoCentavos)} já concluído · ${dia.concluidos}/${dia.atendimentos}`} />
        {mes ? (
          <>
            <Metrica rotulo="Faturamento do mês" valor={reais(mes.atual.centavos)}
              detalhe={variacao === null ? "sem base do mês passado" : `${variacao >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(variacao * 100))}% vs mesmo período do mês passado`}
              tom={variacao === null ? undefined : variacao >= 0 ? "bom" : "ruim"} />
            <Metrica rotulo="Clientes novos no mês" valor={String(mes.clientesNovos)} detalhe={`${mes.faltas} falta(s) no mês`} tom={mes.faltas > 5 ? "ruim" : undefined} />
          </>
        ) : (
          <Metrica rotulo="Faltas hoje" valor={String(dia.faltas)} detalhe="marcadas como faltou" />
        )}
      </section>

      <section className="cartao space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="font-semibold">Precisa de ação</h2>
          <span className="text-sm text-zinc-500">{totalPend ? `${totalPend} pendência(s)` : "tudo em dia"}</span>
        </div>

        {pe.conversas.length > 0 && (
          <Bloco titulo="Clientes esperando resposta no WhatsApp" qtd={pe.conversas.length} acao={<Link className="text-sm underline" href="/conversas">abrir conversas</Link>}>
            {pe.conversas.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span>{c.cliente?.nome || c.nomePerfil || formatarTelefone(c.telefone)}</span>
                {c.naoLidas > 0 && <span className="rounded-full bg-emerald-600 px-1.5 text-[11px] text-white">{c.naoLidas}</span>}
              </li>
            ))}
          </Bloco>
        )}

        {pe.semBaixa.length > 0 && (
          <Bloco titulo="Atendimentos sem baixa (já passaram)" qtd={pe.semBaixa.length}>
            {pe.semBaixa.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-56">{quando(a.inicio, pe.fuso)} · <b>{a.cliente.nome}</b> · {a.servico.nome} · {a.barbeiro.nome}</span>
                <button className="btn py-0.5 text-xs" onClick={() => baixa(a.id, "CONCLUIDO")}>Atendido</button>
                <button className="btn-perigo py-0.5 text-xs" onClick={() => baixa(a.id, "FALTOU")}>Faltou</button>
              </li>
            ))}
          </Bloco>
        )}

        {pe.foraDoExpediente.length > 0 && (
          <Bloco titulo="Clientes marcados fora do expediente" qtd={pe.foraDoExpediente.length} acao={<Link className="text-sm underline" href="/recepcao">ver agenda</Link>}>
            {pe.foraDoExpediente.map((a) => (
              <li key={a.id}>{quando(a.inicio, pe.fuso)} · <b>{a.cliente.nome}</b> · {a.servico.nome} · {a.barbeiroNome}</li>
            ))}
          </Bloco>
        )}

        {pe.sumidos.length > 0 && (
          <Bloco titulo="Clientes sumidos (35+ dias sem voltar e nada marcado)" qtd={pe.sumidos.length}>
            {pe.sumidos.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span>{c.nome} · última visita há {diasAtras(c.ultimaVisita)} dias</span>
                <a className="text-xs text-emerald-700 underline" target="_blank" rel="noreferrer" href={`https://wa.me/${c.telefone}?text=${MSG_VOLTA}`}>chamar no WhatsApp</a>
              </li>
            ))}
          </Bloco>
        )}

        {pe.faltosos.length > 0 && (
          <Bloco titulo="Clientes que faltam com frequência (2+ faltas em 60 dias)" qtd={pe.faltosos.length}>
            {pe.faltosos.map((c) => (
              <li key={c.id}>{c.nome} · {c.faltas} faltas · {formatarTelefone(c.telefone)}</li>
            ))}
          </Bloco>
        )}
        {totalPend + pe.sumidos.length + pe.faltosos.length === 0 && <p className="text-sm text-zinc-500">Nada pendente agora. 👌</p>}
      </section>

      <section className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <div className="cartao space-y-2">
          <h2 className="font-semibold">Hoje por barbeiro</h2>
          {dia.porBarbeiro.map((b) => (
            <div key={b.id} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>{b.nome}</span>
                <span className="text-zinc-500">{b.ocupacao === null ? "folga" : `${b.atendimentos} atend. · ${pct(b.ocupacao)}`}</span>
              </div>
              <div className="h-2 rounded-full bg-zinc-100">
                <div className="h-2 rounded-full bg-zinc-900" style={{ width: `${Math.min(100, Math.round((b.ocupacao ?? 0) * 100))}%` }} />
              </div>
            </div>
          ))}
        </div>

        {dono && pico && (
          <div className="cartao space-y-2 overflow-x-auto">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-semibold">Horários de pico</h2>
              <span className="text-xs text-zinc-500">ocupação média, últimos {pico.dias} dias</span>
            </div>
            {pico.horas.length === 0 ? (
              <p className="text-sm text-zinc-500">Ainda sem histórico suficiente.</p>
            ) : (
              <table className="text-[11px]">
                <thead>
                  <tr>
                    <th />
                    {pico.linhas.map((l) => <th key={l.diaSemana} className="px-0.5 font-medium text-zinc-500">{DIAS[l.diaSemana]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {pico.horas.map((h, i) => (
                    <tr key={h}>
                      <td className="pr-1 text-right text-zinc-500">{String(h).padStart(2, "0")}h</td>
                      {pico.linhas.map((l) => (
                        <td key={l.diaSemana} className="p-0.5">
                          <div className={`h-5 w-10 rounded ${corPico(l.valores[i])}`} title={`${DIAS[l.diaSemana]} ${h}h: ${pct(l.valores[i])}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-xs text-zinc-500">
              Azul = vazio, vermelho = lotado. Use os horários azuis para promoções e para sugerir aos assinantes.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function Metrica(p: { rotulo: string; valor: string; detalhe: string; tom?: "bom" | "ruim"; barra?: number | null }) {
  return (
    <div className="cartao space-y-1">
      <p className="text-xs font-medium text-zinc-500">{p.rotulo}</p>
      <p className="text-2xl font-semibold">{p.valor}</p>
      {p.barra !== undefined && p.barra !== null && (
        <div className="h-1.5 rounded-full bg-zinc-100">
          <div className="h-1.5 rounded-full bg-emerald-600" style={{ width: `${Math.min(100, Math.round(p.barra * 100))}%` }} />
        </div>
      )}
      <p className={`text-xs ${p.tom === "bom" ? "text-emerald-700" : p.tom === "ruim" ? "text-red-700" : "text-zinc-500"}`}>{p.detalhe}</p>
    </div>
  );
}

function Bloco(p: { titulo: string; qtd: number; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-medium">{p.titulo}</span>
        <span className="rounded-full bg-zinc-900 px-1.5 text-[11px] text-white">{p.qtd}</span>
        <span className="ml-auto">{p.acao}</span>
      </div>
      <ul className="space-y-1 text-sm text-zinc-700">{p.children}</ul>
    </div>
  );
}
