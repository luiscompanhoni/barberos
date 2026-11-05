import { api } from "@/lib/cliente-api";

export type HorarioInicio = {
  id: string; inicio: string; status: string; precoCentavos: number; assinaturaId?: string | null;
  barbeiro: { id?: string; nome: string; cor?: string; fotoVersao?: number };
  servico: { id?: string; nome: string };
  adicionais?: { precoCentavos: number; servico: { id?: string; nome: string } }[];
  antecipado?: { status: string } | null;
};
export type AgendaInicio = { proximos: HorarioInicio[]; historico: HorarioInicio[]; prazoAlteracaoMin: number; pagarAntes?: boolean; checkout?: boolean };
type AssinaturaInicio = { plano: { nome: string }; valida: boolean; status: string; proximoVencimento: string | null;
  cobrancaEmAberto: { link: string | null } | null; pausadaAte: string | null; valeAte: string | null; operacaoEmConferencia?: boolean };
export type PlanoInicio = { nome: string; valida: boolean; status: string; link: string | null; vencimento: string | null;
  pausadaAte: string | null; valeAte: string | null; conferindo: boolean };

/** Agenda/perfil são essenciais; falha do plano não significa ausência de assinatura. */
export async function carregarInicioCliente() {
  const [dados, perfil, assinatura] = await Promise.all([
    api<AgendaInicio>("/api/cliente/agendamentos"),
    api<{ nome: string }>("/api/cliente/perfil"),
    api<{ atual: AssinaturaInicio | null }>("/api/cliente/assinatura").catch(() => undefined),
  ]);
  const atual = assinatura?.atual;
  const plano: PlanoInicio | null | undefined = assinatura === undefined ? undefined : atual ? {
    nome: atual.plano.nome, valida: atual.valida, status: atual.status,
    link: atual.operacaoEmConferencia ? null : atual.cobrancaEmAberto?.link ?? null,
    vencimento: atual.proximoVencimento, pausadaAte: atual.pausadaAte, valeAte: atual.valeAte,
    conferindo: atual.operacaoEmConferencia === true,
  } : null;
  return { dados, perfil, plano };
}
