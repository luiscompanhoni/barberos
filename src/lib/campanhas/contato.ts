export function impedimentoCampanha(c: {
  aceitaMensagens: boolean;
  excluidoEm: Date | null;
  conversa: { estado: string; recusaAutomaticas: boolean } | null;
  assinaturas?: { migracao: { estado: string } | null }[];
}, temHorario = false) {
  if (c.excluidoEm) return "Cadastro excluído.";
  if (!c.aceitaMensagens || c.conversa?.recusaAutomaticas) return "Pediu para não receber mensagens.";
  if (c.conversa?.estado === "HUMANO") return "Atendimento com a equipe; revisar antes de novo convite.";
  if (c.assinaturas?.some((a) => a.migracao && a.migracao.estado !== "CONCLUIDO")) return "Migração em acompanhamento; priorizar a ajuda antes de nova campanha.";
  return temHorario ? "Já tem horário marcado." : null;
}
