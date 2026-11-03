"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarDays, ChartNoAxesCombined, CircleCheck } from "lucide-react";
import { reais } from "@/lib/cliente-api";
import { GraficoLinhaCrm, GraficoRoscaCrm } from "@/components/visual/GraficosCrm";
import { ContadorCrm } from "@/components/visual/ContadorCrm";
import { ocupacaoPorDia, type PicoCrm } from "./dados-visao-crm";
import styles from "./visao-crm.module.css";

type Props = { pico: PicoCrm | null; verResultado: boolean;
  vendas: { porTipo: { servicos: number; bar: number; loja: number; outros: number } };
  dia: { atendimentos: number; concluidos: number; ocupacao: number | null };
};
const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const percentual = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";

/** Apresenta somente valores que o painel já recebeu conforme as permissões da sessão. */
export function VisaoCrm({ pico, verResultado, vendas, dia }: Props) {
  const distribuicao = [
    { rotulo: "Serviços", valor: vendas.porTipo.servicos, cor: "#c6f566" },
    { rotulo: "Bar", valor: vendas.porTipo.bar, cor: "#eca58e" },
    { rotulo: "Loja", valor: vendas.porTipo.loja, cor: "#91c4e4" },
    { rotulo: "Outros", valor: vendas.porTipo.outros, cor: "#85d8af" },
  ];
  const valores = pico ? ocupacaoPorDia(pico) : [];
  const comHistorico = valores.filter((v): v is number => v !== null);
  const media = comHistorico.length ? comHistorico.reduce((s, v) => s + v, 0) / comHistorico.length : null;
  return <section className={styles.grade} aria-label="Visão gráfica da operação">
    <article className={`cartao ${styles.principal}`}>
      <div className={styles.cabecalho}><div><p className={styles.rotulo}>Ritmo da operação</p><h2 className={styles.titulo}>Sua semana, em perspectiva.</h2></div>
        <Link className={styles.atalho} href={verResultado ? "/indicadores#ocupacao" : "/recepcao"} aria-label={verResultado ? "Abrir indicadores de ocupação" : "Abrir a agenda"}><ArrowUpRight size={18} /></Link>
      </div>
      {verResultado && pico && comHistorico.length ? <>
        <div className={styles.numero}><ContadorCrm valor={media!} formatar={percentual} /><span>Média das faixas por dia · últimos {pico.dias} dias</span></div>
        <GraficoLinhaCrm rotulo="Ocupação média das faixas de horário por dia da semana" rotulos={pico.linhas.map(l => dias[l.diaSemana])} series={[{ nome: "Ocupação", cor: "#eca58e", valores }]} formatar={percentual} />
      </> : <>
        <div className={styles.operacao}>
          <div><CalendarDays size={21} /><strong>{dia.atendimentos}</strong><span>Agendamentos hoje</span></div>
          <div><CircleCheck size={21} /><strong>{dia.concluidos}</strong><span>Atendimentos concluídos</span></div>
          <div><ChartNoAxesCombined size={21} /><strong>{dia.ocupacao === null ? "—" : percentual(dia.ocupacao * 100)}</strong><span>Ocupação hoje</span></div>
        </div>
        <p className={styles.nota}>{verResultado ? "O gráfico da semana aparece quando houver histórico de ocupação." : "Acompanhe os horários e os atendimentos na agenda."}</p>
      </>}
    </article>
    <article className={`cartao ${styles.distribuicao}`}>
      <div className={styles.cabecalho}><h2 className={styles.rotulo}>Composição do balcão</h2><Link className={styles.atalho} href="/comandas" aria-label="Abrir comandas"><ArrowUpRight size={18} /></Link></div>
      <p className={styles.nota}>Valores dos itens em comandas fechadas hoje.</p>
      <GraficoRoscaCrm rotulo="Distribuição dos itens vendidos hoje" itens={distribuicao} formatar={reais} />
    </article>
  </section>;
}
