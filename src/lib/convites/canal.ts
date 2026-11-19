import { configuracao } from "@/lib/agenda/carregar";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";
import { estadoPiloto } from "@/lib/whatsapp/piloto";
import { atendimentoAposPiloto, recursoPiloto } from "@/lib/whatsapp/piloto-regras";
import { destinoTesteIndividual, testeEquipeAtivo } from "@/lib/whatsapp/teste-equipe";

export async function canalConviteAtivo(equipe = false) {
  if (quarentenaRestauracao() || (!equipe && (testeEquipeAtivo() || process.env.WHATSAPP_ENVIOS_BLOQUEADOS === "true"))) return false;
  if (!equipe && process.env.WHATSAPP_ATENDIMENTO_IA_PAGA !== "true" && process.env.WHATSAPP_ATENDIMENTO_APOS_PILOTO !== "true") return false;
  if (!equipe && recursoPiloto() && !atendimentoAposPiloto(await estadoPiloto())) return false;
  return (await configuracao()).botAtivo || !!(equipe && destinoTesteIndividual());
}
