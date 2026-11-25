type Atendimento = { inicio: Date; barbeiro: string; servicos: string[]; cliente?: string };

/** Apenas dados do atendimento, sem contatos, observações ou valores. */
export function textoAtendimento(a: Atendimento, fuso: string) {
  const limpar = (texto: string) => texto.replace(/\s+/g, " ").trim().slice(0, 80);
  const servicos = a.servicos.slice(0, 3).map(limpar).join(" + ") + (a.servicos.length > 3 ? ` e mais ${a.servicos.length - 3} serviço(s)` : "");
  const data = a.inicio.toLocaleDateString("pt-BR", { timeZone: fuso });
  const hora = a.inicio.toLocaleTimeString("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" });
  return `${a.cliente ? `${limpar(a.cliente)} · ` : ""}${servicos} com ${limpar(a.barbeiro)} · ${data} às ${hora}`;
}
