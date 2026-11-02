import { execucaoHabilitada } from "./acesso";
import { enfileirarRotinasAgentes } from "./rotinas";
import { processarUmaExecucao } from "./processar";

/** O temporizador apenas acorda o trabalhador; agenda, lease e deduplicação ficam no banco. */
export function agendarCentralAgentes() {
  if (!execucaoHabilitada()) return;
  const g = globalThis as unknown as { centralAgentesIniciada?: boolean };
  if (g.centralAgentesIniciada) return;
  g.centralAgentesIniciada = true;
  let rodando = false;
  const executar = async () => {
    if (rodando || !execucaoHabilitada()) return;
    rodando = true;
    try { await enfileirarRotinasAgentes(); await processarUmaExecucao(); }
    catch { console.error("[agentes] Falha no trabalhador. Consulte a central; nenhuma repetição de efeito externo é realizada."); }
    finally { rodando = false; }
  };
  setTimeout(executar, 60_000).unref();
  setInterval(executar, 60_000).unref();
}
