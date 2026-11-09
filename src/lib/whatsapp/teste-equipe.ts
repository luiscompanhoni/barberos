import { db } from "@/lib/db";
import { telefonePiloto } from "./piloto-regras";

/** Homologação no WhatsApp real: somente dono/gerente ativo, sem campanhas. */
export const testeEquipeAtivo = () => process.env.WHATSAPP_ATENDIMENTO_TESTE_EQUIPE === "true" && process.env.BARBEROS_QUARENTENA_RESTAURACAO !== "true";

export async function destinatarioTesteEquipe(para: string) {
  if (!testeEquipeAtivo()) return false;
  const telefone = telefonePiloto(para);
  if (!telefone) return false;
  return !!await db.usuario.findFirst({
    where: { telefone, ativo: true, papel: { in: ["DONO", "GERENTE"] } }, select: { id: true },
  });
}

export async function envioTesteEquipe(para: string, origem: string) {
  return origem === "ATENDIMENTO" && await destinatarioTesteEquipe(para);
}
