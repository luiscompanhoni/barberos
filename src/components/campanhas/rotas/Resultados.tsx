import { useState } from "react";
import {
  Activity, ArrowDownToLine, ArrowUpRight, BadgeCheck, ChartColumnIncreasing, ChevronRight,
  Clock3, Crosshair, MessageCircle, Route as IconeRota, UserRound, Users,
} from "lucide-react";
import { CANAIS, contarJornadas, conversao, relatorioCsv, type Contagem, type Jornada, type Rota } from "@/lib/campanhas/rotas-demo";
import { ICONE_CANAL, ICONE_EVENTO } from "./icones";
import f from "./form.module.css";
import r from "./resultados.module.css";
import s from "./tela.module.css";

const numero = new Intl.NumberFormat("pt-BR");
const dia = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export function Indicadores({ total }: { total: Contagem }) {
  const indicadores = [
    { titulo: "Entradas nas rotas", valor: numero.format(total.entradas), icon: Users, tom: "entrada" },
    { titulo: "Conversas iniciadas", valor: numero.format(total.conversas), icon: MessageCircle, tom: "whatsapp" },
    { titulo: "Vendas concluídas", valor: numero.format(total.vendas), icon: BadgeCheck, tom: "venda" },
    { titulo: "Conversão", valor: conversao(total), icon: Activity, tom: "relatorio" },
  ];
  return (
    <dl className={r.indicadores} aria-label="Resumo do desempenho simulado">
      {indicadores.map(({ titulo, valor, icon: Icone, tom }) => (
        <div key={titulo} className={`${s.painel} ${r.kpi}`}>
          <dt>{titulo}<span className={r.kpiIcone} data-tom={tom} aria-hidden="true"><Icone size={19} /></span></dt>
          <dd>{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Desempenho({ rotas, jornadas }: { rotas: Rota[]; jornadas: Jornada[] }) {
  const linhas = rotas.map((rota) => ({ rota, total: contarJornadas(jornadas.filter((j) => j.origem.id === rota.id)) }));

  function exportar() {
    const url = URL.createObjectURL(new Blob(["\uFEFF", relatorioCsv(rotas, jornadas)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "barberos-desempenho-simulado.csv";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return (
    <section className={`${s.painel} ${r.relatorio}`} aria-labelledby="titulo-desempenho">
      <header className={r.topoResultados}>
        <div>
          <div className={s.tituloPainel}>
            <ChartColumnIncreasing size={19} aria-hidden="true" /><h2 id="titulo-desempenho">Desempenho por rota</h2>
          </div>
          <p>Inclui a amostra inicial e os clientes fictícios que você simular.</p>
        </div>
        <button type="button" className={s.botao} onClick={exportar}><ArrowDownToLine size={16} aria-hidden="true" /> Exportar CSV</button>
      </header>
      <div className={r.tabela} role="region" aria-label="Tabela de desempenho por canal" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">Rota</th><th scope="col">Entradas</th><th scope="col">Conversas</th><th scope="col">Vendas</th><th scope="col">Conversão</th></tr></thead>
          <tbody>
            {linhas.map(({ rota, total }) => {
              const Icone = ICONE_CANAL[rota.canal];
              return (
                <tr key={rota.id}>
                  <th scope="row"><span className={r.nomeRelatorio}>
                    <span className={r.kpiIcone} data-canal={rota.canal}><Icone size={17} aria-hidden="true" /></span>
                    <span><strong>{rota.nome}</strong><small>{CANAIS[rota.canal].tipo}</small></span>
                  </span></th>
                  <td>{numero.format(total.entradas)}</td><td>{numero.format(total.conversas)}</td><td>{numero.format(total.vendas)}</td>
                  <td><span className={r.taxa}>{conversao(total)}
                    <span className={r.trilho} aria-hidden="true">
                      <span style={{ width: `${total.entradas ? 100 * total.vendas / total.entradas : 0}%` }} />
                    </span>
                  </span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={r.nota}>Conversão é a proporção de entradas que resultaram em venda.</p>
    </section>
  );
}

export function Jornadas({ rotas, jornadas, inicial }: {
  rotas: Rota[]; jornadas: Jornada[]; inicial: string | null;
}) {
  const [selecionada, setSelecionada] = useState(inicial);
  const [filtro, setFiltro] = useState("");
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(12);
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const filtradas = jornadas.filter((j) => (!filtro || j.origem.id === filtro) && j.nome.toLocaleLowerCase("pt-BR").includes(termo));
  const atual = filtradas.find((j) => j.id === selecionada) ?? filtradas[0];
  const canal = atual ? CANAIS[atual.origem.canal].nome : "";

  return (
    <div className={r.jornadas}>
      <section className={`${s.painel} ${r.contatos}`} aria-labelledby="titulo-contatos">
        <div className={s.cabecalhoPainel}>
          <div className={s.tituloPainel}><Users size={17} aria-hidden="true" /><h2 id="titulo-contatos">Contatos fictícios</h2></div>
          <span className={r.quantidade}>{numero.format(filtradas.length)}</span>
        </div>
        <div className={`${f.form} ${r.filtros}`}>
          <label>Buscar contato<input name="busca" type="search" value={busca} autoComplete="off"
            onChange={(e) => { setBusca(e.target.value); setLimite(12); }} /></label>
          <label>Filtrar por rota<select name="rota" value={filtro} onChange={(e) => { setFiltro(e.target.value); setLimite(12); }}>
            <option value="">Todas as rotas</option>
            {rotas.map((rota) => <option key={rota.id} value={rota.id}>{rota.nome}</option>)}
          </select></label>
        </div>
        <ul className={r.listaContatos}>
          {filtradas.slice(0, limite).map((j) => (
            <li key={j.id}><button type="button" onClick={() => setSelecionada(j.id)} aria-pressed={j.id === atual?.id}>
              <span className={r.kpiIcone}><UserRound size={15} aria-hidden="true" /></span>
              <span><strong>{j.nome}</strong><small>{j.origem.nome}</small></span>
              <ChevronRight size={14} aria-hidden="true" />
            </button></li>
          ))}
        </ul>
        {filtradas.length === 0 && <p className={r.nota}>Nenhum contato corresponde à busca.</p>}
        {filtradas.length > limite && <button type="button" className={`${s.botao} ${r.mais}`} onClick={() => setLimite(limite + 12)}>Mostrar mais</button>}
      </section>
      <section className={`${s.painel} ${r.detalhe}`} aria-labelledby="titulo-jornada">
        <header className={r.topoResultados}>
          <div>
            <div className={s.tituloPainel}><IconeRota size={18} aria-hidden="true" /><h2 id="titulo-jornada">Jornada do cliente</h2></div>
            {atual && <p><Clock3 size={14} aria-hidden="true" /> {dia.format(atual.instante)} · {atual.amostra ? "Amostra" : "Simulação"}</p>}
          </div>
        </header>
        {atual ? <>
          <div className={r.origemJornada}>
            <span className={r.iconeOrigem}><Crosshair size={22} aria-hidden="true" /></span>
            <div><h3>{atual.nome}</h3><p>{atual.origem.nome}
              {canal !== atual.origem.nome && <> <ArrowUpRight size={13} aria-hidden="true" /> {canal}</>}
            </p></div>
          </div>
          <dl className={r.utmJornada}>
            {Object.entries(atual.origem.utm).map(([nome, valor]) => <div key={nome}><dt><code>utm_{nome}</code></dt><dd>{valor || "—"}</dd></div>)}
          </dl>
          <ol className={r.timeline}>
            {atual.eventos.map((evento, i) => {
              const Icone = ICONE_EVENTO[evento.tipo];
              return (
                <li key={i}>
                  <span className={r.kpiIcone} data-tom={evento.tipo}><Icone size={17} aria-hidden="true" /></span>
                  <div><strong>{evento.titulo}</strong>{evento.detalhe && <p>{evento.detalhe}</p>}</div>
                </li>
              );
            })}
          </ol>
        </> : <p className={r.nota}>Escolha outro filtro ou use Simular cliente para criar uma jornada.</p>}
      </section>
    </div>
  );
}
