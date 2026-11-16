"use client";

import { useEffect, useRef, useState } from "react";
import { ChartColumnIncreasing, FlaskConical, GitBranch, Play, Plus, Route as IconeRota } from "lucide-react";
import {
  contarJornadas, criarEtapa, criarRota, ordemEtapas, registrarJornada,
  type Etapa, type Origem, type Rota, type TipoEtapa,
} from "@/lib/campanhas/rotas-demo";
import { ConfirmarRemocao, Dialogo, FormNovaEtapa, FormRota, FormSimular } from "./Dialogos";
import { PainelEtapa } from "./EditorEtapa";
import { ListaRotas, MapaRotas } from "./MapaRotas";
import { Desempenho, Indicadores, Jornadas } from "./Resultados";
import { useRotasLocais } from "./usoLocal";
import s from "./tela.module.css";

const ABAS = [
  { id: "mapa", nome: "Mapa de rotas", icon: GitBranch },
  { id: "jornada", nome: "Jornada do cliente", icon: IconeRota },
  { id: "desempenho", nome: "Desempenho", icon: ChartColumnIncreasing },
] as const;

type Aba = (typeof ABAS)[number]["id"];
type Modal = "nova" | "rota" | "etapa" | "simular" | "remover";

function destacarEtapa(rota: Rota) {
  return rota.etapas.find((etapa) => etapa.tipo === "whatsapp" || etapa.tipo === "direct")?.id ?? rota.etapas[0]?.id ?? null;
}

