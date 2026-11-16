import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Check, FileImage, Paperclip, Settings2, Trash2 } from "lucide-react";
import { MENSAGEM_BOT_DEMO, montarLink, preencherMensagem, type Etapa, type Rota } from "@/lib/campanhas/rotas-demo";
import { ICONE_ETAPA } from "./icones";
import f from "./form.module.css";
import s from "./tela.module.css";

type Props = {
  rota: Rota;
  etapa: Etapa | undefined;
  onDirty: (sujo: boolean) => void;
  onSalvar: (etapa: Etapa) => void;
  onMover: (de: number, para: number) => void;
  onExcluir: () => void;
};

export function PainelEtapa(props: Props) {
  const { etapa, rota } = props;
  return (
    <section className={`${s.painel} ${f.editor}`} aria-labelledby="titulo-editor-etapa">
      <div className={s.cabecalhoPainel}>
        <div className={s.tituloPainel}>
          <Settings2 size={17} aria-hidden="true" /><h2 id="titulo-editor-etapa">Configuração da etapa</h2>
        </div>
      </div>
      {etapa ? <EditorEtapa key={etapa.id} {...props} etapa={etapa} />
        : <p className={f.vazio}>Escolha uma etapa do mapa ou adicione uma à rota {rota.nome}.</p>}
    </section>
  );
}

