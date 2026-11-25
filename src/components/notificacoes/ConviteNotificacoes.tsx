"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/cliente-api";
import type { PainelNotificacoes } from "@/lib/notificacoes/tipos";
import { podeConvidarPush } from "@/lib/pwa/convite-push";
import { assinarInstalacao, estadoInstalacao, estadoInstalacaoServidor } from "@/lib/pwa/instalacao";
import { ativarPush, inscricaoPushLocal, suportaPush } from "@/lib/pwa/push-cliente";

export function ConviteNotificacoes({ area, usuarioId }: { area: "cliente" | "equipe"; usuarioId: string }) {
  const app = useSyncExternalStore(assinarInstalacao, estadoInstalacao, estadoInstalacaoServidor);
  const [dados, setDados] = useState<PainelNotificacoes | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const chave = `black:convite-push:v1:${usuarioId}`;
  useEffect(() => {
    let vivo = true;
    let adiado = 0;
    try { adiado = Number(localStorage.getItem(chave)) || 0; } catch { /* Armazenamento privado pode estar indisponível. */ }
    if (!podeConvidarPush(app, suportaPush() ? Notification.permission : "indisponivel", adiado)) return;
    async function conferir() {
      try {
        const [painel, inscrito] = await Promise.all([api<PainelNotificacoes>("/api/notificacoes"), inscricaoPushLocal()]);
        if (!vivo || painel.usuarioId !== usuarioId || !painel.push.disponivel || !painel.push.chavePublica) return;
        if (!(area === "cliente" ? painel.preferencias.agenda : painel.preferencias.equipe)) return;
        if (Notification.permission === "granted" && inscrito && painel.dispositivos.some(d => d.atual && d.ativo)) return;
        setDados(painel);
      } catch { /* A central continua oferecendo ativação quando a rede voltar. */ }
    }
    void conferir();
    return () => { vivo = false; };
  }, [app, area, usuarioId, chave]);

  function adiar() {
    if (ocupado) return;
    try { localStorage.setItem(chave, String(Date.now() + 7 * 86_400_000)); } catch { /* Não impede fechar. */ }
    setDados(null);
  }
  async function ativar() {
    if (!dados?.push.chavePublica || ocupado) return;
    setOcupado(true); setErro("");
    try {
      await ativarPush(dados.push.chavePublica, dados.dispositivos.some(d => d.atual && d.ativo));
      try { localStorage.setItem(chave, String(Date.now() + 7 * 86_400_000)); } catch { /* O vínculo é confirmado pelo servidor. */ }
      setDados(null); window.dispatchEvent(new Event("black:push"));
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }
  if (!dados) return null;
  return <Modal titulo="Ative as notificações" onFechar={adiar}>
    <p className="text-sm text-zinc-600">{area === "cliente"
      ? "Receba lembretes do seu agendamento com serviço, data, horário e barbeiro, mesmo com o aplicativo fechado."
      : "Receba avisos de novos agendamentos com cliente, serviço, data, horário e barbeiro, mesmo com o aplicativo fechado."}</p>
    <p className="mt-3 text-sm text-zinc-600">Esses detalhes podem aparecer na tela bloqueada. Ao continuar, seu aparelho pedirá permissão para enviar notificações.</p>
    <div className="mt-5 flex flex-wrap gap-2">
      <button className="btn-primario" disabled={ocupado} onClick={() => void ativar()}>{ocupado ? "Ativando…" : "Ativar notificações"}</button>
      <button className="btn" disabled={ocupado} onClick={adiar}>Agora não</button>
    </div>
    <Link className="mt-4 block text-sm underline" href={area === "cliente" ? "/c/notificacoes" : "/notificacoes"} onClick={adiar}>Escolher quais avisos receber</Link>
    {erro && <p role="alert" className="mt-3 text-sm text-red-600">{erro}</p>}
  </Modal>;
}
