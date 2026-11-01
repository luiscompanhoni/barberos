import { describe, expect, it } from "vitest";
import { agruparLinks, atalhosMobile, rotaAtiva } from "@/components/navegacao/estrutura";

describe("navegação Black preserva destinos autorizados", () => {
  it("mantém cada destino recebido, incluindo subrotas e módulos novos", () => {
    const rotas = ["/painel", "/meu-dia", "/recepcao", "/semana", "/minha-agenda", "/comandas", "/caixa", "/conversas", "/financeiro", "/indicadores/barbeiro/123", "/assinaturas", "/planos", "/campanhas", "/recompras", "/jogos", "/reunioes", "/desempenho", "/avaliacoes", "/checklist", "/rh", "/recrutamento", "/expediente", "/campanhas-equipe", "/cultura-black", "/estudio", "/estoque", "/equipe", "/whatsapp", "/notificacoes", "/auditoria", "/simulador", "/modulo-futuro"];
    const links = rotas.map(href => ({ href, rotulo: href }));
    const agrupados = agruparLinks(links).flatMap(g => g.itens);
    expect(agrupados).toHaveLength(links.length);
    expect(new Set(agrupados.map(l => l.href))).toEqual(new Set(rotas));
  });
  it("não introduz acessos quando o servidor fornece apenas links do barbeiro", () => {
    const links = ["/meu-dia", "/minha-agenda", "/comandas", "/financeiro", "/estudio"].map(href => ({ href, rotulo: href }));
    expect(agruparLinks(links).flatMap(g => g.itens).every(l => links.includes(l))).toBe(true);
    expect(atalhosMobile(links).map(l => l.href)).toEqual(["/meu-dia", "/minha-agenda", "/comandas", "/financeiro"]);
  });
  it("não confunde rotas com prefixos semelhantes", () => {
    expect(rotaAtiva("/financeiro-extra", "/financeiro")).toBe(false);
    expect(rotaAtiva("/indicadores/barbeiro/a", "/indicadores")).toBe(true);
    expect(rotaAtiva("/financeiro", "/financeiro?area=pessoal")).toBe(true);
  });
});
