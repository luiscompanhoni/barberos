import type { Instrumentation } from "next";

/**
 * Erro no servidor: uma linha com o codigo que aparece na tela "Algo deu errado" (digest), para achar no log
 * com `docker compose logs app | grep "codigo=..."`. Sem a query (pode ter token de webhook ou de link).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : "-";
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[erro] codigo=${digest} ${request.method} ${request.path.split("?")[0]} (${context.routeType} ${context.routePath}): ${msg}`);
};

/**
 * Roda uma vez quando o servidor sobe. Em producao:
 * - confere configuracoes obrigatorias (falha cedo em vez de quebrar no meio do uso);
 * - cria o dono no primeiro deploy a partir de DONO_TELEFONE / DONO_NOME.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Rotina de pagamentos (Pix mensal e cobrancas vencidas) roda tambem em desenvolvimento.
  (await import("@/lib/assinaturas/rotina")).agendarRotina();
  // Lembretes, pos-falta, pos-atendimento e reativacao (a cada 5 min).
  (await import("@/lib/automacoes/rotina")).agendarAutomacoes();
  if (process.env.NODE_ENV !== "production") return;

  const faltando = ["DATABASE_URL", "SESSION_SECRET"].filter((k) => !process.env[k]);
  if (faltando.length) throw new Error(`Variaveis obrigatorias ausentes: ${faltando.join(", ")}`);
  if ((process.env.SESSION_SECRET ?? "").length < 32) throw new Error("SESSION_SECRET precisa de 32+ caracteres.");
  for (const k of ["SITE_URL", "PAINEL_URL"]) {
    const v = process.env[k];
    if (v && !v.startsWith("https://")) console.warn(`[BarberOS] ${k} sem https (${v}): links de pagamento e calendário não vão funcionar fora daqui.`);
  }
  if (process.env.PAINEL_URL && !process.env.SITE_URL) throw new Error("PAINEL_URL definido sem SITE_URL: informe os dois endereços.");
  if (process.env.MAQUININHA === "stone") {
    const semStone = ["STONE_POS_SERIAL", "PAGARME_SECRET_KEY", "PAGARME_WEBHOOK_TOKEN"].filter((k) => !process.env[k]);
    if (semStone.length) throw new Error(`MAQUININHA=stone precisa de: ${semStone.join(", ")}`);
  }
  if (process.env.MAQUININHA === "simulada") console.warn("[BarberOS] MAQUININHA=simulada em producao: pagamentos de cartao podem ser aprovados por botao.");
  if (!process.env.ANTHROPIC_API_KEY) console.warn("[BarberOS] ANTHROPIC_API_KEY ausente: o bot vai passar as conversas para a equipe.");
  if ((process.env.OTP_PROVIDER ?? "console") === "console") {
    console.warn("[BarberOS] OTP_PROVIDER=console em producao: os codigos de login so aparecem no log do servidor.");
  }

  const telefone = process.env.DONO_TELEFONE;
  if (!telefone) return;
  const { db } = await import("@/lib/db");
  const { normalizarTelefone } = await import("@/lib/telefone");
  const tel = normalizarTelefone(telefone);
  if (!tel) return console.error("[BarberOS] DONO_TELEFONE invalido.");
  if (await db.usuario.count({ where: { papel: "DONO" } })) return;
  await db.usuario.upsert({
    where: { telefone: tel },
    create: { telefone: tel, nome: process.env.DONO_NOME || "Dono", papel: "DONO" },
    update: { papel: "DONO", ativo: true },
  });
  await db.configuracao.upsert({
    where: { id: 1 },
    create: { id: 1, nomeBarbearia: process.env.NOME_BARBEARIA || "Barbearia" },
    update: {},
  });
  console.log(`[BarberOS] Dono criado para ${tel}.`);
}
