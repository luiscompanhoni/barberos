"use client";

import { useEffect, useState } from "react";
import { api, reais } from "@/lib/cliente-api";
import { dataLocal } from "@/lib/agenda/tempo";
import type { MeuDiaResposta } from "@/lib/reunioes/meu-dia";
import { cenarioDoServico } from "@/lib/reunioes/regras";
import { RecomprasDoDia } from "@/components/recompras/RecomprasDoDia";
import { CenarioCombinado } from "./CenarioCombinado";

export function MeuDiaTela() {
  const [data, setData] = useState(() => dataLocal(Date.now(), "America/Sao_Paulo")), [barbeiroId, setBarbeiroId] = useState("");
  const [dados, setDados] = useState<MeuDiaResposta | null>(null), [erro, setErro] = useState(""), [carregando, setCarregando] = useState(false);
  const [servicoId, setServicoId] = useState(""), [quantidade, setQuantidade] = useState(1), [versao, setVersao] = useState(0);
  useEffect(() => {
    let vivo = true;
    Promise.resolve().then(() => { if (vivo) { setCarregando(true); setErro(""); } });
    api<MeuDiaResposta>(`/api/meu-dia?${new URLSearchParams({ data, ...(barbeiroId ? { barbeiroId } : {}) })}`)
      .then((d) => { if (vivo) { setDados(d); setServicoId(""); setQuantidade(1); } })
      .catch((e: Error) => { if (vivo) { setErro(e.message); setDados(null); } }).finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [data, barbeiroId, versao]);
  const servico = dados?.servicos.find((s) => s.servicoId === servicoId), cenario = servico ? cenarioDoServico(servico, quantidade) : null;
  const hora = (d: string) => new Date(d).toLocaleTimeString("pt-BR", { timeZone: dados?.fuso ?? "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return <div className="space-y-5"><div><p className="eyebrow">Reunião diária · 20 minutos</p><h1 className="titulo-marca">Meu dia</h1><p className="mt-2 text-sm text-zinc-500">Agenda, comissão prevista e oportunidades que cabem no seu dia.</p></div>
    <div className="cartao flex flex-wrap items-end gap-3"><label className="rotulo">Dia<input className="campo mt-1" type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
      {dados && dados.profissionais.length > 1 && <label className="rotulo">Profissional<select className="campo mt-1" value={barbeiroId || dados.barbeiro.id} onChange={(e) => setBarbeiroId(e.target.value)}>{dados.profissionais.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}</select></label>}
      <button className="btn" disabled={carregando} onClick={() => setVersao((v) => v + 1)}>{carregando ? "Atualizando…" : "Atualizar"}</button></div>
    {erro && <p className="text-sm text-red-600" role="alert">{erro}</p>}
    {dados && <><h2 className="text-xl font-semibold">{dados.barbeiro.nome}</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[["Clientes na agenda", `${dados.resumo.clientes} · ${dados.resumo.servicos} serviços`], ["Receita avulsa prevista", reais(dados.resumo.receitaPrevistaCentavos)], ["Comissão avulsa prevista", dados.resumo.comissaoAvulsaCentavos === null ? "Pendente ou restrita" : reais(dados.resumo.comissaoAvulsaCentavos)], ["Comissão dos planos", dados.resumo.comissaoPlanoCentavos === null ? "Provisória / restrita" : reais(dados.resumo.comissaoPlanoCentavos)]].map(([titulo, valor]) => <div className="cartao" key={titulo}><p className="text-xs text-zinc-500">{titulo}</p><p className="mt-2 text-xl font-semibold text-ouro">{valor}</p></div>)}</div>
      <p className="text-xs text-zinc-500">Previsões usam os preços da agenda e as regras de comissão cadastradas; descontos e fechamento podem alterar os valores. Assinaturas não são novas vendas avulsas.{dados.resumo.planoPendente ? " O valor do pote depende do fechamento e dos créditos de toda a equipe." : ""}{dados.resumo.semRegra ? ` Há ${dados.resumo.semRegra} serviço(s) sem regra de comissão.` : ""}</p>
      <section className="cartao"><h3 className="font-semibold">Prioridades</h3><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">{dados.prioridades.map((p) => <li key={p}>{p}</li>)}</ol></section>
      <section className="cartao space-y-3"><h3 className="font-semibold">Agenda do dia</h3>{!dados.atendimentos.length && <p className="text-sm text-zinc-500">Nenhum atendimento neste dia.</p>}{dados.atendimentos.map((a) => <article key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 py-2 text-sm"><div><b>{hora(a.inicio)}–{hora(a.fim)} · {a.cliente}</b><p className="text-zinc-500">{a.servico} · {a.assinante ? "Assinante" : "Avulso"} · {a.status.toLocaleLowerCase("pt-BR").replaceAll("_", " ")}</p></div><p>{reais(a.receitaCentavos)}{a.comissaoCentavos === null ? "" : ` · comissão ${reais(a.comissaoCentavos)}`}</p></article>)}</section>
      <RecomprasDoDia key={`${dados.barbeiro.id}:${dados.data}`} barbeiroId={dados.barbeiro.id} data={dados.data} />
      <section className="cartao space-y-3"><h3 className="font-semibold">Projeção com encaixes</h3><p className="text-sm text-zinc-500">Compare um serviço por vez. As alternativas usam as mesmas janelas; somá-las poderia ocupar o mesmo horário duas vezes. Quantidades são hipóteses de venda, limitadas à disponibilidade.</p>
        <div className="grid gap-3 sm:grid-cols-2"><label className="rotulo">Serviço<select className="campo mt-1" value={servicoId} onChange={(e) => { setServicoId(e.target.value); setQuantidade(1); }}><option value="">Escolha uma alternativa</option>{dados.servicos.map((s) => <option key={s.servicoId} value={s.servicoId}>{s.nome} · {s.quantidadeMaxima} encaixe(s) de {s.duracaoMin} min</option>)}</select></label>
          {servico && <label className="rotulo">Meta de vendas<input className="campo mt-1" type="number" min={0} max={servico.quantidadeMaxima} value={quantidade} onChange={(e) => setQuantidade(Number(e.target.value))} /></label>}</div>
        {cenario && servico && <div className="grid gap-3 sm:grid-cols-3"><div><p className="text-xs text-zinc-500">Base avulsa da agenda</p><b>{reais(dados.resumo.receitaPrevistaCentavos)}</b></div><div><p className="text-xs text-zinc-500">Base + meta de {cenario.quantidade} serviço(s)</p><b>{reais(dados.resumo.receitaPrevistaCentavos + cenario.receitaCentavos)}</b><p className="text-xs">{cenario.minutos} min · comissão adicional {cenario.comissaoCentavos === null ? "pendente/restrita" : reais(cenario.comissaoCentavos)}</p><p className="text-xs">Margem adicional antes de taxas: {cenario.margemCentavos === null ? "custo pendente ou dado restrito" : reais(cenario.margemCentavos)}</p></div><div><p className="text-xs text-zinc-500">Potencial máximo viável desta alternativa</p><b>{reais(dados.resumo.receitaPrevistaCentavos + cenarioDoServico(servico, servico.quantidadeMaxima).receitaCentavos)}</b><p className="text-xs">{servico.quantidadeMaxima} encaixe(s); depende de demanda e aceitação.</p></div></div>}
        <a className="btn inline-flex" href={dados.agendaHref}>Mostrar espaços disponíveis na agenda</a></section>
      <CenarioCombinado key={`${dados.barbeiro.id}:${dados.data}:${versao}`} servicos={dados.servicos} baseCentavos={dados.resumo.receitaPrevistaCentavos} granularidadeMin={dados.granularidadeMin} intervaloMin={dados.intervaloMin} fuso={dados.fuso} />
      {dados.acoes.length > 0 && <section className="cartao"><h3 className="font-semibold">Combinados das reuniões</h3>{dados.acoes.map((a) => <p className="mt-3 text-sm" key={`${a.reuniaoId}:${a.id}`}>{a.texto}<span className="block text-xs text-zinc-500">Responsável: {a.responsavel} · prazo {a.prazo}</span></p>)}</section>}
    </>}
  </div>;
}
