export type LinkNavegacao = { href: string; rotulo: string };
export type GrupoNavegacao = { titulo: string; itens: LinkNavegacao[]; agrupado: boolean };
const GRUPOS = [
  { titulo: "Visão geral", rotas: ["/painel", "/indicadores"], agrupado: false },
  { titulo: "Agenda", rotas: ["/recepcao", "/meu-dia", "/minha-agenda", "/semana"], agrupado: true },
  { titulo: "Operação", rotas: ["/comandas", "/caixa", "/conversas", "/financeiro"], agrupado: false },
  { titulo: "Relacionamento", rotas: ["/assinaturas", "/planos", "/campanhas", "/recompras", "/jogos"], agrupado: true },
  { titulo: "Equipe", rotas: ["/reunioes", "/desempenho", "/avaliacoes", "/checklist", "/rh", "/recrutamento", "/expediente", "/campanhas-equipe", "/cultura-black"], agrupado: true },
  { titulo: "Criação e estoque", rotas: ["/estudio", "/estoque"], agrupado: false },
  { titulo: "Configurações", rotas: ["/equipe", "/whatsapp", "/notificacoes", "/auditoria", "/simulador"], agrupado: true },
];
export function rotaAtiva(path: string, href: string) {
  const base = href.split("?")[0];
  return path === base || path.startsWith(`${base}/`);
}
/** Agrupa somente links já autorizados pelo servidor; destinos novos nunca desaparecem. */
export function agruparLinks(links: LinkNavegacao[]): GrupoNavegacao[] {
  const restantes = new Set(links);
  const grupos = GRUPOS.map(g => {
    const itens = links.filter(l => g.rotas.some(r => rotaAtiva(l.href, r)));
    itens.forEach(l => restantes.delete(l));
    return { titulo: g.titulo, agrupado: g.agrupado, itens };
  }).filter(g => g.itens.length > 0);
  if (restantes.size) grupos.push({ titulo: "Outras áreas", agrupado: true, itens: [...restantes] });
  return grupos;
}
export function atalhosMobile(links: LinkNavegacao[]) {
  const inicio = links.find(l => ["/painel", "/meu-dia", "/minha-agenda", "/recepcao"].includes(l.href));
  const agenda = links.find(l => ["/minha-agenda", "/recepcao", "/semana"].includes(l.href) && l.href !== inicio?.href);
  return [inicio, agenda, links.find(l => l.href === "/comandas"), links.find(l => l.href === "/financeiro")]
    .filter((l): l is LinkNavegacao => !!l);
}
