import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";
import { estadoPiloto } from "@/lib/whatsapp/piloto";
import { campanhasManuaisAposPiloto, recursoPiloto } from "@/lib/whatsapp/piloto-regras";
import { testeEquipeAtivo } from "@/lib/whatsapp/teste-equipe";

export async function campanhasBloqueadas() {
  return process.env.WHATSAPP_ENVIOS_BLOQUEADOS === "true" || quarentenaRestauracao() || testeEquipeAtivo() ||
    (recursoPiloto() && !campanhasManuaisAposPiloto(await estadoPiloto()));
}
