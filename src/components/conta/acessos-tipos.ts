export type PapelEquipe = "DONO" | "GERENTE" | "LIDER" | "RECEPCAO" | "BARBEIRO";
export type Acesso = {
  id: string; nome: string; telefone: string; papel: PapelEquipe; login: string | null;
  ativo: boolean; eu: boolean; temSenha: boolean; trocarSenha: boolean; bloqueado: boolean;
  barbeiro: { id: string; ativo: boolean; cor: string; fotoVersao: number; servicos: { servicoId: string }[] } | null;
  checklistPessoa: { id: string; cargo: string | null; funcao: "BARBEIRO" | "GERENTE" | "DIARISTA" } | null;
};
export const PAPEIS_EQUIPE: Record<PapelEquipe, string> = {
  DONO: "Dono / sócio", GERENTE: "Gerente", LIDER: "Líder de equipe", RECEPCAO: "Recepção", BARBEIRO: "Barbeiro",
};
