/** Regras puras da LGPD (testadas em tests/lgpd.test.ts). */

export type Pendencias = {
  assinaturasAbertas: number;
  cobrancasEmAberto: number;
  pagamentosPendentes: number;
  comandasAbertas: number;
  horariosFuturos: number;
};

/**
 * O que impede o cliente de excluir a conta sozinho: o que ainda envolve dinheiro ou um horario marcado.
 * Devolve as frases para mostrar (vazio = pode excluir).
 */
export function impedimentosExclusao(p: Pendencias): string[] {
  const m: string[] = [];
  if (p.assinaturasAbertas) m.push("Cancele seu plano antes (Plano > Cancelar).");
  if (p.cobrancasEmAberto || p.pagamentosPendentes) m.push("Há pagamento em aberto. Pague ou fale com a barbearia para cancelar.");
  if (p.comandasAbertas) m.push("Há uma comanda aberta no balcão. Ela precisa ser fechada antes.");
  if (p.horariosFuturos) m.push("Cancele seus horários marcados antes.");
  return m;
}

/** Telefone que fica no lugar do numero apagado (unico por cliente, nunca casa com um numero real). */
export const telefoneExcluido = (id: string) => `excluido-${id}`;

export const NOME_EXCLUIDO = "Cliente excluído";

/** Confirmacao digitada pelo cliente antes de excluir (sem acento e sem diferenciar maiusculas). */
export const confirmouExclusao = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase() === "EXCLUIR";
