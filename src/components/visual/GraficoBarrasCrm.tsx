"use client";

import type { CSSProperties } from "react";
import { CORES_CRM } from "./GraficosCrm";
import { dominioCrm, valorDisponivel } from "./graficos-crm-regras";
import styles from "./barras-crm.module.css";

type Item = { rotulo: string; valor: number | null; cor?: string; nota?: string };

/** Comparação legível sem interação. Ausência e valores negativos permanecem explícitos. */
export function GraficoBarrasCrm({ itens, rotulo, formatar = (n) => n.toLocaleString("pt-BR"), maximo }: {
  itens: Item[]; rotulo: string; formatar?: (n: number) => string; maximo?: number;
}) {
  const [min, max] = dominioCrm([itens.map(i => i.valor), valorDisponivel(maximo) ? [maximo] : []]);
  const fator = Math.max(1, Math.abs(min), Math.abs(max));
  const posicao = (n: number) => (n / fator - min / fator) / (max / fator - min / fator) * 100;
  const zero = posicao(0);
  return <figure className={styles.figura} aria-label={rotulo}>
    {!itens.length ? <p className={styles.vazio}>Sem dados disponíveis neste período.</p> : <dl className={styles.lista}>
      {itens.map((item, indice) => {
        const valor = item.valor;
        const disponivel = valorDisponivel(valor);
        const ponto = disponivel ? posicao(valor) : zero;
        return <div key={`${indice}:${item.rotulo}`} className={styles.item}>
          <div className={styles.leitura}><dt>{item.rotulo}{item.nota && <small>{item.nota}</small>}</dt><dd>{disponivel ? formatar(valor) : "—"}</dd></div>
          <div className={styles.trilho} aria-hidden="true">
            <span className={styles.zero} style={{ left: `${zero}%` }} />
            <span key={`${item.rotulo}:${item.valor}`} className={styles.barra} style={{
              left: `${Math.min(zero, ponto)}%`, width: `${Math.abs(ponto - zero)}%`,
              background: item.cor ?? CORES_CRM[indice % CORES_CRM.length],
              transformOrigin: item.valor !== null && item.valor < 0 ? "right" : "left",
              "--atraso": `${Math.min(indice, 8) * 45}ms`,
            } as CSSProperties} />
          </div>
        </div>;
      })}
    </dl>}
  </figure>;
}
