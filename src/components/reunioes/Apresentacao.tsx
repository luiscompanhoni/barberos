"use client";

import { useEffect, useRef, useState } from "react";
import { reais } from "@/lib/cliente-api";
import type { ReuniaoResposta } from "@/lib/reunioes/tipos";
import type { Aviso } from "./ChecklistAvisos";
import styles from "./reunioes.module.css";

type Slide = { titulo: string; linhas: string[] };
export function slidesDaReuniao(r: ReuniaoResposta, avisos: Aviso[] = []): Slide[] {
  const s = r.snapshot;
  const slides: Slide[] = [
    { titulo: r.titulo, linhas: [`${r.inicio} a ${r.fim}`, "Onde estamos · onde queremos chegar"] },
    { titulo: "Onde estamos", linhas: [`${s.atual.atendimentos} atendimentos concluídos`, `Faturamento: ${reais(s.atual.faturamentoCentavos)}`, `Período anterior: ${reais(s.anterior.faturamentoCentavos)}`, s.atual.ocupacao === null ? "Ocupação: sem dados suficientes" : `Ocupação: ${Math.round(s.atual.ocupacao * 100)}%`] },
  ];
  for (const l of s.leituras.slice(0, 2)) slides.push({ titulo: l.titulo, linhas: [l.detalhe, `Próximo passo: ${l.acao}`] });
  const pendentes = avisos.filter(a => !a.concluido);
  const objetivos = pendentes.filter(a => a.tipo === "OBJETIVO").map(a => a.texto);
  const avisosEquipe = pendentes.filter(a => a.tipo === "AVISO").map(a => a.texto);
  const adicionar = (titulo: string, linhas: string[]) => {
    const partes = linhas.flatMap(linha => linha.match(/.{1,150}(?:\s|$)|\S{1,150}/g)?.map(t => t.trim()) ?? []);
    for (let i = 0; i < partes.length; i += 3) slides.push({ titulo, linhas: partes.slice(i, i + 3) });
  };
  adicionar("Onde queremos chegar", objetivos.length ? objetivos : ["Objetivo ainda não informado. Cadastre-o nos avisos da semana."]);
  adicionar("Avisos para a equipe", avisosEquipe);
  if (r.conteudo) adicionar("Notas da gestão", r.conteudo.split("\n").filter(Boolean));
  adicionar("Próximos passos", r.acoes.map(a => `${a.concluida ? "Concluída: " : ""}${a.texto} · ${a.responsavel} · até ${a.prazo}`));
  slides.push({ titulo: "Detalhes e critérios", linhas: ["O relatório da reunião contém os demais indicadores e critérios.", "Resultados são do retrato salvo. Avisos e objetivos são os pendentes no momento de abrir a apresentação."] });
  return slides;
}

export function Apresentacao({ reuniao, avisos, onFechar }: { reuniao: ReuniaoResposta; avisos: Aviso[]; onFechar: () => void }) {
  const slides = slidesDaReuniao(reuniao, avisos), [indice, setIndice] = useState(0), ref = useRef<HTMLDivElement>(null);
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
    {slides.map((slide, i) => <article key={i} className={`${styles.slide} ${i === indice ? styles.ativo : styles.inativo}`} aria-hidden={i !== indice}><div className={styles.slideTopo}><p>BLACK · REUNIÕES</p><span>{String(i + 1).padStart(2, "0")}</span></div><h2 className={styles.slideTitulo}>{slide.titulo}</h2><ul className={styles.slideLista}>{slide.linhas.map((linha, j) => <li key={j}>{linha}</li>)}</ul></article>)}
    <div className={styles.controles}><button className="btn" disabled={indice === 0} onClick={() => setIndice((i) => i - 1)}>Anterior</button><span aria-live="polite">{indice + 1} / {slides.length}</span><button className="btn-primario" disabled={indice === slides.length - 1} onClick={() => setIndice((i) => i + 1)}>Próximo</button></div>
  </div>;
}