function EditorEtapa({ etapa, rota, onDirty, onSalvar, onMover, onExcluir }: Omit<Props, "etapa"> & { etapa: Etapa }) {
  const [modo, setModo] = useState(etapa.modo);
  const [instrucao, setInstrucao] = useState(etapa.instrucao);
  const [imagem, setImagem] = useState(etapa.imagem);
  const [lendo, setLendo] = useState(false);
  const [erroArquivo, setErroArquivo] = useState("");
  const Icone = ICONE_ETAPA[etapa.tipo];
  const indice = rota.etapas.findIndex((item) => item.id === etapa.id);
  const bot = etapa.tipo === "whatsapp";
  const comMensagem = bot || etapa.tipo === "direct";
  const criativo = rota.etapas.slice(0, indice).findLast((item) => item.tipo === "criativo" && item.imagem)?.imagem;

  function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const titulo = String(dados.get("titulo")).trim();
    if (!titulo) return;
    onSalvar({ ...etapa, titulo, responsavel: String(dados.get("responsavel")).trim(), instrucao, modo, imagem });
  }

  async function anexar(arquivo?: File) {
    if (!arquivo) return;
    setErroArquivo("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(arquivo.type) || arquivo.size > 1_000_000) {
      setErroArquivo("Escolha um PNG, JPG ou WebP de até 1 MB.");
      return;
    }
    setLendo(true);
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(String(leitor.result));
        leitor.onerror = () => reject(leitor.error);
        leitor.readAsDataURL(arquivo);
      });
      setImagem({ nome: arquivo.name, url });
      onDirty(true);
    } catch {
      setErroArquivo("Não foi possível ler a imagem. Selecione o arquivo novamente.");
    } finally {
      setLendo(false);
    }
  }

  return (
    <>
      <div className={f.introEtapa}>
        <span className={f.iconeEditor} data-tom={etapa.tipo}><Icone size={21} aria-hidden="true" /></span>
        <div><h3>{etapa.titulo}</h3><p>{rota.nome}</p></div>
      </div>
      <form className={`${f.form} ${f.formEditor}`} onSubmit={salvar} onChange={() => onDirty(true)}>
        <label>Nome da etapa<input name="titulo" defaultValue={etapa.titulo} required pattern=".*\S.*" maxLength={55} autoComplete="off" /></label>
        <label>Responsável<input name="responsavel" defaultValue={etapa.responsavel} maxLength={65} autoComplete="off" /></label>
        {bot && (
          <label>Modo de atendimento
            <select name="modo" value={modo} onChange={(e) => setModo(e.target.value === "padrao" ? "padrao" : "personalizada")}>
              <option value="padrao">Usar padrão do bot</option>
              <option value="personalizada">Mensagem personalizada</option>
            </select>
          </label>
        )}
        {(!bot || modo === "personalizada") && (
          <label>{comMensagem ? "Mensagem de entrada" : "Instruções"}
            <textarea name="instrucao" value={instrucao} onChange={(e) => setInstrucao(e.target.value)} maxLength={750} rows={3} />
          </label>
        )}
        {comMensagem && (
          <div className={f.previa}>
            <span>{bot && modo === "padrao" ? "Exemplo do padrão do bot" : "Prévia da mensagem"}</span>
            <p>{preencherMensagem(bot && modo === "padrao" ? MENSAGEM_BOT_DEMO : instrucao, "Cliente teste", rota) || "Escreva uma mensagem para ver a prévia."}</p>
            {modo === "personalizada" && <div className={f.variaveis}>
              {["nome", "barbearia", "rota", "link"].map((v) => <code key={v} translate="no">{`{{${v}}}`}</code>)}
            </div>}
          </div>
        )}
        {etapa.tipo === "criativo" && (
          <div className={f.anexo}>
            <label><span><Paperclip size={14} aria-hidden="true" /> Anexar imagem para o gestor</span>
              <input type="file" name="criativo" accept="image/png,image/jpeg,image/webp"
                onChange={(e) => { void anexar(e.target.files?.[0]); e.currentTarget.value = ""; }} />
            </label>
            {lendo && <p role="status">Carregando imagem…</p>}
            {erroArquivo && <p className={f.erro} role="alert">{erroArquivo}</p>}
            {imagem && <>
              <ImagemCriativo imagem={imagem} />
              <button className={s.botao} type="button" onClick={() => { setImagem(null); onDirty(true); }}>Retirar imagem</button>
            </>}
          </div>
        )}
        {etapa.tipo === "trafego" && <div className={f.previa}>
          <span><FileImage size={14} aria-hidden="true" /> Criativo da etapa anterior</span>
          {criativo ? <ImagemCriativo imagem={criativo} /> : <p>Anexe e salve a arte na etapa de criativo.</p>}
        </div>}
        {etapa.tipo === "link" && <div className={f.previa}>
          <span>Destino com UTMs</span><p>{montarLink(rota) || "Adicione o link em Configurar rota."}</p>
        </div>}
        <button className={`${s.botao} ${s.botaoSalvar}`} type="submit" disabled={lendo}>
          <Check size={16} aria-hidden="true" /> Salvar etapa
        </button>
      </form>
      <div className={f.acoesEditor}>
        <span>Posição no fluxo</span>
        <div>
          <button className={s.iconeBotao} type="button" title="Mover para antes" aria-label="Mover etapa para antes"
            disabled={indice < 1} onClick={() => onMover(indice, indice - 1)}><ArrowUp size={15} aria-hidden="true" /></button>
          <button className={s.iconeBotao} type="button" title="Mover para depois" aria-label="Mover etapa para depois"
            disabled={indice >= rota.etapas.length - 1} onClick={() => onMover(indice, indice + 1)}><ArrowDown size={15} aria-hidden="true" /></button>
          <button className={`${s.iconeBotao} ${f.excluir}`} type="button" title="Remover etapa" aria-label="Remover etapa"
            onClick={onExcluir}><Trash2 size={15} aria-hidden="true" /></button>
        </div>
      </div>
    </>
  );
}

function ImagemCriativo({ imagem }: { imagem: NonNullable<Etapa["imagem"]> }) {
  return (
    <figure className={f.imagemCriativo}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Imagem de demonstração anexada pelo navegador como Data URL. */}
      <img src={imagem.url} alt="Prévia do criativo anexado" width={220} height={100} />
      <figcaption>{imagem.nome}</figcaption>
    </figure>
  );
}
