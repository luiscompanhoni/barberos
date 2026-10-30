import { createECDH } from "node:crypto";
import { ehHomologacao } from "@/lib/ambiente";
import { chavePublicaValida, hashPush } from "./regras";
import type { ConfiguracaoPushPublica } from "./tipos";

export function configuracaoPush() {
  const chavePublica = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const chavePrivada = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const contato = process.env.VAPID_SUBJECT?.trim() ?? "";
  const modo = ehHomologacao() || process.env.PUSH_PROVIDER === "simulado" ? "simulado"
    : process.env.PUSH_PROVIDER === "webpush" ? "real" : "desativado";
  const publicaValida = chavePublicaValida(chavePublica);
  let parValido = false;
  if (publicaValida && /^[A-Za-z0-9_-]{43}$/.test(chavePrivada)) {
    try {
      const ec = createECDH("prime256v1"); ec.setPrivateKey(Buffer.from(chavePrivada, "base64url"));
      parValido = ec.getPublicKey().toString("base64url") === chavePublica;
    } catch { /* Configuração inválida mantém o provedor indisponível. */ }
  }
  let contatoValido = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contato);
  if (!contatoValido) {
    try { const u = new URL(contato); contatoValido = u.protocol === "https:" && !u.username && !u.password; } catch { /* Sem contato válido não envia. */ }
  }
  const disponivel = modo !== "desativado" && publicaValida && (modo === "simulado" || (parValido && contatoValido));
  return { modo, disponivel, chavePublica, chavePrivada, contato, vapidHash: publicaValida ? hashPush(chavePublica) : "", motivo: modo === "desativado" ? "Notificações push ainda não foram ativadas pelo administrador." : !disponivel ? "A configuração de notificações push ainda não está pronta. Os avisos continuam disponíveis nesta central." : null } as const;
}

export function configuracaoPushPublica(): ConfiguracaoPushPublica {
  const c = configuracaoPush();
  return { modo: c.modo, disponivel: c.disponivel, chavePublica: c.disponivel ? c.chavePublica : null, motivo: c.motivo };
}
