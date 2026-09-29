/**
 * Roda uma vez quando o servidor sobe. Em producao:
 * - confere configuracoes obrigatorias (falha cedo em vez de quebrar no meio do uso);
 * - cria o dono no primeiro deploy a partir de DONO_TELEFONE / DONO_NOME.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;

  const faltando = ["DATABASE_URL", "SESSION_SECRET"].filter((k) => !process.env[k]);
  if (faltando.length) throw new Error(`Variaveis obrigatorias ausentes: ${faltando.join(", ")}`);
  if ((process.env.SESSION_SECRET ?? "").length < 32) throw new Error("SESSION_SECRET precisa de 32+ caracteres.");
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
    create: { telefone: tel, nome: process.env.DONO_NOME ?? "Dono", papel: "DONO" },
    update: { papel: "DONO", ativo: true },
  });
  await db.configuracao.upsert({
    where: { id: 1 },
    create: { id: 1, nomeBarbearia: process.env.NOME_BARBEARIA ?? "Barbearia" },
    update: {},
  });
  console.log(`[BarberOS] Dono criado para ${tel}.`);
}
