"use client";

import { useEffect, useRef, useState } from "react";
import { reais } from "@/lib/cliente-api";
import type { GrupoReuniao, ReuniaoResposta } from "@/lib/reunioes/tipos";
import styles from "./reunioes.module.css";

type Slide = { titulo: string; linhas: string[] };
const linhasGrupos = (gs: GrupoReuniao[]) => gs.map((g) => `${g.nome}: ${g.atendimentos} serviços · ${reais(g.vendasCentavos)} em vendas · ${reais(g.receitaAssinaturasCentavos)} de assinaturas atribuídas${g.comissaoCentavos === null ? "" : ` · comissão ${reais(g.comissaoCentavos)}`}`);
function slidesDaReuniao(r: ReuniaoResposta): Slide[] {
  const s = r.snapshot;
  const slides: Slide[] = [
    { titulo: r.titulo, linhas: [`${r.inicio} a ${r.fim}`, r.tipo === "DIARIA" ? "Reunião diária · roteiro de 20 minutos" : "Reunião semanal · roteiro de 60 minutos", "Resultados, oportunidades e próximos passos"] },
    { titulo: "Resultado da barbearia", linhas: [`Faturamento: ${reais(s.atual.faturamentoCentavos)}`, `${s.atual.atendimentos} atendimentos · ${s.atual.avulsos} avulsos · ${s.atual.assinantes} pelo plano`, `Período anterior: ${reais(s.anterior.faturamentoCentavos)}`, `Acumulado do mês até ${s.mes.fim}: ${reais(s.mes.faturamentoCentavos)}`] },
  ];
  for (const d of s.diaria) slides.push({ titulo: `Hoje · ${d.nome}`, linhas: [
    `${d.clientes} clientes na agenda · ${d.avulsos} avulsos · ${d.assinantes} pelo plano`,
    `Receita avulsa prevista: ${reais(d.receitaPrevistaCentavos)}${d.comissaoAvulsaCentavos === null ? "" : ` · comissão ${reais(d.comissaoAvulsaCentavos)}`}`,
    ...d.cenarios.slice(0, 3).map((c) => `${c.servico}: até ${c.quantidadeMaxima} encaixe(s), potencial adicional de ${reais(c.receitaAdicionalCentavos)}${c.comissaoAdicionalCentavos === null ? "" : ` · comissão adicional ${reais(c.comissaoAdicionalCentavos)}`}`),
    "Cenários alternativos: não somar capacidades que ocupam os mesmos horários.", ...d.prioridades,
  ] });
  for (const [titulo, grupos] of [["Por barbeiro", s.barbeiros], ["Por cadeira", s.cadeiras], ["Serviços e produtos", s.servicos]] as const) {
    for (let i = 0; i < grupos.length; i += 6) slides.push({ titulo, linhas: linhasGrupos(grupos.slice(i, i + 6)) });
  }
  if (s.qualidade.length) slides.push({ titulo: "Qualidade percebida pelos clientes", linhas: s.qualidade.map((q) => `${q.nome}: ${q.media === null ? "avaliações em formação" : `${q.media.toFixed(1)} de 5 estrelas`}`) });
  for (const l of s.leituras) slides.push({ titulo: l.titulo, linhas: [l.detalhe, l.acao] });
  if (s.financeiro) slides.push({ titulo: `Gestão financeira · ${s.financeiro.mes}`, linhas: [`Recebimentos líquidos: ${reais(s.financeiro.receitasCentavos)}`, `Despesas pagas: ${reais(s.financeiro.despesasCentavos)}`, `Resultado de caixa: ${reais(s.financeiro.resultadoCaixaCentavos)}`, "Resultado dos registros financeiros. Margem e lucro têm bases distintas."] });
  if (r.conteudo) slides.push({ titulo: "Conteúdo, metas e treinamento", linhas: r.conteudo.split("\n").filter(Boolean) });
  if (r.acoes.length) slides.push({ titulo: "Próximos passos", linhas: r.acoes.map((a) => `${a.concluida ? "Concluída: " : ""}${a.texto} · ${a.responsavel} · até ${a.prazo}`) });
  slides.push({ titulo: "Critérios desta apresentação", linhas: ["Receita de assinaturas distribuída já integra o total da casa.", "Oportunidades representam estimativas, sujeitas a agenda e aceitação.", "Dados preservados conforme o retrato gerado para esta reunião."] });
  return slides;
}

export function Apresentacao({ reuniao, onFechar }: { reuniao: ReuniaoResposta; onFechar: () => void }) {
  const slides = slidesDaReuniao(reuniao), [indice, setIndice] = useState(0), ref = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    const antigo = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
      if (e.key === "ArrowRight") setIndice((i) => Math.min(slides.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndice((i) => Math.max(0, i - 1));
      if (e.key === "Tab") {
        const els = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const primeiro = els[0], ultimo = els.at(-1);
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo?.focus(); }
        if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro?.focus(); }
      }
    };
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); antigo?.focus(); };
  }, [onFechar, slides.length]);
  return <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Apresentação da reunião" className={styles.apresentacao}>
    <div className={styles.controles}><span className="text-sm">{reuniao.apresentacaoEquipe ? "Versão da equipe" : "Gestão · pode conter dados reservados"}</span><button className="btn" onClick={() => ref.current?.requestFullscreen().catch(() => setErro("Tela cheia indisponível neste navegador. A apresentação continua aberta."))}>Tela cheia</button><button className="btn" onClick={() => window.print()}>Imprimir / PDF</button><button className="btn" onClick={onFechar}>Fechar</button></div>
    {erro && <p role="status" className="text-sm text-amber-600">{erro}</p>}
    {slides.map((slide, i) => <article key={i} className={`${styles.slide} ${i === indice ? styles.ativo : styles.inativo}`} aria-hidden={i !== indice}><p className="text-xs uppercase tracking-widest text-ouro">BLACK · REUNIÕES</p><h2 className="mt-5 text-3xl font-semibold sm:text-5xl">{slide.titulo}</h2><ul className="mt-8 space-y-5 text-lg sm:text-2xl">{slide.linhas.map((linha, j) => <li key={j}>{linha}</li>)}</ul></article>)}
    <div className={styles.controles}><button className="btn" disabled={indice === 0} onClick={() => setIndice((i) => i - 1)}>Anterior</button><span aria-live="polite">{indice + 1} / {slides.length}</span><button className="btn-primario" disabled={indice === slides.length - 1} onClick={() => setIndice((i) => i + 1)}>Próximo</button></div>
  </div>;
}
