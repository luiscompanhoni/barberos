import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CalendarioConteudo from "@/app/(app)/calendario-conteudo/page";
import { CalendarioConteudoTela } from "@/components/campanhas/CalendarioConteudoTela";
import { calendarioConteudo, filtrarCalendarioConteudo, zCalendarioConteudo } from "@/lib/estudio/calendario-conteudo";

const mocks = vi.hoisted(() => ({ sessao: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ GESTAO: ["DONO", "GERENTE"], sessaoAtual: mocks.sessao }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const original = readFileSync(new URL("../docs/calendario-black-novembro-2026.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const secoes = [...original.matchAll(/^## (.+)\n\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];

describe("calendário editorial estático da Black", () => {
  it("preserva 08/11 interno e todos os 22 dias de 09 a 30/11", () => {
    expect(calendarioConteudo.itens).toHaveLength(23);
    expect(calendarioConteudo.itens.map((item) => item.data)).toEqual(Array.from({ length: 23 }, (_, indice) => `2026-11-${String(indice + 8).padStart(2, "0")}`));
    expect(calendarioConteudo.itens[0].tipo).toBe("INTERNO");
    expect(calendarioConteudo.itens.filter((item) => item.tipo === "VIDEO")).toHaveLength(22);
    expect(calendarioConteudo.itens[0].textoOriginal).toContain("Sem publicação prevista");
  });

  it("mantém integralmente cada seção, sem resumir ou substituir a redação do MD", () => {
    const dias = secoes.filter((secao) => /^\d{2}\/11 — /.test(secao[1]));
    for (const [indice, secao] of dias.entries()) {
      const item = calendarioConteudo.itens[indice];
      expect(item.tema).toBe(secao[1].slice(8));
      expect(item.textoOriginal).toBe(secao[2].trim());
      if (item.tipo === "VIDEO") {
        for (const [rotulo, texto] of [["Gancho", item.gancho], ["Roteiro", item.roteiro], ["Cenas/texto", item.cenas],
          [item.legendaRotulo, item.legenda], ["CTA", item.cta], ["Stories", item.stories], ["Responsável/estado", item.responsavelEstado]]) {
          expect(texto?.length).toBeGreaterThan(5);
          expect(secao[2]).toContain(`- **${rotulo}:** ${texto}`);
        }
      }
    }
    expect(calendarioConteudo.direcaoFontes).toBe(secoes.find((secao) => secao[1] === "Direção e fontes")?.[2].trim());
    expect(calendarioConteudo.captacaoOperacao).toBe(secoes.find((secao) => secao[1] === "Captação e operação editorial")?.[2].trim());
    expect(calendarioConteudo.fechamentoEditorial).toBe(secoes.find((secao) => secao[1] === "Fechamento editorial e aprendizado")?.[2].trim());
    expect(calendarioConteudo.aviso).toBe(original.split("\n\n")[1]);
  });

  it("não transforma planejamento em publicação, agendamento ou identificação social", () => {
    expect(calendarioConteudo.estado).toBe("PLANEJAMENTO_PARA_REVISAO");
    expect(calendarioConteudo.sincronizacao).toBe("MANUAL");
    expect(calendarioConteudo.itens.every((item) => item.estado === "PREPARADO_PARA_REVISAO")).toBe(true);
    const alterado = structuredClone(calendarioConteudo);
    expect(zCalendarioConteudo.safeParse({ ...alterado, socialId: "inventado" }).success).toBe(false);
    expect(zCalendarioConteudo.safeParse({ ...alterado, itens: alterado.itens.map((item) => ({ ...item, estado: "PUBLICADO" })) }).success).toBe(false);
    expect(zCalendarioConteudo.safeParse({ ...alterado, itens: alterado.itens.map((item) => ({ ...item, estado: "AGENDADO" })) }).success).toBe(false);
  });

  it("mantém indicação bloqueada e dependências específicas visíveis", () => {
    const indicacao = calendarioConteudo.itens.filter((item) => item.dependenciaIndicacao);
    expect(indicacao.map((item) => item.data)).toEqual(["2026-11-16", "2026-11-24"]);
    expect(indicacao.every((item) => item.condicional && item.bloqueadoDivulgacao && item.responsavelEstado?.includes("BLOQUEADO"))).toBe(true);
    expect(zCalendarioConteudo.safeParse({ ...calendarioConteudo,
      itens: calendarioConteudo.itens.map((item) => item.dependenciaIndicacao ? { ...item, bloqueadoDivulgacao: false } : item) }).success).toBe(false);
    expect(calendarioConteudo.itens.find((item) => item.data === "2026-11-21")?.bloqueadoDivulgacao).toBe(true);
  });

  it("rejeita roteiros incompletos e buracos de cobertura", () => {
    expect(zCalendarioConteudo.safeParse({ ...calendarioConteudo, itens: calendarioConteudo.itens.slice(1) }).success).toBe(false);
    const incompleto = structuredClone(calendarioConteudo); incompleto.itens[1].roteiro = null;
    expect(zCalendarioConteudo.safeParse(incompleto).success).toBe(false);
    const repetido = structuredClone(calendarioConteudo); repetido.itens[2].data = repetido.itens[1].data;
    expect(zCalendarioConteudo.safeParse(repetido).success).toBe(false);
  });

  it("combina filtros de data, tema e condição sem alterar a fonte", () => {
    expect(filtrarCalendarioConteudo(calendarioConteudo.itens, { data: "2026-11-16", tema: "INDICAÇÃO", condicional: "sim" }).map((item) => item.data)).toEqual(["2026-11-16"]);
    expect(filtrarCalendarioConteudo(calendarioConteudo.itens, { data: "2026-11-16", tema: "", condicional: "nao" })).toEqual([]);
    expect(filtrarCalendarioConteudo(calendarioConteudo.itens, { data: "", tema: "avulso", condicional: "todos" }).map((item) => item.data)).toEqual(["2026-11-22"]);
    expect(calendarioConteudo.itens).toHaveLength(23);
  });

  it("renderiza detalhes integrais, filtros e aviso de sincronização manual sem ações sociais", () => {
    const html = renderToStaticMarkup(createElement(CalendarioConteudoTela));
    expect(html).toContain("Sincronização manual");
    expect(html).toContain("não há integração com redes sociais");
    expect(html).toContain("bloqueadas para divulgação");
    expect(html.match(/<details/g)).toHaveLength(24);
    expect(html).toContain("Roteiro integral"); expect(html).toContain("Responsável/estado original");
    expect(html).not.toContain("<button"); expect(html).not.toContain("<form");
  });
});

describe("acesso do calendário", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.redirect.mockImplementation(() => { throw new Error("redirecionado"); }); });
  it.each([null, { papel: "RECEPCAO" }, { papel: "LIDER" }, { papel: "CLIENTE" }])("bloqueia fora de GESTAO: %s", async (sessao) => {
    mocks.sessao.mockResolvedValue(sessao);
    await expect(CalendarioConteudo()).rejects.toThrow("redirecionado");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });
  it.each(["DONO", "GERENTE"])("permite %s", async (papel) => {
    mocks.sessao.mockResolvedValue({ papel });
    const pagina = await CalendarioConteudo();
    expect(pagina.type).toBe(CalendarioConteudoTela);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
