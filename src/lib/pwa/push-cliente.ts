"use client";

import { api } from "@/lib/cliente-api";

let registro: Promise<ServiceWorkerRegistration> | null = null;

export function suportaPush() {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function registrarApp() {
  if (typeof window === "undefined" || !window.isSecureContext || !("serviceWorker" in navigator)) return Promise.reject(new Error("Este navegador não permite instalar o aplicativo neste endereço."));
  if (!registro) registro = navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(e => { registro = null; throw e; });
  return registro;
}

export function chaveVapid(base64: string) {
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  const texto = window.atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(texto, c => c.charCodeAt(0));
}

async function registroPronto() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, rejeitar) => { timer = setTimeout(() => rejeitar(new Error("O aplicativo ainda não ficou pronto para notificações. Recarregue a página e tente novamente.")), 20_000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Chamado pelo gesto do usuário; nunca solicitar permissão ao montar a tela. */
export async function ativarPush(chavePublica: string, dispositivoAtualAtivo: boolean) {
  if (!suportaPush()) throw new Error("Este navegador não oferece notificações neste modo.");
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") throw new Error(permissao === "denied" ? "As notificações estão bloqueadas. Libere nas configurações do navegador para tentar novamente." : "Você pode ativar as notificações quando quiser.");
  await registrarApp();
  const reg = await registroPronto();
  const chaveAtual = chaveVapid(chavePublica);
  let inscricao = await reg.pushManager.getSubscription();
  const chaveAnterior = inscricao?.options.applicationServerKey;
  const mesmaChave = chaveAnterior && chaveAnterior.byteLength === chaveAtual.byteLength
    && new Uint8Array(chaveAnterior).every((byte, i) => byte === chaveAtual[i]);
  if (inscricao && (!dispositivoAtualAtivo || !mesmaChave)) { await inscricao.unsubscribe(); inscricao = null; }
  const nova = !inscricao;
  inscricao ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveAtual });
  try {
    const dados = inscricao.toJSON();
    await api("/api/notificacoes/inscricoes", { method: "POST", body: { endpoint: dados.endpoint, keys: dados.keys, nome: "Este aparelho" } });
  } catch (e) { if (nova) await inscricao.unsubscribe(); throw e; }
}

/** Desvincula o aparelho ao sair e também cancela a inscrição local se a rede falhar. */
export async function desativarPushLocal({ servidor = true }: { servidor?: boolean } = {}) {
  let falha: unknown;
  if (servidor) {
    try { await api("/api/notificacoes/inscricoes", { method: "DELETE", body: {} }); }
    catch (e) { falha = e; }
  }
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const inscricao = await reg?.pushManager?.getSubscription();
    if (inscricao) await inscricao.unsubscribe();
    for (const aviso of await reg?.getNotifications() ?? []) aviso.close();
  }
  if (falha) throw falha;
}
