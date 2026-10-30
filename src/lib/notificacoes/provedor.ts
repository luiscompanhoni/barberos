import webPush from "web-push";
import { configuracaoPush } from "./configuracao";
import { authPushValido, chavePublicaValida, endpointPushValido, hrefNotificacaoValido, resultadoErroPush, type ResultadoProvedorPush } from "./regras";

type Destino = { endpoint: string; p256dh: string; auth: string; vapidHash: string };
export async function enviarPush(destino: Destino, aviso: { id: string; href: string; expiraEm: Date }, opts: { simular?: boolean; agora?: Date } = {}): Promise<ResultadoProvedorPush> {
  const cfg = configuracaoPush();
  const agora = opts.agora ?? new Date();
  if (!endpointPushValido(destino.endpoint) || !chavePublicaValida(destino.p256dh) || !authPushValido(destino.auth) || !hrefNotificacaoValido(aviso.href)) return { estado: "FALHOU", codigo: "INSCRICAO_INVALIDA", desativar: true };
  if (aviso.expiraEm <= agora) return { estado: "FALHOU", codigo: "AVISO_EXPIRADO" };
  if (cfg.modo === "simulado" || opts.simular === true) return { estado: "SIMULADO", codigo: null };
  if (!cfg.disponivel || cfg.modo !== "real") return { estado: "FALHOU", codigo: "PROVEDOR_DESATIVADO" };
  if (destino.vapidHash !== cfg.vapidHash) return { estado: "FALHOU", codigo: "CHAVE_ROTACIONADA", desativar: true };
  const ttl = Math.min(24 * 60 * 60, Math.floor((+aviso.expiraEm - +agora) / 1000));
  if (ttl <= 0) return { estado: "FALHOU", codigo: "AVISO_EXPIRADO" };
  try {
    // Só identificador e destino interno: tela bloqueada não recebe dados de clientes ou financeiros.
    await webPush.sendNotification({ endpoint: destino.endpoint, keys: { p256dh: destino.p256dh, auth: destino.auth } }, JSON.stringify({ id: aviso.id, href: aviso.href }), {
      TTL: ttl, urgency: "normal", timeout: 8000,
      vapidDetails: { subject: cfg.contato, publicKey: cfg.chavePublica, privateKey: cfg.chavePrivada },
    });
    return { estado: "ENVIADO", codigo: null };
  } catch (e) { return resultadoErroPush(e); }
}
