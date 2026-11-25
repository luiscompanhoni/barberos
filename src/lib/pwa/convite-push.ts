import type { EstadoInstalacao } from "./instalacao";

export function podeConvidarPush(app: EstadoInstalacao, permissao: NotificationPermission | "indisponivel", adiadoAte: number, agora = Date.now()) {
  return app.carregado && app.seguro && !(app.ios && !app.instalado)
    && permissao !== "denied" && permissao !== "indisponivel" && !(adiadoAte > agora);
}
