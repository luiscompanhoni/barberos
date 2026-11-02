"use client";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/cliente-api";
import { rotuloEntrevista } from "@/lib/recrutamento/entrevistas-regras";
type Registro = { podeEnviarPiloto: boolean; id: string; estado: string; versao: number; inicio: string | null; local: string; duracaoMin: number; expiraEm: string; link: string | null; podeGerir: boolean };
type Lista = { podeMarcar: boolean; entrevistas: Registro[] };
export function MarcarEntrevista({ candidaturaId, versao, atualizou }: { candidaturaId: string; versao: number; atualizou: () => void }) {
  const [dados, setDados] = useState<Lista | null>(null); const [erro, setErro] = useState(""); const [mensagem, setMensagem] = useState(""); const [ocupado, setOcupado] = useState(false);
  const [agora, setAgora] = useState(0);
  const [chave, setChave] = useState<string | null>(null);
  const url = `/api/recrutamento/candidaturas/${candidaturaId}/entrevistas`;
  async function carregar() { setOcupado(true); setErro(""); try { setDados(await api<Lista>(url)); setAgora(Date.now()); } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); } }
  async function convidar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const id = chave ?? crypto.randomUUID(); setChave(id); setOcupado(true); setErro("");
    try {
      await api(url, { method: "POST", body: { chave: id, versao, duracaoMin: Number(f.get("duracaoMin")), local: f.get("local") } });
      setDados(await api<Lista>(url)); setAgora(Date.now()); setMensagem("Convite preparado. Nenhuma mensagem foi enviada. A reserva depende da escolha e confirmação do candidato."); setChave(null); atualizou();
    } catch (err) { setErro((err as Error).message); } finally { setOcupado(false); }
  }
  async function gerir(e: Registro, acao: "CANCELAR" | "RENOVAR") {
    if (!confirm(acao === "CANCELAR" ? "Cancelar este convite/entrevista? Nenhuma mensagem será enviada. A etapa da candidatura será mantida." : "Gerar outro link? O anterior deixará de funcionar. Entrevistas já confirmadas mantêm a reserva.")) return;
    setOcupado(true); setErro("");
    try { await api(`/api/recrutamento/entrevistas/${e.id}`, { method: "POST", body: { acao, versao: e.versao } }); setDados(await api<Lista>(url)); setAgora(Date.now()); setMensagem(acao === "CANCELAR" ? "Entrevista cancelada, sem envio de mensagem." : "Novo link preparado. O anterior foi invalidado."); atualizou(); }
    catch (err) { setErro((err as Error).message); } finally { setOcupado(false); }
  }
  async function testar(e: Registro) {
    setOcupado(true);setErro("");try{await api(`/api/recrutamento/entrevistas/${e.id}/piloto`,{method:"POST",body:{}});setMensagem("Convite enviado somente ao número autorizado no piloto. Aguarde a resposta pelo WhatsApp.");}catch(err){setErro((err as Error).message);}finally{setOcupado(false);}
  }
  async function copiar(link: string) { try { await navigator.clipboard.writeText(`A Black convida você para uma entrevista presencial. Escolha e confirme seu horário pelo link privado: ${link}
O cadastro e a entrevista não garantem contratação.`); setMensagem("Convite copiado. Nenhuma mensagem foi enviada pelo sistema."); } catch { setErro("Não foi possível copiar. Selecione o link no campo do convite."); } }
  const ativo = dados?.entrevistas.some(e => e.estado !== "CANCELADA" && (e.inicio ? +new Date(e.inicio) + e.duracaoMin * 60_000 > agora : +new Date(e.expiraEm) > agora));
  return <section className="space-y-3 border-t border-zinc-500/20 pt-3 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-4 [&_button]:focus-visible:outline-ouro"><button className="btn" disabled={ocupado} onClick={carregar}>Marcar entrevista</button>
    {erro && <p role="alert" className="text-red-500">{erro}</p>}{mensagem && <p role="status">{mensagem}</p>}
    {dados && <><p className="text-sm">Presencial · segundas, 14h–16h · horário de São Paulo. Convite privado; contato declarado não comprova identidade. O candidato escolhe e confirma. Envios automáticos continuam desligados.</p>
      {dados.podeMarcar && !ativo && <form className="space-y-3" onSubmit={convidar}><fieldset disabled={ocupado}><label className="block">Duração em minutos (máximo 45)<input className="campo" name="duracaoMin" type="number" min={1} max={45} step={1} required defaultValue={45} /></label><label className="block">Local da entrevista<input className="campo" name="local" minLength={5} maxLength={500} required defaultValue="Rua 15 de Abril, 50, Centro, Rio do Sul, SC" /></label><button className="btn-primario mt-3">Preparar convite sem enviar</button></fieldset></form>}
      {!dados.podeMarcar && <p className="text-sm">Somente o dono prepara, renova ou cancela convites.</p>}
      {dados.entrevistas.map(e => <article className="rounded-xl border border-zinc-500/20 p-3 space-y-2" key={`${e.id}-${e.versao}`}><p className="font-semibold">{e.estado === "CONFIRMADA" ? "Confirmada pelo candidato" : e.estado === "CANCELADA" ? "Cancelada" : e.estado === "AGUARDA_CONFIRMACAO" ? "Escolha pendente de confirmação" : "Aguardando escolha do candidato"}</p><p>{e.inicio ? rotuloEntrevista(e.inicio, e.duracaoMin) : `Até ${e.duracaoMin} minutos; ainda sem reserva.`}</p><p className="text-sm break-words">{e.local}</p><p className="text-xs">Acesso ao convite até {new Date(e.expiraEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (São Paulo).{+new Date(e.expiraEm) <= agora ? " Link expirado; gere outro link se a seleção continuar." : ""}</p>
        {e.link && <><label className="block text-sm">Link privado do candidato<input className="campo" name="convitePrivado" autoComplete="off" spellCheck={false} readOnly value={e.link} /></label><button className="btn" disabled={ocupado} onClick={() => copiar(e.link!)}>Copiar convite</button><p className="text-xs text-zinc-500">O link permite consultar e confirmar somente esta entrevista. Compartilhe apenas com o candidato correto.</p></>}
        {e.podeGerir && e.estado !== "CANCELADA" && <div className="flex gap-2 flex-wrap">{e.podeEnviarPiloto && <button className="btn" disabled={ocupado} onClick={() => testar(e)}>Enviar convite no piloto restrito</button>}<button className="btn" disabled={ocupado} onClick={() => gerir(e, "RENOVAR")}>Gerar novo link</button><button className="btn-perigo" disabled={ocupado} onClick={() => gerir(e, "CANCELAR")}>Cancelar entrevista</button></div>}
      </article>)}
    </>}
  </section>;
}
