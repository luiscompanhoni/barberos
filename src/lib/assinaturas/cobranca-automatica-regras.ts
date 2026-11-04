export type CobrancaParaAviso = {
  status: string;
  vencimento: Date;
  forma: string | null;
  expiraEm: Date | null;
  link: string | null;
  tokenPublico: string | null;
  assinaturaStatus: string;
  pausadaEm: Date | null;
  encerraEm: Date | null;
  aceitaMensagens: boolean;
  excluido: boolean;
  historicaVinculada: boolean;
};

/** Conservador: não transforma dúvida de pagamento ou validade em convite para pagar. */
export function linkPermitido(link: string | null, tokenPublico: string | null, dominiosPermitidos: string[] = []) {
  if (!link) return false;
  if (link.startsWith("/")) return !!tokenPublico && /^[A-Za-z0-9_-]+$/.test(tokenPublico) && link === `/c/pagar/${tokenPublico}`;
  try {
    const url = new URL(link);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && dominiosPermitidos.includes(url.hostname.toLowerCase());
  } catch { return false; }
}

export function avaliarCobrancaAutomatica(c: CobrancaParaAviso, hoje: string, agora: Date, dominiosPermitidos: string[] = []) {
  if (c.excluido || !c.aceitaMensagens || c.assinaturaStatus === "CANCELADA") return { estado: "CANCELADA" as const, motivo: "destinatario_indisponivel" };
  // Uma pausa ou cancelamento agendado exige conferir a dívida; não presumir
  // que a fatura foi extinta nem cobrar automaticamente durante essa condição.
  if (c.pausadaEm || c.encerraEm) return { estado: "REVISAO" as const, motivo: "assinatura_pausada_ou_encerrando" };
  if (c.historicaVinculada) return { estado: "REVISAO" as const, motivo: "origem_historica" };
  if (c.status === "ESTORNADA") return { estado: "REVISAO" as const, motivo: "estornada" };
  if (c.status !== "PENDENTE" && c.status !== "ATRASADA") return { estado: "CANCELADA" as const, motivo: "nao_esta_em_aberto" };
  if (c.vencimento.toISOString().slice(0, 10) > hoje) return { estado: "CANCELADA" as const, motivo: "ainda_nao_venceu" };
  if (!linkPermitido(c.link, c.tokenPublico, dominiosPermitidos)) return { estado: "REVISAO" as const, motivo: "link_indisponivel" };
  if (c.forma === "PIX" && (!c.expiraEm || +c.expiraEm <= +agora + 3_600_000)) return { estado: "REVISAO" as const, motivo: "pix_vencido_ou_validade_desconhecida" };
  if (c.forma === "BOLETO" && c.vencimento.toISOString().slice(0, 10) < hoje) return { estado: "REVISAO" as const, motivo: "boleto_vencido" };
  return { estado: "PREPARADA" as const, motivo: null };
}
