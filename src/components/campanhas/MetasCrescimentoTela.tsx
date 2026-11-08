"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, paraCentavos, reais } from "@/lib/cliente-api";
import type { BaseMetasCrescimento } from "@/lib/crescimento/metas-consulta";
import type { EntradaMetasCrescimento, ResultadoMetasCrescimento } from "@/lib/crescimento/metas";

const valores = [
  ["receitaPlanos", "Receita reconhecida líquida de assinaturas (R$)", true],
  ["receitaOutras", "Receita reconhecida líquida de outras vendas (R$)", true],
  ["descontos", "Descontos/estornos já deduzidos dessas receitas (R$)", true],
  ["custosRealizados", "Todos os custos do período realizado (R$)", false],
  ["outrasDezembro", "Outras vendas líquidas previstas em dezembro (R$)", false],
  ["custosDezembro", "Custos-base completos previstos de dezembro (R$)", false],
  ["receitaNovo", "Receita líquida de dezembro por novo ainda necessário (R$)", false],
  ["variaveisNovo", "Custos variáveis adicionais por novo em dezembro (R$)", false],
  ["indicacao", "Custo total da indicação por novo (R$; informe 0 se inexistente)", true],
  ["credito", "Parte da indicação já deduzida da receita por novo (R$)", true],
] as const;
const pendencia = (codigo: string) => ({
  CONTRATOS_INCOMPLETOS: "Conferir cobertura, valores líquidos e cancelamentos dos contratos.",
  CONTAGENS_DIVERGEM_DOS_CONTRATOS: "Reconciliar contagens e contratos.",
  CUSTOS_REALIZADOS_INCOMPLETOS: "Completar custos do período antes de declarar lucro/margem.",
  CUSTOS_DEZEMBRO_INCOMPLETOS: "Completar previsão de todos os custos de dezembro.",
  RECEITA_REALIZADA_ZERO: "Receita realizada zero: margem não calculável.",
  RECEITA_DEZEMBRO_INCOMPLETA: "Completar as receitas previstas de dezembro.",
  OUTRAS_VENDAS_AINDA_NECESSARIAS: "A previsão ainda não fecha a meta de outras vendas.",
  CAPACIDADE_NAO_VERIFICADA: "Conferir duração real, escala e demanda das outras vendas.",
  CAPACIDADE_INSUFICIENTE: "O cenário escolhido excede a capacidade após a folga de 15%.",
  CONTRIBUICAO_AQUISICAO_NAO_VERIFICADA_OU_INSUFICIENTE: "Verificar contribuição positiva antes de aquisição.",
  CUSTOS_EXCEDEM_META: "Os custos ultrapassam o limite compatível com a meta.",
  SEM_FOLGA_PARA_CAC: "Sem contribuição disponível para CAC preservando 35%.",
  PRAZO_ENCERRADO: "O prazo de 31/12/2026 está encerrado.",
  REALIZADO_CONTEM_DIAS_NAO_ENCERRADOS: "O período realizado inclui dias ainda não encerrados.",
  CONTRATOS_SOBREPOSTOS_POR_CLIENTE: "Revisar contratos sobrepostos do mesmo cliente.",
}[codigo] ?? codigo);
const dinheiro = (valor: number | null) => valor === null ? "Não comprovado" : reais(valor);
const margem = (valor: number | null) => valor === null ? "Não calculável" : `${(valor / 100).toLocaleString("pt-BR")}%`;

