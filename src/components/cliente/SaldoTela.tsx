"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Clock3, Copy, Gift, Percent, Share2, UserPlus, Wallet } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";

type Item = {
  id: string; origem: string; descricao: string; valorCentavos: number;
  situacao: "disponivel" | "usado" | "vencido" | "cancelado";
  criadoEm: string; usadoEm: string | null; expiraEm: string | null; usadoNaComanda: number | null; geradoNaComanda: number | null;
};
type Dados = {
  saldoCentavos: number;
  vencendo: { valorCentavos: number; data: string } | null;
  ganhoTotalCentavos: number;
  cashback: { ativo: boolean; pct: number; validadeDias: number };
  indicacao: { ativa: false } | { ativa: true; codigo: string; link: string; convite: string; premioIndicadorCentavos: number; premioIndicadoCentavos: number; indicados: number; convertidos: number };
  indicados: { id: string; nome: string; desde: string; veio: boolean; ganhouCentavos: number }[];
  extrato: Item[];
};

const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const SITUACAO: Record<Item["situacao"], string> = { disponivel: "Disponível", usado: "Usado", vencido: "Venceu", cancelado: "Cancelado" };

/** Saldo do cliente: cashback, premios de indicacao e o extrato. */
export function SaldoTela() {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<"extrato" | "indicacoes">("extrato");
  const [copiado, setCopiado] = useState(false);

  useEffect(() => { api<Dados>("/api/cliente/saldo").then(setD).catch((e) => setErro(e.message)); }, []);
  if (!d) return <p className="text-sm text-zinc-500">{erro || "Carregando..."}</p>;
  const ind = d.indicacao.ativa ? d.indicacao : null;

  return (
    <div className="entrar-suave space-y-6">
      <div>
        <p className="eyebrow">Sua carteira</p>
        <h1 className="titulo-marca mt-3 text-4xl">Seu <span className="text-ouro">saldo.</span></h1>
      </div>

      <section className="cartao-destaque">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-zinc-500">Disponível para usar</p>
            <p className="mt-1 text-4xl font-black text-ouro">{reais(d.saldoCentavos)}</p>
          </div>
          <Wallet className="text-ouro" size={26} />
        </div>
        <p className="mt-3 text-sm text-zinc-500">Vira desconto na sua próxima visita. É só avisar na hora de pagar.</p>
        {d.vencendo && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <Clock3 size={14} /> {reais(d.vencendo.valorCentavos)} vence em {data(d.vencendo.data)}. Use antes!
          </p>
        )}
        <div className="mt-4 h-px bg-zinc-200" />
        <p className="mt-3 text-xs text-zinc-500">Você já ganhou <b className="text-zinc-900">{reais(d.ganhoTotalCentavos)}</b> no total.</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        {d.cashback.ativo && (
          <div className="cartao flex gap-3">
            <Percent size={20} className="shrink-0 text-ouro" />
            <div className="text-sm">
              <p className="font-bold">{d.cashback.pct}% de cashback</p>
              <p className="text-zinc-500">Em tudo que você paga aqui (corte, bar e loja). Vale por {d.cashback.validadeDias} dias.</p>
            </div>
          </div>
        )}
        {ind && (
          <div className="cartao flex gap-3">
            <Gift size={20} className="shrink-0 text-ouro" />
            <div className="text-sm">
              <p className="font-bold">{reais(ind.premioIndicadorCentavos)} por amigo indicado</p>
              <p className="text-zinc-500">Quando ele fizer o primeiro corte.{ind.premioIndicadoCentavos > 0 && ` Ele ganha ${reais(ind.premioIndicadoCentavos)}.`}</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {(["extrato", "indicacoes"] as const).map((a) => (
          <button key={a} onClick={() => setAba(a)} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${aba === a ? "bg-ouro text-fundo" : "bg-zinc-100 text-zinc-600"}`}>
            {a === "extrato" ? "Extrato" : `Indicações${ind ? ` (${ind.indicados})` : ""}`}
          </button>
        ))}
      </div>

      {aba === "extrato" && (
        d.extrato.length === 0 ? (
          <p className="cartao py-8 text-center text-sm text-zinc-500">
            Ainda sem movimentos.{d.cashback.ativo ? " Seu cashback aparece aqui depois do próximo atendimento." : ""}
          </p>
        ) : (
          <ul className="cartao divide-y divide-zinc-200 p-0">
            {d.extrato.map((e) => {
              const entrada = e.situacao === "disponivel" || e.situacao === "vencido" || e.situacao === "cancelado";
              return (
                <li key={e.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${e.situacao === "usado" ? "bg-zinc-100 text-zinc-600" : "bg-ouro/15 text-ouro"}`}>
                    {e.situacao === "usado" ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{e.origem} · <span className="font-normal text-zinc-500">{e.descricao}</span></p>
                    <p className="text-xs text-zinc-500">
                      {e.situacao === "usado"
                        ? `Usado ${e.usadoEm ? `em ${data(e.usadoEm)}` : ""}${e.usadoNaComanda ? ` na comanda #${e.usadoNaComanda}` : ""}`
                        : `Ganho em ${data(e.criadoEm)}${e.expiraEm && e.situacao === "disponivel" ? ` · vale até ${data(e.expiraEm)}` : ""}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${e.situacao === "disponivel" ? "text-ouro" : e.situacao === "usado" ? "" : "text-zinc-400 line-through"}`}>
                      {entrada ? "+" : "−"} {reais(e.valorCentavos)}
                    </p>
                    <p className="text-[10px] text-zinc-500 uppercase">{SITUACAO[e.situacao]}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}

      {aba === "indicacoes" && (
        !ind ? <p className="cartao py-8 text-center text-sm text-zinc-500">O programa de indicação não está ativo no momento.</p> : (
          <div className="space-y-4">
            <section className="cartao space-y-3">
              <p className="text-sm font-semibold">Seu link de indicação</p>
              <div className="flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{ind.link}</span>
                <button className="text-ouro" aria-label="Copiar link" onClick={async () => { await navigator.clipboard?.writeText(ind.link); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}>
                  {copiado ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <a className="btn-primario w-full py-3" href={`https://wa.me/?text=${encodeURIComponent(ind.convite)}`} target="_blank" rel="noreferrer">
                <Share2 size={15} /> Mandar para um amigo no WhatsApp
              </a>
              <p className="text-center text-xs text-zinc-500">Ou passe o código <b className="text-zinc-900">{ind.codigo}</b>: o amigo fala ele no WhatsApp da barbearia.</p>
            </section>
            {d.indicados.length === 0 ? (
              <p className="cartao py-6 text-center text-sm text-zinc-500"><UserPlus className="mx-auto mb-2 text-zinc-400" size={22} />Você ainda não indicou ninguém.</p>
            ) : (
              <ul className="cartao divide-y divide-zinc-200 p-0">
                {d.indicados.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-100 font-bold text-ouro">{i.nome[0]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{i.nome}</p>
                      <p className="text-xs text-zinc-500">Indicado em {data(i.desde)} · {i.veio ? "já cortou aqui" : "ainda não veio"}</p>
                    </div>
                    {i.veio ? <b className="text-ouro">+ {reais(i.ganhouCentavos)}</b> : <span className="text-xs text-zinc-500">aguardando</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      )}
    </div>
  );
}
