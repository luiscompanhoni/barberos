import { db } from "@/lib/db";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";
import { recuperarEntradaInstagramPendente } from "./persistencia";
import { zIdInstagram } from "./protocolo";

const MINUTO = 60_000;
const g = globalThis as typeof globalThis & { instagramRecuperacaoAtiva?: boolean };

/** Recupera entradas persistidas cujo turno ficou sem conclusão, sem tentar responder. */
export async function recuperarEntradasInstagramPendentes(agora = new Date()) {
  if (quarentenaRestauracao()) return 0;
  const limite = new Date(+agora - 5 * MINUTO);
  const pendentes = await db.mensagem.findMany({
    where: { autor: "CLIENTE", instagramPendenteEm: { lte: limite }, wamid: { startsWith: "instagram:" } },
    orderBy: [{ instagramPendenteEm: "asc" }, { id: "asc" }], take: 100,
    select: { conversaId: true, wamid: true, criadoEm: true },
  });
  let encaminhadas = 0;
  let falhas = 0;
  for (const p of pendentes) {
    if (!p.wamid) continue;
    const entrada = { conversaId: p.conversaId, mid: p.wamid.slice("instagram:".length), timestamp: +p.criadoEm };
    try {
      if (await recuperarEntradaInstagramPendente(entrada, limite)) encaminhadas++;
    } catch { falhas++; }
  }
  if (falhas) console.error(`[instagram] A recuperação deixou ${falhas} entrada(s) pendente(s).`);
  return encaminhadas;
}

export function iniciarRecuperacaoInstagram() {
  const habilitada = () => !!process.env.INSTAGRAM_APP_SECRET && zIdInstagram.safeParse(process.env.INSTAGRAM_PROFESSIONAL_ACCOUNT_ID).success && !quarentenaRestauracao();
  if (g.instagramRecuperacaoAtiva || !habilitada()) return;
  g.instagramRecuperacaoAtiva = true;
  let emCurso = false;
  const executar = async () => {
    if (emCurso || !habilitada()) return;
    emCurso = true;
    try {
      await recuperarEntradasInstagramPendentes();
    } catch {
      console.error("[instagram] Falha na recuperação de entradas pendentes.");
    } finally { emCurso = false; }
  };
  void executar();
  setInterval(executar, MINUTO).unref();
}