export function RotasCaptacao({ conta }: { conta: string }) {
  const { dados, salvar, temporario } = useRotasLocais(conta);
  const [aba, setAba] = useState<Aba>("mapa");
  const [rotaId, setRotaId] = useState("instagram-ads");
  const [etapaId, setEtapaId] = useState<string | null>("instagram-ads-2");
  const [jornadaId, setJornadaId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [sujo, setSujo] = useState(false);
  const [aviso, setAviso] = useState("");
  const painel = useRef<HTMLDivElement>(null);
  const rota = dados.rotas.find((r) => r.id === rotaId) ?? dados.rotas[0];
  const etapa = rota.etapas.find((e) => e.id === etapaId);
  const fechar = () => setModal(null);

  useEffect(() => {
    if (!sujo) return;
    const proteger = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = true; };
    window.addEventListener("beforeunload", proteger);
    return () => window.removeEventListener("beforeunload", proteger);
  }, [sujo]);

  function liberarEditor() {
    if (sujo && !window.confirm("Descartar as alterações ainda não salvas da etapa?")) return false;
    setSujo(false);
    return true;
  }

  function selecionarRota(id: string) {
    if (id === rota.id) return true;
    const alvo = dados.rotas.find((r) => r.id === id);
    if (!alvo || !liberarEditor()) return false;
    setRotaId(alvo.id);
    setEtapaId(destacarEtapa(alvo));
    return true;
  }

  function selecionarEtapa(id: string, item: string) {
    if (id !== rota.id || item !== etapaId) {
      if (!liberarEditor()) return;
      setRotaId(id);
      setEtapaId(item);
    }
    if (window.matchMedia("(max-width: 740px)").matches) {
      window.requestAnimationFrame(() => painel.current?.scrollIntoView({ block: "start" }));
    }
  }

  function atualizarRota(id: string, atualizar: (rota: Rota) => Rota) {
    salvar((atual) => ({ ...atual, rotas: atual.rotas.map((item) => item.id === id ? atualizar(item) : item) }));
  }

  function salvarEtapa(item: Etapa) {
    atualizarRota(rota.id, (r) => ({ ...r, etapas: r.etapas.map((e) => e.id === item.id ? item : e) }));
    setSujo(false);
    setAviso("Etapa salva.");
  }

  function mover(id: string, de: number, para: number) {
    atualizarRota(id, (r) => ({ ...r, etapas: ordemEtapas(r.etapas, de, para) }));
    setAviso("Ordem da rota atualizada.");
  }

  function salvarRota(origem: Omit<Origem, "id">) {
    if (modal === "nova") {
      if (!liberarEditor()) return;
      const nova = criarRota({ ...origem, id: crypto.randomUUID() });
      salvar((atual) => ({ ...atual, rotas: [...atual.rotas, nova] }));
      setRotaId(nova.id);
      setEtapaId(destacarEtapa(nova));
      setAba("mapa");
      setAviso("Rota criada.");
    } else {
      atualizarRota(rota.id, (r) => ({ ...r, ...origem }));
      setAviso("Configuração da rota salva.");
    }
    fechar();
  }

  function adicionarEtapa(tipo: TipoEtapa, titulo: string, posicao: number) {
    if (!liberarEditor()) return;
    const nova = criarEtapa(tipo, crypto.randomUUID());
    if (titulo) nova.titulo = titulo;
    atualizarRota(rota.id, (r) => ({
      ...r, etapas: [...r.etapas.slice(0, posicao), nova, ...r.etapas.slice(posicao)],
    }));
    setEtapaId(nova.id);
    setAviso("Etapa adicionada.");
    fechar();
  }

  function removerEtapa() {
    if (!etapa) return;
    const restantes = rota.etapas.filter((e) => e.id !== etapa.id);
    atualizarRota(rota.id, (r) => ({ ...r, etapas: r.etapas.filter((e) => e.id !== etapa.id) }));
    setEtapaId(destacarEtapa({ ...rota, etapas: restantes }));
    setSujo(false);
    setAviso("Etapa removida.");
    fechar();
  }

  function simular(alvo: Rota, nome: string, fim: string) {
    if (!liberarEditor()) return;
    const jornada = registrarJornada(alvo, fim, { id: crypto.randomUUID(), nome, amostra: false, instante: Date.now() });
    salvar((atual) => ({ ...atual, jornadas: [jornada, ...atual.jornadas] }));
    setJornadaId(jornada.id);
    setAba("jornada");
    setAviso("Jornada simulada. O desempenho foi atualizado.");
    fechar();
  }

  return (
    <section className={s.tela} aria-labelledby="titulo-rotas-captacao">
      <header className={s.cabecalho}>
        <div>
          <div className={s.linhaTitulo}>
            <h1 id="titulo-rotas-captacao">Rotas de captação</h1>
            <span className={s.demo}><FlaskConical size={13} aria-hidden="true" /> Protótipo</span>
          </div>
          <p>Organize como o cliente chega, é atendido e fecha a compra.</p>
        </div>
        <div className={s.acoesTopo}>
          <button type="button" className={s.botao} onClick={() => setModal("nova")}><Plus size={17} aria-hidden="true" /> Nova rota</button>
          <button type="button" className={`${s.botao} ${s.primario}`} onClick={() => setModal("simular")}>
            <Play size={15} fill="currentColor" aria-hidden="true" /> Simular cliente
          </button>
        </div>
      </header>
      <div className={s.navegacao}>
        <nav aria-label="Visualizações da captação" className={s.abas}>
          {ABAS.map(({ id, nome, icon: Icone }) => (
            <button className={s.aba} key={id} type="button" aria-pressed={aba === id}
              onClick={() => { if (aba !== id && liberarEditor()) setAba(id); }}>
              <Icone size={16} aria-hidden="true" /> {nome}
            </button>
          ))}
        </nav>
        <p className={s.marcaDemo}><span /> Dados simulados</p>
      </div>
      {aba === "mapa" && (
        <div className={s.bancada}>
          <ListaRotas rotas={dados.rotas} rota={rota} onRota={selecionarRota} onEditar={() => setModal("rota")} />
          <MapaRotas rotas={dados.rotas} rota={rota} etapaId={etapaId} onNovaRota={() => setModal("nova")} onRota={selecionarRota} onEtapa={selecionarEtapa}
            onAdicionar={(id) => { if (selecionarRota(id)) setModal("etapa"); }} onMover={mover} />
          <div className={s.painelEtapa} ref={painel}>
            <PainelEtapa rota={rota} etapa={etapa} onDirty={setSujo} onSalvar={salvarEtapa}
              onMover={(de, para) => mover(rota.id, de, para)} onExcluir={() => setModal("remover")} />
          </div>
        </div>
      )}
      {aba === "jornada" && <Jornadas key={jornadaId ?? "jornadas"} rotas={dados.rotas} jornadas={dados.jornadas} inicial={jornadaId} />}
      <Indicadores total={contarJornadas(dados.jornadas)} />
      {aba === "desempenho" && <Desempenho rotas={dados.rotas} jornadas={dados.jornadas} />}
      <p className={s.status} role="status">
        {aviso} {temporario ? "O navegador não conseguiu gravar. As alterações estão abertas nesta sessão." : ""}
      </p>

      {modal === "nova" && <Dialogo titulo="Nova rota de captação" onFechar={fechar}><FormRota onSalvar={salvarRota} /></Dialogo>}
      {modal === "rota" && <Dialogo titulo="Configurar rota" onFechar={fechar}><FormRota rota={rota} onSalvar={salvarRota} /></Dialogo>}
      {modal === "etapa" && <Dialogo titulo="Adicionar etapa" onFechar={fechar}><FormNovaEtapa rota={rota} onAdicionar={adicionarEtapa} /></Dialogo>}
      {modal === "simular" && <Dialogo titulo="Simular cliente" onFechar={fechar}><FormSimular rotas={dados.rotas} rota={rota} onSimular={simular} /></Dialogo>}
      {modal === "remover" && etapa && <Dialogo titulo="Remover etapa" onFechar={fechar}>
        <ConfirmarRemocao etapa={etapa} onRemover={removerEtapa} onFechar={fechar} />
      </Dialogo>}
    </section>
  );
}
