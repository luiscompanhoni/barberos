import { normalizarTelefone } from "@/lib/telefone";
export type EstadoPiloto = { ativo: boolean; telefone: string | null; expiraEm: Date | null; enviados: number; versao: number };
export const recursoPiloto = () => process.env.WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO === "true";
/** Ativação independente, deliberada, somente após o encerramento confirmado do piloto. */
export function atendimentoAposPiloto(p: EstadoPiloto | null) {
  return recursoPiloto() && process.env.WHATSAPP_ATENDIMENTO_APOS_PILOTO === "true" && !!p && !p.ativo;
}
export function telefonePiloto(valor: string) {
  const numero = valor.replace(/@s\.whatsapp\.net$/i, "");
  if (!/^(?:55)?[0-9]{10,11}$/.test(numero)) return null;
  return normalizarTelefone(numero);
}
export function permitePiloto(p: EstadoPiloto | null, para: string, origem: string, agora = Date.now()) {
  return !!p?.ativo && !!p.expiraEm && +p.expiraEm > agora && p.enviados < 40 && origem === "ENTREVISTA_PILOTO" && !!p.telefone && telefonePiloto(para) === p.telefone;
}
