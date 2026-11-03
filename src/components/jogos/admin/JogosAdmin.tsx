"use client";

/**
 * Painel dos jogos: resgates (recepcao), configuracao de cada jogo (dono/gerente), jogadas e resultado.
 */
import { useEffect, useState } from "react";
import { api, reais } from "@/lib/cliente-api";
import { EditorJogo } from "./EditorJogo";
import { JogadasRecentes, ResgatesBalcao } from "./ResgatesBalcao";
import type { Painel, Resultado } from "./tipos";
import { GraficoRoscaCrm } from "@/components/visual/GraficosCrm";
import { ContadorCrm } from "@/components/visual/ContadorCrm";

const PERIODOS = [{ v: "mes", r: "Este mês" }, { v: "30d", r: "30 dias" }, { v: "90d", r: "90 dias" }, { v: "ano", r: "Este ano" }];

export function JogosAdmin({ podeConfigurar, verResultado }: { podeConfigurar: boolean; verResultado: boolean }) {
  const [p, setP] = useState<Painel | null>(null);
  const [aba, setAba] = useState("resgates");
  const [erro, setErro] = useState("");
  useEffect(() => { api<Painel>("/api/jogos").then(setP).catch((e) => setErro(e.message)); }, []);

  const abas = [
    { id: "resgates", r: "Resgates" },
    ...(podeConfigurar && p ? p.jogos.map((j) => ({ id: j.id, r: `${j.nome}${j.ativo ? " ●" : ""}` })) : []),
    { id: "jogadas", r: "Jogadas" },
    ...(verResultado ? [{ id: "resultado", r: "Resultado" }] : []),
  ];
  const jogo = p?.jogos.find((j) => j.id === aba);

  return (
    <div className="space-y-4">
      <div className="crm-page-header">
        <p className="eyebrow">Marketing</p>
        <h1 className="titulo-marca text-2xl">Jogos de recompensa</h1>
        <p className="text-sm text-zinc-500">Roleta, caixas-surpresa e raspadinha usam o mesmo motor: o prêmio é sorteado e gravado no servidor antes da animação.</p>
      </div>
      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      <div className="crm-subtabs flex gap-1.5 overflow-x-auto pb-1" aria-label="Áreas dos jogos">
        {abas.map((a) => (
          <button key={a.id} aria-pressed={aba === a.id} onClick={() => setAba(a.id)} className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold ${aba === a.id ? "bg-ouro text-fundo" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}>{a.r}</button>
        ))}
      </div>
      {aba === "resgates" && <ResgatesBalcao podeCancelar={podeConfigurar} />}
      {aba === "jogadas" && <JogadasRecentes />}
      {aba === "resultado" && <ResultadoJogos jogos={p?.jogos.map((j) => ({ id: j.id, nome: j.nome })) ?? []} />}
      {jogo && p && <EditorJogo key={`${jogo.id}${jogo.atualizadoEm}`} jogo={jogo} servicos={p.servicos} aoSalvar={setP} />}
    </div>
  );
}

function ResultadoJogos({ jogos }: { jogos: { id: string; nome: string }[] }) {
  const [periodo, setPeriodo] = useState("mes");
  const [jogo, setJogo] = useState("");
  const [r, setR] = useState<Resultado | null>(null);
  useEffect(() => {
    api<Resultado>(`/api/jogos/resultado?periodo=${periodo}${jogo ? `&jogo=${jogo}` : ""}`).then(setR).catch(() => {});
  }, [periodo, jogo]);
  const card = (t: string, v: string, s?: string, numero?: number, dinheiro = false) => (
    <div className="crm-kpi cartao"><p className="text-xs text-zinc-500">{t}</p><p className="numero-kpi text-2xl">{numero === undefined ? v : <ContadorCrm valor={numero} formatar={dinheiro ? reais : undefined} />}</p>{s && <p className="text-[11px] text-zinc-500">{s}</p>}</div>
  );
  return (
    <div className="space-y-3">
      <div className="crm-filterbar flex flex-wrap gap-2">
        <select aria-label="Período dos resultados" className="campo w-auto" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>{PERIODOS.map((x) => <option key={x.v} value={x.v}>{x.r}</option>)}</select>
        <select aria-label="Jogo dos resultados" className="campo w-auto" value={jogo} onChange={(e) => setJogo(e.target.value)}><option value="">Todos os jogos</option>{jogos.map((j) => <option key={j.id} value={j.id}>{j.nome}</option>)}</select>
      </div>
      {!r ? <p className="cartao text-sm text-zinc-500">Carregando…</p> : (
        <><div className="grid gap-3 sm:grid-cols-3">
          {card("Jogadas", String(r.jogadas.total), `${r.jogadas.vitorias} com prêmio`, r.jogadas.total)}
          {card("Custo da campanha", reais(r.custoCentavos), `brindes ${reais(r.brindes.custoCentavos)} · descontos ${reais(r.descontos.centavos)} · crédito usado ${reais(r.creditos.usadoCentavos)}`, r.custoCentavos, true)}
          {card("Faturamento das visitas com resgate", reais(r.faturamentoCentavos), `${r.visitas} visitas`, r.faturamentoCentavos, true)}
          {card("Retorno", r.retorno === null ? "—" : `R$ ${r.retorno.toLocaleString("pt-BR")} por R$ 1`, "faturamento ÷ custo")}
          {card("Crédito ainda em aberto", reais(r.saldoAberto.centavos), `${r.saldoAberto.creditos} créditos`)}
          {r.brindes.semCusto > 0 && card("Brindes sem custo", String(r.brindes.semCusto), "preencha o custo no prêmio")}
        </div><section className="cartao space-y-3" aria-label="Composição do custo dos jogos">
          <h2 className="titulo-marca text-lg">Custo dos resgates, por tipo</h2>
          <p className="text-xs text-zinc-500">Distribuição dos custos registrados no período selecionado.</p>
          <GraficoRoscaCrm rotulo="Custo registrado dos brindes, descontos e créditos usados" formatar={reais} itens={[
            { rotulo: "Brindes", valor: r.brindes.custoCentavos },
            { rotulo: "Descontos", valor: r.descontos.centavos },
            { rotulo: "Créditos usados", valor: r.creditos.usadoCentavos },
          ]} />
        </section></>
      )}
    </div>
  );
}
