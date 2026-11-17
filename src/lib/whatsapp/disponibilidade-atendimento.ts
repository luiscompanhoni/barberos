import { configuracao } from "@/lib/agenda/carregar";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";
import { provedorWhatsApp } from "./canal";
import { publicarDisponibilidadeEvolution } from "./evolution";
import { estadoPiloto } from "./piloto";
import { atendimentoAposPiloto, recursoPiloto } from "./piloto-regras";
import { testeEquipeAtivo } from "./teste-equipe";

let publicada = false;
let emAndamento: Promise<void> | undefined;

async function atualizar() {
  if (provedorWhatsApp() !== "evolution" || quarentenaRestauracao()) return;
  const podeAtender = !testeEquipeAtivo() && process.env.WHATSAPP_ENVIOS_BLOQUEADOS !== "true" &&
    process.env.WHATSAPP_ATENDIMENTO_IA_PAGA === "true" &&
    Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const ativo = podeAtender && (await configuracao()).botAtivo &&
    (!recursoPiloto() || atendimentoAposPiloto(await estadoPiloto()));
  // Atualiza a disponibilidade também depois de uma reconexão da Evolution.
  // Um piloto individual nunca coloca toda a conta online.
  if (ativo || publicada) {
    await publicarDisponibilidadeEvolution(ativo);
    publicada = ativo;
  }
}

export function sincronizarDisponibilidadeAtendimento() {
  emAndamento ??= atualizar()
    .catch(() => console.warn("[whatsapp] Falha ao atualizar a disponibilidade do atendimento."))
    .finally(() => { emAndamento = undefined; });
  return emAndamento;
}
