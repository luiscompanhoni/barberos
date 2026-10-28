export type CategoriaNotificacao = "AGENDA" | "AVALIACAO" | "RECOMPRA" | "EQUIPE" | "TESTE";
export type PreferenciasNotificacoes = { agenda: boolean; avaliacoes: boolean; recompra: boolean; equipe: boolean };
export type NotificacaoDto = {
  id: string; categoria: CategoriaNotificacao; titulo: string; corpo: string; href: string;
  criadoEm: string; expiraEm: string; lidaEm: string | null;
};
export type DispositivoPushDto = {
  id: string; nome: string; atual: boolean; ativo: boolean; criadoEm: string;
  ultimoEnvioEm: string | null; codigoErro: string | null;
};
export type ConfiguracaoPushPublica = {
  modo: "real" | "simulado" | "desativado"; disponivel: boolean;
  chavePublica: string | null; motivo: string | null;
};
export type PainelNotificacoes = {
  usuarioId: string; itens: NotificacaoDto[]; naoLidas: number;
  preferencias: PreferenciasNotificacoes; dispositivos: DispositivoPushDto[];
  push: ConfiguracaoPushPublica;
};