export function MetasCrescimentoTela() {
  const [base, setBase] = useState<BaseMetasCrescimento | null>(null);
  const [resultado, setResultado] = useState<ResultadoMetasCrescimento | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    let atual = true;
    api<BaseMetasCrescimento>("/api/crescimento/metas").then((dados) => { if (atual) setBase(dados); })
      .catch((falha: Error) => { if (atual) setErro(falha.message); });
    return () => { atual = false; };
  }, []);

  async function calcular(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!base) return;
    const formulario = new FormData(evento.currentTarget);
    const texto = (chave: string) => String(formulario.get(chave) ?? "");
    const marcado = (chave: string) => formulario.get(chave) === "on";
    function valor(chave: string, monetario = true): number | null {
      const entrada = texto(chave).trim();
      if (!entrada) return null;
      const numero = monetario ? paraCentavos(entrada) : Number(entrada.replace(",", "."));
      if (!Number.isSafeInteger(numero) || numero < 0) throw new Error("Informe valores válidos, sem centavos ou minutos fracionários.");
      return numero;
    }
    setErro(""); setResultado(null); setOcupado(true);
    try {
      const entrada: EntradaMetasCrescimento = {
        referencia: base.referencia, fuso: base.fuso,
        realizado: { inicio: texto("inicio"), fimExclusivo: texto("fim"), receitaAssinaturasLiquidaCentavos: valor("receitaPlanos")!,
          receitaOutrasVendasLiquidaCentavos: valor("receitaOutras")!, descontosEstornosJaDeduzidosCentavos: valor("descontos")!,
          custosTotaisCentavos: valor("custosRealizados"), custosCompletos: marcado("custosCompletos") },
        assinantesAdimplentes: base.assinantesComprovados, assinantesAtrasados: base.assinantesAtrasados,
        contratos: base.contratos, contratosCompletos: marcado("contratosCompletos"), cancelamentos: [],
        dezembro: { outrasVendasLiquidasCentavos: valor("outrasDezembro"), custosBaseCentavos: valor("custosDezembro"), custosCompletos: marcado("dezembroCompleto") },
        aquisicao: { contribuicaoVerificada: marcado("contribuicao"), receitaLiquidaPorNovoDezembroCentavos: valor("receitaNovo"),
          custosVariaveisPorNovoCentavos: valor("variaveisNovo"), custoIndicacaoTotalPorNovoCentavos: valor("indicacao")!,
          creditoIndicacaoJaDeduzidoReceitaPorNovoCentavos: valor("credito")! },
        capacidade: { verificada: marcado("capacidade"), duracaoVisitaMinutos: valor("duracao", false),
          minutosOfertaveisDezembro: valor("oferta", false), minutosOutrasVendasDezembro: valor("outrasMinutos", false),
          visitasPlanejadasPorAssinante: Number(texto("visitas")) as 2 | 3 | 4 },
      };
      setResultado(await api<ResultadoMetasCrescimento>("/api/crescimento/metas", { method: "POST", body: entrada }));
    } catch (falha) { setErro((falha as Error).message); }
    finally { setOcupado(false); }
  }

  return <div className="space-y-4">
    <header className="crm-page-header"><p className="eyebrow">Crescimento rentável</p>
      <h1 className="titulo-marca text-2xl">Metas até 31/12/2026</h1>
      <p className="text-sm text-zinc-500">400 assinantes adimplentes · R$ 70.000 em receita de dezembro · margem líquida de 35%.</p>
      <Link className="text-sm underline" href="/campanhas">Voltar às campanhas</Link></header>
    <p className="cartao text-sm">Meta de lucro: R$ 24.500. Limite de todos os custos: R$ 45.500. Este painel prepara cenários; não é DRE conciliada e não aprova gastos.</p>
    {erro && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
    {!base && !erro && <p role="status">Consultando a base local…</p>}
    {base && <>
      <section className="cartao space-y-2"><h2 className="font-semibold">Fotografia local de {base.referencia}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["Cadastros de assinatura não cancelados", base.assinantesNominais], ["Adimplentes comprovados localmente", base.assinantesComprovados],
          ["Atrasados", base.assinantesAtrasados], ["Outros sem comprovação", base.outrosSemComprovacao]].map(([rotulo, total]) => <p key={rotulo} className="text-sm">{rotulo}<strong className="block text-2xl">{total}</strong></p>)}</div>
        <p className="text-sm">Valor mensal nominal dos contratos: {reais(base.mrrNominalCentavos)}. Esse valor não é receita reconhecida.</p>
        {base.limitacoes.map((limite) => <p key={limite} className="text-xs text-zinc-500">{limite}</p>)}
        {base.coberturaTruncada && <p role="alert">Base maior que o limite de consulta: cobertura incompleta.</p>}
        <details><summary className="cursor-pointer text-sm underline">Contratos por plano e valor contratado</summary>
          <ul className="mt-2 text-sm">{base.porPlano.map((plano, indice) => <li key={indice}>{plano.plano}: {plano.contratos} × {reais(plano.valorContratoCentavos)}</li>)}</ul></details>
      </section>
      <form className="cartao space-y-4" onSubmit={calcular} onChange={() => setResultado(null)}>
        <h2 className="font-semibold">Preencher e revisar o cenário</h2>
        <p className="text-sm text-zinc-500">Use fontes verificadas. Deixe custos e previsões desconhecidos em branco. Receita é líquida de descontos e estornos. Não use saldo bancário ou MRR. A receita por novo deve considerar só os dias cobertos em dezembro.</p>
        <p className="text-xs text-zinc-500">Custos completos incluem comissões, insumos, taxas, tributos, equipe, pró-labore e fixos. Zero significa valor conferido, não informação ausente.</p>
        <div className="grid gap-3 sm:grid-cols-2"><label className="rotulo">Início do período realizado<input className="campo" name="inicio" type="date" required /></label>
          <label className="rotulo">Fim do período realizado (exclusivo)<input className="campo" name="fim" type="date" required max={base.referencia} /></label>
          {valores.map(([nome, rotulo, obrigatorio]) => <label key={nome} className="rotulo">{rotulo}<input className="campo" name={nome} inputMode="decimal" required={obrigatorio} /></label>)}
          {[["duracao", "Duração real por visita (minutos)"], ["oferta", "Escala ofertável de dezembro, após pausas/bloqueios (minutos)"], ["outrasMinutos", "Demanda de outras vendas em dezembro (minutos)"]].map(([nome, rotulo]) =>
            <label key={nome} className="rotulo">{rotulo}<input className="campo" name={nome} type="number" min="0" step="1" /></label>)}
          <label className="rotulo">Cenário de visitas por assinante<select className="campo" name="visitas" defaultValue="4"><option value="2">2 visitas/mês</option><option value="3">3 visitas/mês</option><option value="4">4 visitas/mês</option></select></label>
        </div>
        <div className="space-y-2 text-sm">{[["custosCompletos", "Conferi todos os custos da competência realizada."], ["dezembroCompleto", "Conferi todos os custos-base de dezembro; novos adicionais entram separadamente."],
          ["contribuicao", "A contribuição por novo está verificada na mesma janela de dezembro."], ["capacidade", "Duração, escala e demanda adicional conferidas; será preservada folga de 15%."],
          ["contratosCompletos", "Revisei valores líquidos, cobertura dos contratos e cancelamentos futuros; não há contratos ausentes."]].map(([nome, rotulo]) =>
          <label key={nome} className="flex items-start gap-2"><input name={nome} type="checkbox" disabled={nome === "contratosCompletos" && (base.outrosSemComprovacao > 0 || base.coberturaTruncada)} />{rotulo}</label>)}</div>
        <p className="text-xs text-zinc-500">Contratos sem prova permanecem fora da projeção. Para corrigir classificação ou cancelamentos use a gestão de assinaturas e consulte novamente; este formulário não altera a base.</p>
        <button className="btn-primario" type="submit" disabled={ocupado}>{ocupado ? "Calculando…" : "Calcular cenário para revisão"}</button>
      </form>
    </>}
    {resultado && <section className="cartao space-y-3" aria-live="polite"><h2 className="font-semibold">Resultado do cenário</h2>
      <div className="grid gap-3 text-sm sm:grid-cols-2">{[
        ["Adimplentes projetados em 31/12", String(resultado.assinantesAdimplentesProjetados)], ["Novos ainda necessários", String(resultado.novosAdimplentesNecessarios)],
        ["Receita dos contratos em dezembro, proporcional aos dias", dinheiro(resultado.receitaContratosDezembroCentavos)], ["Receita total de dezembro projetada", dinheiro(resultado.receitaDezembroCenarioCentavos)],
        ["Outras vendas ainda necessárias além da previsão", dinheiro(resultado.bridgeOutrasVendasCentavos)], ["Margem líquida realizada", margem(resultado.margemLiquidaRealizadaPontosBase)],
        ["Lucro projetado antes do CAC candidato", dinheiro(resultado.lucroDezembroCenarioCentavos)], ["Margem projetada antes do CAC candidato", margem(resultado.margemLiquidaDezembroPontosBase)],
        ["Contribuição por novo em dezembro", dinheiro(resultado.contribuicaoPorNovoCentavos)], ["Teto candidato de CAC por novo", dinheiro(resultado.cacMaximoCandidatoCentavos)],
        ["Teto candidato agregado para revisão", dinheiro(resultado.tetoOrcamentoCandidatoCentavos)],
      ].map(([rotulo, valor]) => <p key={rotulo}>{rotulo}<strong className="block">{valor}</strong></p>)}</div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left font-semibold">Capacidade mensal com folga de 15%</caption>
        <thead><tr><th>Visitas por assinante</th><th>Horas necessárias</th><th>Horas utilizáveis</th><th>Viável</th></tr></thead>
        <tbody>{resultado.cenariosCapacidade.map((cenario) => <tr key={cenario.visitasPorAssinante}><td>{cenario.visitasPorAssinante}</td>
          <td>{cenario.horasNecessarias?.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) ?? "Desconhecidas"}</td>
          <td>{cenario.minutosUtilizaveis === null ? "Desconhecidas" : (cenario.minutosUtilizaveis / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>
          <td>{cenario.viavel === null ? "Não verificado" : cenario.viavel ? "Sim, no total mensal" : "Não"}</td></tr>)}</tbody></table></div>
      <p className="text-sm">Conferir distribuição por profissional, serviço e dia antes de qualquer ação. Orçamento aprovado: não.</p>
      {resultado.bloqueios.length > 0 ? <ul className="list-inside list-disc text-sm text-amber-800">{resultado.bloqueios.map((codigo) => <li key={codigo}>{pendencia(codigo)}</li>)}</ul> : <p className="text-sm">Sem bloqueios matemáticos com as premissas informadas. Gasto e campanha continuam dependendo de decisão específica.</p>}
    </section>}
  </div>;
}
