import { useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ChevronRight, Crosshair, GitBranch, GripVertical, Plus, Settings2 } from "lucide-react";
import { CANAIS, type Etapa, type Rota } from "@/lib/campanhas/rotas-demo";
import { ICONE_CANAL, ICONE_ETAPA } from "./icones";
import m from "./mapa.module.css";
import s from "./tela.module.css";

type Props = {
  rotas: Rota[];
  rota: Rota;
  etapaId: string | null;
  onNovaRota: () => void;
  onRota: (id: string) => void;
  onEtapa: (rotaId: string, etapaId: string) => void;
  onAdicionar: (id: string) => void;
  onMover: (rotaId: string, de: number, para: number) => void;
};

function legenda(etapa: Etapa) {
  if (etapa.tipo === "whatsapp") return etapa.modo === "padrao" ? "Bot padrão" : "Mensagem própria";
  return etapa.responsavel || "Sem responsável";
}

export function MapaRotas({ rotas, rota, etapaId, onNovaRota, onRota, onEtapa, onAdicionar, onMover }: Props) {
  const arrasto = useRef<{ rotaId: string; indice: number } | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const altura = rotas.length * 130;
  const centro = altura / 2;
  const colunas = Math.max(3, ...rotas.map((r) => r.etapas.length));

  return (
    <section className={`${s.painel} ${m.mapa}`} aria-labelledby="titulo-mapa-rotas">
      <div className={s.cabecalhoPainel}>
        <div className={s.tituloPainel}><GitBranch size={17} aria-hidden="true" /><h2 id="titulo-mapa-rotas">Mapa de captação</h2></div>
        <span className={m.contador}>{rotas.length} {rotas.length === 1 ? "rota" : "rotas"}</span>
      </div>
      <div className={m.viewport} tabIndex={0} aria-label="Diagrama de captação com rolagem" role="region">
        <div className={m.diagrama} style={{ "--colunas": colunas } as CSSProperties}>
          <button className={m.raiz} type="button" onClick={onNovaRota} aria-label="Criar rota de captação" title="Criar rota">
            <span className={m.iconeRaiz}><Crosshair size={20} aria-hidden="true" /></span>
            <strong>Captação</strong>
          </button>
          <svg className={m.ramos} viewBox={`0 0 33 ${altura}`} preserveAspectRatio="none" aria-hidden="true">
            {rotas.map((r, i) => (
              <path key={r.id} d={`M0 ${centro} C22 ${centro}, 10 ${i * 130 + 69}, 33 ${i * 130 + 69}`}
                data-ativa={r.id === rota.id} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          <div className={m.linhas}>
            {rotas.map((r) => {
              const ativa = r.id === rota.id;
              return (
                <section key={r.id} className={m.linha} data-ativa={ativa} aria-label={r.nome}>
                  <button type="button" className={m.rotuloRamo} onClick={() => onRota(r.id)} aria-pressed={ativa}>
                    <span className={m.indicadorRamo} />
                    <span className={m.nomeRamo}>{r.nome}</span>
                    {r.canal === "chatgpt" && <span className={m.piloto}>Piloto</span>}
                  </button>
                  <div className={m.sequencia}>
                    {r.etapas.map((etapa, i) => {
                      const Icone = ICONE_ETAPA[etapa.tipo];
                      return (
                        <div key={etapa.id} className={m.posicao}>
                          {i > 0 && <span className={m.aresta} aria-hidden="true"><ArrowRight size={13} /></span>}
                          <button
                            type="button"
                            className={m.etapa}
                            aria-pressed={ativa && etapaId === etapa.id}
                            aria-label={`${etapa.titulo} em ${r.nome}`}
                            data-tom={etapa.tipo}
                            data-alvo={alvo === etapa.id}
                            onClick={() => onEtapa(r.id, etapa.id)}
                            draggable
                            onDragStart={(e) => {
                              arrasto.current = { rotaId: r.id, indice: i };
                              e.dataTransfer.setData("text/plain", etapa.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragOver={(e) => {
                              if (arrasto.current?.rotaId !== r.id) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              setAlvo(etapa.id);
                            }}
                            onDragLeave={() => setAlvo(null)}
                            onDragEnd={() => { arrasto.current = null; setAlvo(null); }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const inicio = arrasto.current;
                              arrasto.current = null;
                              setAlvo(null);
                              if (inicio?.rotaId === r.id) onMover(r.id, inicio.indice, i);
                            }}
                          >
                            <span className={m.iconeEtapa}><Icone size={17} aria-hidden="true" /></span>
                            <strong title={etapa.titulo}>{etapa.titulo}</strong>
                            <small title={legenda(etapa)}>{legenda(etapa)}</small>
                          </button>
                        </div>
                      );
                    })}
                    <button className={m.adicionar} type="button" aria-label={`Adicionar etapa a ${r.nome}`}
                      title="Adicionar etapa" onClick={() => onAdicionar(r.id)}><Plus size={15} aria-hidden="true" /></button>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
      <div className={m.rodape}>
        <span><span className={m.legendaLinha} /> Rota selecionada</span>
        <span className={m.dicaMouse}><GripVertical size={14} aria-hidden="true" /> Arraste para reordenar</span>
        <span className={m.dicaToque}><ArrowRight size={14} aria-hidden="true" /> Deslize para ver as etapas</span>
      </div>
    </section>
  );
}

export function ListaRotas({ rotas, rota, onRota, onEditar }: Pick<Props, "rotas" | "rota" | "onRota"> & { onEditar: () => void }) {
  const Icone = ICONE_CANAL[rota.canal];
  return (
    <aside className={m.lateral} aria-label="Rotas de captação">
      <section className={`${s.painel} ${m.lista}`} aria-labelledby="titulo-lista-rotas">
        <div className={s.cabecalhoPainel}><h2 id="titulo-lista-rotas">Rotas</h2></div>
        <ul className={m.rotas}>
          {rotas.map((r) => {
            const Canal = ICONE_CANAL[r.canal];
            return (
              <li key={r.id}>
                <button type="button" className={m.rota} data-canal={r.canal} onClick={() => onRota(r.id)}
                  aria-pressed={r.id === rota.id}>
                  <span className={m.iconeCanal}><Canal size={17} aria-hidden="true" /></span>
                  <span className={m.rotaTexto}><strong title={r.nome}>{r.nome}</strong><small>{CANAIS[r.canal].tipo}</small></span>
                  <ChevronRight className={m.setaRota} size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className={`${s.painel} ${m.origem}`} aria-labelledby="titulo-origem-rota">
        <div className={m.origemTopo}>
          <Icone size={15} aria-hidden="true" /><h2 id="titulo-origem-rota">Origem e UTMs</h2>
        </div>
        <dl className={m.utm}>
          <div><dt>Origem</dt><dd><code title={rota.utm.source}>{rota.utm.source || "—"}</code></dd></div>
          <div><dt>Mídia</dt><dd><code title={rota.utm.medium}>{rota.utm.medium || "—"}</code></dd></div>
          <div><dt>Campanha</dt><dd><code title={rota.utm.campaign}>{rota.utm.campaign || "—"}</code></dd></div>
        </dl>
        <button className={`${s.botao} ${m.configurar}`} type="button" onClick={onEditar}>
          <Settings2 size={15} aria-hidden="true" /> Configurar rota
        </button>
      </section>
    </aside>
  );
}
