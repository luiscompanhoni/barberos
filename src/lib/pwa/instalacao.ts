type EventoInstalacao = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
export type EstadoInstalacao = { carregado: boolean; instalado: boolean; ios: boolean; seguro: boolean; podeInstalar: boolean; recusado: boolean };

const INICIAL: EstadoInstalacao = { carregado: false, instalado: false, ios: false, seguro: false, podeInstalar: false, recusado: false };
let estado = INICIAL;
let evento: EventoInstalacao | null = null;
let observando = false;
let instaladoAgora = false;
const ouvintes = new Set<() => void>();

function atualizar() {
  const nav = navigator as Navigator & { standalone?: boolean };
  estado = { carregado: true,
    instalado: instaladoAgora || window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
    ios: /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1),
    seguro: window.isSecureContext, podeInstalar: evento !== null, recusado: estado.recusado,
  };
  for (const ouvir of ouvintes) ouvir();
}

/** Captura o evento antecipadamente; pedir instalação continua dependendo de um clique. */
export function observarInstalacao() {
  if (typeof window === "undefined" || observando) return;
  observando = true;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); evento = e as EventoInstalacao; atualizar(); });
  window.addEventListener("appinstalled", () => { evento = null; instaladoAgora = true; estado = { ...estado, recusado: false }; atualizar(); });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", atualizar);
  atualizar();
}

export function assinarInstalacao(ouvir: () => void) { ouvintes.add(ouvir); observarInstalacao(); return () => { ouvintes.delete(ouvir); }; }
export const estadoInstalacao = () => estado;
export const estadoInstalacaoServidor = () => INICIAL;

export async function instalarApp() {
  const atual = evento;
  if (!atual) return;
  evento = null;
  await atual.prompt();
  const escolha = await atual.userChoice;
  estado = { ...estado, recusado: escolha.outcome === "dismissed" };
  atualizar();
}
