import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, Plus, Play, X } from "lucide-react";
import { CANAIS, ETAPAS, etapasDaJornada, montarLink, type Canal, type Etapa, type Origem, type Rota, type TipoEtapa } from "@/lib/campanhas/rotas-demo";
import f from "./form.module.css";
import s from "./tela.module.css";

export function Dialogo({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialogo = ref.current;
    dialogo?.showModal();
    return () => { dialogo?.close(); };
  }, []);

  return (
    <dialog ref={ref} className={f.dialogo} aria-labelledby={id} onCancel={(e) => { e.preventDefault(); onFechar(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className={f.conteudoDialogo}>
        <header className={f.topoDialogo}>
          <h2 id={id}>{titulo}</h2>
          <button type="button" className={s.iconeBotao} aria-label="Fechar" onClick={onFechar}><X size={19} aria-hidden="true" /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function FormRota({ rota, onSalvar }: { rota?: Rota; onSalvar: (origem: Omit<Origem, "id">) => void }) {
  const [canal, setCanal] = useState<Canal>(rota?.canal ?? "instagramAds");
  const [utm, setUtm] = useState(rota?.utm ?? { source: CANAIS[canal].fonte, medium: CANAIS[canal].midia, campaign: "" });
  const [destino, setDestino] = useState(rota?.destino ?? "");
  const [erro, setErro] = useState("");

  function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const nome = String(form.get("nome")).trim();
    if (!nome) return;
    const origem = {
      nome, canal, destino: destino.trim(),
      utm: { source: utm.source.trim(), medium: utm.medium.trim(), campaign: utm.campaign.trim() },
    };
    if (origem.destino && !montarLink({ ...origem, id: rota?.id ?? "" })) {
      setErro("Use um endereço começando com https:// ou http://.");
      e.currentTarget.querySelector<HTMLInputElement>('[name="destino"]')?.focus();
      return;
    }
    onSalvar(origem);
  }

  return (
    <form className={f.form} onSubmit={salvar}>
      <label>Nome da rota<input name="nome" defaultValue={rota?.nome} required pattern=".*\S.*" maxLength={65} autoComplete="off" /></label>
      <label>Canal de origem
        <select name="canal" value={canal} onChange={(e) => {
          const proximo = e.target.value as Canal;
          const { fonte, midia } = CANAIS[proximo];
          setUtm((atual) => ({ ...atual, source: fonte, medium: midia }));
          setCanal(proximo);
        }}>
          {Object.entries(CANAIS).map(([id, tema]) => <option value={id} key={id}>{tema.nome}{id === "chatgpt" ? " (piloto)" : ""}</option>)}
        </select>
      </label>
      {!rota && <p className={f.ajuda}>A rota começa com etapas sugeridas para o canal. Você pode editá-las no mapa.</p>}
      <div className={f.utmCampos}>
        {(["source", "medium", "campaign"] as const).map((campo) => (
          <label key={campo}><code translate="no">utm_{campo}</code>
            <input name={campo} value={utm[campo]} spellCheck={false} autoComplete="off" maxLength={90}
              onChange={(e) => setUtm({ ...utm, [campo]: e.target.value })} />
          </label>
        ))}
      </div>
      <label>Link de destino
        <input name="destino" type="url" value={destino} maxLength={400} autoComplete="off" placeholder="https://exemplo.test/agendar…"
          onChange={(e) => { setDestino(e.target.value); setErro(""); }} aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? "erro-destino-rota" : undefined} />
      </label>
      {erro && <p id="erro-destino-rota" className={f.erro} role="alert">{erro}</p>}
      <div className={f.acoesDialogo}>
        <button className={`${s.botao} ${s.primario}`} type="submit">
          {rota ? <Check size={16} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
          {rota ? "Salvar rota" : "Criar rota"}
        </button>
      </div>
    </form>
  );
}

export function FormNovaEtapa({ rota, onAdicionar }: { rota: Rota; onAdicionar: (tipo: TipoEtapa, titulo: string, posicao: number) => void }) {
  const [tipo, setTipo] = useState<TipoEtapa>("tarefa");
  return (
    <form className={f.form} onSubmit={(e) => {
      e.preventDefault();
      const dados = new FormData(e.currentTarget);
      onAdicionar(tipo, String(dados.get("titulo")).trim(), Number(dados.get("posicao")));
    }}>
      <p className={f.ajuda}>{rota.nome}</p>
      <label>Tipo de etapa<select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoEtapa)}>
        {Object.entries(ETAPAS).map(([id, definicao]) => <option key={id} value={id}>{definicao.nome}</option>)}
      </select></label>
      <label>Nome da etapa <input name="titulo" placeholder={`${ETAPAS[tipo].nome}…`} maxLength={55} autoComplete="off" /></label>
      <label>Posição no fluxo<select name="posicao" defaultValue={rota.etapas.length}>
        <option value={0}>No início</option>
        {rota.etapas.map((etapa, i) => <option key={etapa.id} value={i + 1}>Após {etapa.titulo}</option>)}
      </select></label>
      <div className={f.acoesDialogo}><button className={`${s.botao} ${s.primario}`} type="submit">
        <Plus size={17} aria-hidden="true" /> Adicionar etapa
      </button></div>
    </form>
  );
}

function descricaoFim(etapa: Etapa) {
  if (etapa.tipo === "venda") return `Venda concluída em ${etapa.titulo}`;
  if (etapa.tipo === "link") return `Clique no link de ${etapa.titulo}`;
  return `Conversa iniciada em ${etapa.titulo}`;
}

export function FormSimular({ rotas, rota, onSimular }: { rotas: Rota[]; rota: Rota; onSimular: (rota: Rota, nome: string, fim: string) => void }) {
  const [id, setId] = useState(rota.id);
  const rotuloRota = useId();
  const selecionada = rotas.find((r) => r.id === id) ?? rota;
  const etapas = etapasDaJornada(selecionada);
  return (
    <form className={f.form} onSubmit={(e) => {
      e.preventDefault();
      const dados = new FormData(e.currentTarget);
      const nome = String(dados.get("cliente")).trim();
      if (nome) onSimular(selecionada, nome, String(dados.get("fim")));
    }}>
      <p className={f.ajuda}>Crie um contato fictício e veja por onde ele passou. A simulação atualiza o relatório local.</p>
      <label>Cliente fictício<input name="cliente" defaultValue="Cliente teste" required pattern=".*\S.*" maxLength={65} autoComplete="off" /></label>
      <label><span id={rotuloRota}>Rota</span><select name="rota" aria-labelledby={rotuloRota} value={id} onChange={(e) => setId(e.target.value)}>
        {rotas.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
      </select></label>
      <label>Simular até<select name="fim" key={selecionada.id} defaultValue={etapas.at(-1)?.id ?? ""}>
        <option value="">Só a entrada na rota</option>
        {etapas.map((etapa) => <option key={etapa.id} value={etapa.id}>{descricaoFim(etapa)}</option>)}
      </select></label>
      <div className={f.acoesDialogo}><button className={`${s.botao} ${s.primario}`} type="submit">
        <Play size={15} aria-hidden="true" /> Rodar simulação
      </button></div>
    </form>
  );
}

export function ConfirmarRemocao({ etapa, onRemover, onFechar }: { etapa: Etapa; onRemover: () => void; onFechar: () => void }) {
  return (
    <div className={f.form}>
      <p className={f.ajuda}>Remover a etapa “{etapa.titulo}” da rota?</p>
      <div className={f.acoesDialogo}>
        <button className={s.botao} type="button" onClick={onFechar}>Cancelar</button>
        <button className={`${s.botao} ${f.perigo}`} type="button" onClick={onRemover}>Remover etapa</button>
      </div>
    </div>
  );
}
