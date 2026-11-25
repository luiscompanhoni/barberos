import type { EstadoInstalacao } from "./instalacao";

export function podeConvidarPush(app: Pick<EstadoInstalacao, "carregado" | "seguro" | "ios" | "instalado">, permissao: NotificationPermission | "indisponivel", adiadoAte: number, agora = Date.now()) {
  return app.carregado && app.seguro && !(app.ios && !app.instalado)
    && permissao !== "denied" && permissao !== "indisponivel" && !(adiadoAte > agora);
}
