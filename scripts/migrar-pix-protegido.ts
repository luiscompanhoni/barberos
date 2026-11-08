/** Migração offline somente em banco local descartável. Produção exige procedimento próprio aprovado. */
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/barberos_(?:ci_local|teste|test)(?:_|$)/.test(url.pathname)) throw new Error("Migração restrita ao banco local descartável.");
  process.env.WHATSAPP_ENVIOS_BLOQUEADOS = "true";
  globalThis.fetch = async () => { throw new Error("Rede externa bloqueada na migração local."); };
  const { migrarPixLegado } = await import("@/lib/rh/pix-migracao");
  const { db } = await import("@/lib/db");
  try { console.log(JSON.stringify(await migrarPixLegado())); }
  finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Migração Pix não concluída. Dados originais preservados para os registros não confirmados; não copie valores ou segredos para logs."); process.exitCode = 1; });
