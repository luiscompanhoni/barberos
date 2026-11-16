"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/cliente-api";
import { montarMensagem } from "@/lib/campanhas/regras";
import type { MODELOS_SEGMENTOS } from "@/lib/campanhas/modelos-segmento";

type Modelo = (typeof MODELOS_SEGMENTOS)[number];
export type SegmentoCampanha = { chave: string; rotulo: string; total: number; podemReceber: number };
export type Campanha = {
  id: string; nome: string; segmentos: string[]; mensagem: string; limiteDiario: number; taxaRespostaBps: number;
  status: "ATIVA" | "PAUSADA" | "ENCERRADA"; jogo: { id: string; nome: string } | null; criadoEm: string; criadoPor: string | null;
  fila: number; enviados: number; falhas: number; pulados: number; enviadosHoje: number; marcaram: number; pararam: number; elegiveis: number;
  loteAutorizado: number | null;
};
export type JogosCampanha = { id: string; nome: string }[];

export function CampanhaDetalhe(p: {
  campanha?: Campanha; modelo?: Modelo; segmentos: SegmentoCampanha[]; jogos: JogosCampanha;
  enviosBloqueados: boolean; onAlterar: () => Promise<unknown>; onFechar: () => void;
}) {
  const inicial = p.campanha ?? p.modelo!;
  const [form, setForm] = useState(() => ({
    nome: inicial.nome, mensagem: inicial.mensagem, limite: String(inicial.limiteDiario),
    taxa: String(inicial.taxaRespostaBps / 100), jogoId: p.campanha?.jogo?.id ?? "",
  }));
  const [quantidade, setQuantidade] = useState("1");
  const [confirmarLote, setConfirmarLote] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const trava = useRef(false);
  const id = inicial.id;
  const segmentos = p.modelo ? [p.modelo.chave] : p.campanha!.segmentos;
  const publico = p.segmentos.filter(s => segmentos.includes(s.chave));
  const elegiveis = p.campanha?.elegiveis ?? publico[0]?.podemReceber ?? 0;
  const fila = p.campanha?.fila ?? 0;
  const encerrada = p.campanha?.status === "ENCERRADA";
  const ativa = p.campanha?.status === "ATIVA";
  const jogos = p.campanha?.jogo && !p.jogos.some(j => j.id === p.campanha?.jogo?.id) ? [p.campanha.jogo, ...p.jogos] : p.jogos;
  const novo = !p.campanha;
  const loteAutorizado = p.campanha?.loteAutorizado;
  const podeEditar = !encerrada && fila === 0 && !loteAutorizado;
  const podeAtivar = !p.enviosBloqueados && !novo && !encerrada;
  const alterado = form.nome !== inicial.nome || form.mensagem !== inicial.mensagem ||
    Number(form.limite) !== inicial.limiteDiario || Number(form.taxa.replace(",", ".")) * 100 !== inicial.taxaRespostaBps ||
    form.jogoId !== (p.campanha?.jogo?.id ?? "");
  const qtd = loteAutorizado ?? Number(quantidade);
  const loteValido = !!loteAutorizado || (Number.isInteger(qtd) && qtd >= 1 && qtd <= Math.min(elegiveis, 500));
  const mostrarLote = !!loteAutorizado || (ativa && !p.enviosBloqueados);

  async function executar(acao: "editar" | "retomar" | "pausar" | "encerrar" | "lote") {
    if (trava.current) return;
    trava.current = true;
    setOcupado(true); setErro(""); setAviso("");
    try {
      if (novo && acao === "editar") await api("/api/campanhas", { method: "POST", body: { acao: "preparar_segmentos" } });
      const body = acao === "editar" ? { acao, campanha: {
        nome: form.nome, segmentos, mensagem: form.mensagem, limiteDiario: Number(form.limite),
        taxaRespostaBps: Math.round(Number(form.taxa.replace(",", ".")) * 100), jogoId: form.jogoId || null,
      } } : acao === "lote" ? { acao, quantidade: qtd } : { acao };
      const r = await api<{ quantidade?: number }>(`/api/campanhas/${id}`, { method: "PATCH", body });
      setConfirmarLote(false);
      setAviso(acao === "editar" ? "Alterações salvas." : acao === "lote"
        ? `${r.quantidade ?? 0} contato(s) na fila.` : acao === "retomar" ? (fila ? "Campanha retomada. Os lotes já liberados voltam a ser processados." : "Campanha ativa. Libere um lote quando quiser.")
        : acao === "encerrar" ? "Campanha encerrada." : "Campanha pausada.");
      await p.onAlterar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  }

  return <Modal titulo={p.modelo?.rotulo ?? inicial.nome} onFechar={p.onFechar}>
    <div className="space-y-4 text-sm">
      {p.modelo && <p>{p.modelo.objetivo}</p>}
      <dl className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-200 p-3">
        <div><dt className="text-xs text-zinc-500">Público</dt><dd>{publico.map(s => s.rotulo).join(" + ")}</dd></div>
        <div><dt className="text-xs text-zinc-500">Situação</dt><dd>{novaSituacao(novo, ativa, encerrada)}</dd></div>
        <div><dt className="text-xs text-zinc-500">{p.modelo ? "Na base" : "Na fila"}</dt><dd>{p.modelo ? publico[0]?.total ?? 0 : fila}</dd></div>
        <div><dt className="text-xs text-zinc-500">Podem entrar no próximo lote</dt><dd>{elegiveis.toLocaleString("pt-BR")}</dd></div>
      </dl>
      {p.campanha && <p className="text-xs text-zinc-500">
        {fila} na fila · {p.campanha.enviados} enviados · {p.campanha.marcaram} agendaram · {p.campanha.falhas} falhas
      </p>}
      <p className="text-xs text-zinc-500">O lote respeita consentimento, agendamentos, atendimento com a equipe e migração em andamento. O sistema também dá um intervalo de 48 horas entre campanhas para o mesmo cliente.</p>
      {loteAutorizado ? <p role="status" className="cartao-destaque p-3">Primeiro lote autorizado para os {loteAutorizado} contatos conferidos. A fila só será criada quando você confirmar.</p>
        : p.enviosBloqueados && <p role="status" className="cartao-destaque p-3">Envios de campanhas bloqueados nesta instalação. Você pode preparar e editar os rascunhos.</p>}
      {fila > 0 && !encerrada && <p className="text-xs text-zinc-500">Há mensagens na fila. A edição fica disponível após o processamento do lote.</p>}
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void executar("editar"); }}>
        <fieldset disabled={!podeEditar || ocupado} className="space-y-3">
          <label className="rotulo">Nome<input className="campo" required minLength={2} maxLength={80} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
          <label className="rotulo">Mensagem<textarea className="campo min-h-28" required minLength={10} maxLength={900} value={form.mensagem} onChange={e => setForm({ ...form, mensagem: e.target.value })} /></label>
          <p className="text-xs text-zinc-500">Campos disponíveis: {"{nome}"}, {"{barbearia}"} e {"{link}"}.</p>
          <label className="rotulo">Destino do link<select className="campo" value={form.jogoId}
            disabled={!!p.campanha && p.campanha.enviados + p.campanha.falhas + p.campanha.pulados > 0}
            onChange={e => setForm({ ...form, jogoId: e.target.value })}>
            <option value="">Agenda, sem presente</option>
            {jogos.map(j => <option key={j.id} value={j.id}>Jogada na {j.nome}</option>)}
          </select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="rotulo">Limite por dia<input className="campo" type="number" required min={1} max={500} value={form.limite} onChange={e => setForm({ ...form, limite: e.target.value })} /></label>
            <label className="rotulo">Estimativa de agendamento (%)<input className="campo" type="number" required min={1} max={100} step={0.01} value={form.taxa} onChange={e => setForm({ ...form, taxa: e.target.value })} /></label>
          </div>
        </fieldset>
        <section aria-label="Prévia da mensagem" className="space-y-1 rounded-xl border border-zinc-200 p-3">
          <h3 className="font-semibold">Prévia da mensagem</h3>
          <p className="whitespace-pre-wrap break-words">{montarMensagem(form.mensagem, { nome: "Cliente", barbearia: "Black Barber", link: "[link individual]" })}</p>
        </section>
        {podeEditar && <button className="btn" disabled={ocupado || (!alterado && !novo)}>{novo ? "Salvar rascunho" : "Salvar alterações"}</button>}
      </form>
      {!encerrada && <div className="space-y-3 border-t border-zinc-200 pt-3">
        <div className="flex flex-wrap gap-2">
          {ativa ? <button type="button" className="btn" disabled={ocupado} onClick={() => executar("pausar")}>Pausar campanha</button>
            : !loteAutorizado && <button type="button" className="btn-primario" disabled={!podeAtivar || alterado || ocupado}
              onClick={() => { if (!fila || confirm(`Retomar o envio de ${fila} contato(s) que já estão na fila?`)) void executar("retomar"); }}>
              {fila ? "Retomar fila" : "Ativar campanha"}
            </button>}
          {!novo && <button type="button" className="btn" disabled={ocupado}
            onClick={() => { if (confirm("Encerrar a campanha? Os contatos ainda na fila serão retirados.")) void executar("encerrar"); }}>Encerrar campanha</button>}
        </div>
        {mostrarLote && <div className="space-y-2">
          {!loteAutorizado && <label className="rotulo">Tamanho do próximo lote<input className="campo" type="number" min={1} max={Math.min(elegiveis, 500)}
            value={quantidade} onChange={e => { setQuantidade(e.target.value); setConfirmarLote(false); }} /></label>}
          {confirmarLote ? <div className="space-y-2">
            <p>{loteAutorizado ? `Colocar os ${qtd} contatos conferidos na fila desta campanha?` : `Colocar até ${qtd} contato(s) na fila de envio desta campanha?`}</p>
            <button type="button" className="btn-primario mr-2" disabled={ocupado || alterado || !loteValido} onClick={() => executar("lote")}>Confirmar envio do lote</button>
            <button type="button" className="btn" onClick={() => setConfirmarLote(false)}>Voltar</button>
          </div> : <button type="button" className="btn-primario" disabled={ocupado || alterado || !loteValido} onClick={() => setConfirmarLote(true)}>Preparar envio do lote</button>}
          <p className="text-xs text-zinc-500">O envio ocorre em horário comercial, respeitando o limite diário.</p>
        </div>}
      </div>}
      {aviso && <p role="status">{aviso}</p>}
      {erro && <p role="alert" className="text-red-700">{erro}</p>}
    </div>
  </Modal>;
}

function novaSituacao(novo: boolean, ativa: boolean, encerrada: boolean) {
  if (novo) return "Rascunho a preparar";
  if (ativa) return "Ativa";
  return encerrada ? "Encerrada" : "Pausada";
}
