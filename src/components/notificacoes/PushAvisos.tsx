"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/cliente-api";
import type { PainelNotificacoes } from "@/lib/notificacoes/tipos";
import { ativarPush, desativarPushLocal, suportaPush } from "@/lib/pwa/push-cliente";
import { assinarInstalacao, estadoInstalacao, estadoInstalacaoServidor } from "@/lib/pwa/instalacao";

const permissao = () => suportaPush() ? Notification.permission : "indisponivel";
const permissaoServidor = () => "carregando";
function ouvirPermissao(callback: () => void) {
  window.addEventListener("focus", callback);
  window.addEventListener("black:push", callback);
  return () => { window.removeEventListener("focus", callback); window.removeEventListener("black:push", callback); };
}

export function PushAvisos(p: { dados: PainelNotificacoes; onAlterado: () => Promise<void> }) {
  const app = useSyncExternalStore(assinarInstalacao, estadoInstalacao, estadoInstalacaoServidor);
  const acesso = useSyncExternalStore(ouvirPermissao, permissao, permissaoServidor);
  const [inscritoLocalmente, setInscritoLocalmente] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const atual = p.dados.dispositivos.find(d => d.atual && d.ativo);
  const ativo = !!atual && inscritoLocalmente && acesso === "granted";

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let vivo = true;
    navigator.serviceWorker.getRegistration("/").then(async reg => !!(await reg?.pushManager?.getSubscription()))
      .then(inscrito => vivo && setInscritoLocalmente(inscrito)).catch(() => vivo && setInscritoLocalmente(false));
    return () => { vivo = false; };
  }, [p.dados.dispositivos]);

  async function executar(acao: "ativar" | "desativar" | "teste", id?: string) {
    setOcupado(true); setMensagem("");
    try {
      if (acao === "ativar") {
        if (!p.dados.push.chavePublica) throw new Error("As notificações no aparelho ainda não estão disponíveis.");
        await ativarPush(p.dados.push.chavePublica, !!atual); setInscritoLocalmente(true);
        setMensagem("Notificações ativadas neste aparelho.");
      } else if (acao === "desativar") {
        if (!id || id === atual?.id) { await desativarPushLocal(); setInscritoLocalmente(false); }
        else await api("/api/notificacoes/inscricoes", { method: "DELETE", body: { id } });
        setMensagem("Notificações desativadas no aparelho escolhido.");
      } else {
        const resultado = await api<{ ok: boolean; simulado: boolean; mensagem: string }>("/api/notificacoes/teste", { method: "POST" });
        setMensagem(resultado.mensagem);
      }
      await p.onAlterado();
    } catch (e) { setMensagem((e as Error).message); }
    finally { setOcupado(false); window.dispatchEvent(new Event("black:push")); }
  }
  const podeAtivar = p.dados.push.disponivel && !!p.dados.push.chavePublica && acesso !== "indisponivel" && acesso !== "carregando" && acesso !== "denied" && !(app.ios && !app.instalado);
  return <section className="cartao space-y-3" aria-labelledby="push-avisos-titulo">
    <h2 id="push-avisos-titulo" className="font-semibold">Avisos com o aplicativo fechado</h2>
    <p className="text-sm text-zinc-600">Os avisos na tela do aparelho mostram apenas uma mensagem geral. Abra sua conta para consultar os detalhes.</p>
    {ativo ? <p className="text-sm text-emerald-700">Ativados neste aparelho.</p>
      : acesso === "carregando" ? <p className="text-sm text-zinc-500">Verificando navegador…</p>
        : app.ios && !app.instalado ? <p className="text-sm text-zinc-600">No iPhone ou iPad, instale pela tela inicial e abra o ícone do aplicativo antes de ativar notificações.</p>
          : acesso === "denied" ? <p className="text-sm text-amber-700">O navegador bloqueou as notificações. Abra as permissões deste site nas configurações do navegador, libere “Notificações” e volte aqui.</p>
            : acesso === "indisponivel" ? <p className="text-sm text-zinc-600">Este navegador não permite notificações neste modo. Você pode consultar todos os avisos nesta central.</p>
              : !p.dados.push.disponivel ? <p className="text-sm text-zinc-600">As notificações no aparelho ainda não estão habilitadas pela barbearia. Seus avisos continuam disponíveis aqui.</p>
                : <p className="text-sm text-zinc-600">Escolha ativar para receber avisos neste aparelho. A permissão será pedida pelo navegador.</p>}
    {p.dados.push.modo === "simulado" && <p className="text-sm text-amber-700">Ambiente de teste: a simulação cria um aviso nesta central e não envia uma notificação real.</p>}
    <div className="flex flex-wrap gap-2">
      {!ativo && podeAtivar && <button className="btn-primario focus-visible:ring-2 focus-visible:ring-ouro" disabled={ocupado} onClick={() => void executar("ativar")}>{ocupado ? "Aguarde…" : "Ativar neste aparelho"}</button>}
      {(atual || inscritoLocalmente) && <button className="btn focus-visible:ring-2 focus-visible:ring-ouro" disabled={ocupado} onClick={() => void executar("desativar")}>Desativar neste aparelho</button>}
      {(ativo || p.dados.push.modo === "simulado") && <button className="btn focus-visible:ring-2 focus-visible:ring-ouro" disabled={ocupado} onClick={() => void executar("teste")}>{p.dados.push.modo === "simulado" ? "Simular aviso de teste" : "Enviar aviso de teste"}</button>}
    </div>
    {!!p.dados.dispositivos.length && <details className="text-sm"><summary className="cursor-pointer py-2 focus-visible:ring-2 focus-visible:ring-ouro">Seus aparelhos</summary>
      <ul className="divide-y divide-zinc-200">{p.dados.dispositivos.map(d => <li key={d.id} className="flex items-center gap-3 py-3">
        <span className="min-w-0 flex-1 break-words">{d.nome}{d.atual ? " · este aparelho" : ""}<span className="block text-xs text-zinc-500">{d.ativo ? "Ativo" : "Desativado"}{d.codigoErro ? " · verifique a permissão ou ative novamente" : ""}</span></span>
        {d.ativo && <button className="btn focus-visible:ring-2 focus-visible:ring-ouro" disabled={ocupado} onClick={() => void executar("desativar", d.id)} aria-label={`Desativar notificações de ${d.nome}`}>Desativar</button>}
      </li>)}</ul>
    </details>}
    <p role="status" className="text-sm text-zinc-600">{ocupado ? "Atualizando…" : mensagem}</p>
  </section>;
}
