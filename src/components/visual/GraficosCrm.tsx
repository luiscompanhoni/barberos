"use client";

import { useId, useState, type CSSProperties } from "react";
import { dominioCrm, segmentosCrm, resumoRoscaCrm, parcelasRoscaCrm, valorDisponivel, type ValorCrm } from "./graficos-crm-regras";
import styles from "./graficos-crm.module.css";

export const CORES_CRM = ["var(--color-ouro, #c6f566)", "#eca58e", "#91c4e4", "#85d8af", "#d2a3d7", "#d9d6c4"];
const numero = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
type Serie = { nome: string; cor?: string; valores: ValorCrm[] };
type Item = { rotulo: string; valor: ValorCrm; cor?: string };
type Ponto = { x: number; y: number };

function curva(pontos: Ponto[]) {
  // Controles entre os extremos mantêm a curva dentro do intervalo observado.
  return pontos.map((p, i) => {
    if (!i) return `M${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    const a = pontos[i - 1], dx = (p.x - a.x) * .42;
    return `C${(a.x + dx).toFixed(2)},${a.y.toFixed(2)} ${(p.x - dx).toFixed(2)},${p.y.toFixed(2)} ${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  }).join(" ");
}

export function GraficoLinhaCrm({ series, rotulos, formatar = numero, rotulo }: {
  series: Serie[]; rotulos: string[]; formatar?: (n: number) => string; rotulo: string;
}) {
  const id = useId().replace(/:/g, "");
  const [foco, setFoco] = useState<number | null>(null);
  const quantidade = Math.max(rotulos.length, ...series.map(s => s.valores.length), 0);
  const [min, max] = dominioCrm(series.map(s => s.valores));
  const w = 720, h = 270, margem = { l: 72, r: 16, t: 18, b: 34 };
  const largura = w - margem.l - margem.r, altura = h - margem.t - margem.b;
  const x = (n: number) => margem.l + (quantidade > 1 ? n / (quantidade - 1) : .5) * largura;
  const fator = Math.max(1, Math.abs(min), Math.abs(max));
  const y = (v: number) => margem.t + (1 - (v / fator - min / fator) / (max / fator - min / fator)) * altura;
  const nome = (n: number) => rotulos[n] ?? String(n + 1);
  const selecionado = foco === null ? Math.max(0, quantidade - 1) : Math.min(foco, quantidade - 1);
  const disponivel = series.some(s => s.valores.some(valorDisponivel));
  if (!quantidade || !disponivel) return <p className={styles.vazio}>Sem dados disponíveis para {rotulo.toLocaleLowerCase("pt-BR")}.</p>;
  return <figure className={styles.grafico} aria-label={rotulo}>
    <ul className={styles.series}>{series.map((s, i) => <li key={s.nome}><span style={{ background: s.cor ?? CORES_CRM[i % CORES_CRM.length] }} />{s.nome}</li>)}</ul>
    <div className={styles.linhaEntrada}>
      <svg viewBox={`0 0 ${w} ${h}`} className={styles.svg} aria-hidden="true" onPointerLeave={() => setFoco(null)} onPointerMove={e => {
        const rect = e.currentTarget.getBoundingClientRect();
        const posicao = (e.clientX - rect.left) / rect.width * w;
        setFoco(Math.min(quantidade - 1, Math.max(0, Math.round((posicao - margem.l) / largura * (quantidade - 1)))));
      }}>
        <defs>{series.map((s, i) => <linearGradient key={s.nome} id={`${id}-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.cor ?? CORES_CRM[i % CORES_CRM.length]} stopOpacity=".2" /><stop offset="100%" stopColor={s.cor ?? CORES_CRM[i % CORES_CRM.length]} stopOpacity="0" /></linearGradient>)}</defs>
        {[0, .5, 1].map(p => { const valor = min * (1 - p) + max * p; return <g key={p}>
          <line x1={margem.l} x2={w - margem.r} y1={y(valor)} y2={y(valor)} className={styles.grade} />
          <text x={margem.l - 10} y={y(valor) + 4} textAnchor="end" className={styles.eixo}>{formatar(valor)}</text>
        </g>; })}
        {min < 0 && <line x1={margem.l} x2={w - margem.r} y1={y(0)} y2={y(0)} className={styles.zero} />}
        {series.map((s, i) => segmentosCrm(s.valores).map((segmento, j) => {
          const pontos = segmento.map(p => ({ x: x(p.indice), y: y(p.valor) })), caminho = curva(pontos), cor = s.cor ?? CORES_CRM[i % CORES_CRM.length];
          return <g key={`${s.nome}-${j}-${caminho}`}>
            {pontos.length > 1 ? <><path d={`${caminho} L${pontos.at(-1)!.x},${y(0)} L${pontos[0].x},${y(0)} Z`} fill={`url(#${id}-${i})`} /><path d={caminho} className={styles.curva} pathLength={1} stroke={cor} style={{ animationDelay: `${i * 90}ms` }} /></> : <circle cx={pontos[0].x} cy={pontos[0].y} r="3" fill={cor} />}
          </g>;
        }))}
        {foco !== null && <line x1={x(selecionado)} x2={x(selecionado)} y1={margem.t} y2={h - margem.b} className={styles.zero} />}
        {series.map((s, i) => valorDisponivel(s.valores[selecionado]) ? <circle key={s.nome} cx={x(selecionado)} cy={y(s.valores[selecionado]!)} r={foco === null ? 0 : 4} fill={s.cor ?? CORES_CRM[i % CORES_CRM.length]} stroke="#182019" strokeWidth="2" /> : null)}
        {Array.from(new Set([0, Math.floor((quantidade - 1) / 2), quantidade - 1])).map(n => <text key={n} x={x(n)} y={h - 8} textAnchor="middle" className={styles.eixo}>{nome(n)}</text>)}
      </svg>
    </div>
    <div className={styles.leitura}><span>{nome(selecionado)}</span>{series.map((s, i) => <span key={s.nome}><i style={{ background: s.cor ?? CORES_CRM[i % CORES_CRM.length] }} />{s.nome} <b>{valorDisponivel(s.valores[selecionado]) ? formatar(s.valores[selecionado]!) : "—"}</b></span>)}</div>
    <label className={styles.explorar}>Explorar período<input aria-label={`Explorar ${rotulo}`} type="range" min={0} max={quantidade - 1} value={selecionado} disabled={quantidade <= 1} aria-valuetext={`${nome(selecionado)}. ${series.map(s => `${s.nome}: ${valorDisponivel(s.valores[selecionado]) ? formatar(s.valores[selecionado]!) : "indisponível"}`).join(". ")}`} onChange={e => setFoco(Number(e.target.value))} /></label>
  </figure>;
}

export function GraficoRoscaCrm({ itens, formatar = numero, rotulo }: { itens: Item[]; formatar?: (n: number) => string; rotulo: string }) {
  const resumo = resumoRoscaCrm(itens);
  const centro = resumo.total === null ? "—" : formatar(resumo.total);
  const parcelas = parcelasRoscaCrm(itens, resumo.total, resumo.desenhar);
  const arcos = itens.map((item, i) => {
    return { ...item, cor: item.cor ?? CORES_CRM[i % CORES_CRM.length], ...parcelas[i] };
  });
  return <figure className={styles.rosca} aria-label={rotulo}>
    <div className={styles.anelEntrada}>
      <svg viewBox="0 0 220 220" className={styles.anel} aria-hidden="true">
        <circle cx="110" cy="110" r="82" fill="none" stroke="currentColor" strokeOpacity=".08" strokeWidth="24" />
        {resumo.desenhar && arcos.filter(a => a.tamanho > 0).map((a, i) => {
          const arco = `${Math.max(.001, a.tamanho - Math.min(.8, a.tamanho / 5))} ${100 - Math.max(.001, a.tamanho - Math.min(.8, a.tamanho / 5))}`;
          return <circle key={`${a.rotulo}-${a.valor}`} className={styles.arco} cx="110" cy="110" r="82" pathLength="100" fill="none" stroke={a.cor} strokeWidth="24" strokeDasharray={arco} strokeDashoffset={-a.inicio} style={{ "--arco": arco, animationDelay: `${i * 60}ms` } as CSSProperties} transform="rotate(-90 110 110)" />;
        })}
      </svg>
      <div className={styles.centro}><strong style={{ fontSize: `${Math.max(10, Math.min(22, 185 / centro.length))}px` }}>{centro}</strong><span>Total do período</span></div>
    </div>
    <div className={styles.detalhes}>
      {!resumo.desenhar && <p className={styles.vazio}>{resumo.indisponivel ? "Há valores indisponíveis. Confira os dados abaixo." : resumo.negativo ? "Há valores negativos; confira os valores abaixo." : "Sem movimentação no período."}</p>}
      <ul className={styles.legenda}>{arcos.map(a => <li key={a.rotulo}><i style={{ background: a.cor }} /><span>{a.rotulo}</span><strong>{valorDisponivel(a.valor) ? formatar(a.valor) : "—"}</strong>{resumo.desenhar && <small>{(a.tamanho).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</small>}</li>)}</ul>
    </div>
  </figure>;
}
