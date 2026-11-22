import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CampanhaDetalhe } from "@/components/campanhas/CampanhaDetalhe";
import { MODELOS_SEGMENTOS } from "@/lib/campanhas/modelos-segmento";
import { SEGMENTOS } from "@/lib/campanhas/regras";
import { POST } from "@/app/api/campanhas/route";
import { PATCH } from "@/app/api/campanhas/[id]/route";
import { proibido } from "@/lib/erros";

const m = vi.hoisted(() => ({ sessao: vi.fn(), preparar: vi.fn(), editar: vi.fn(), criar: vi.fn(), lote: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ GESTAO: ["DONO", "GERENTE"], exigirSessao: m.sessao }));
vi.mock("@/lib/campanhas/servico", () => ({ prepararCampanhasPorSegmento: m.preparar, editarCampanha: m.editar, criarCampanha: m.criar, liberarLote: m.lote }));
vi.mock("@/lib/jogos/motor", () => ({}));

const req = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/api/campanhas", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  m.sessao.mockResolvedValue({ usuarioId: "dono-teste", papel: "DONO" });
  m.preparar.mockResolvedValue({ criadas: 16 });
});

describe("campanhas dos cards", () => {
  it("oferece um rascunho distinto, com nome e link, para cada segmento atual", () => {
    expect(MODELOS_SEGMENTOS.map(m => m.chave)).toEqual(SEGMENTOS.map(s => s.chave));
    expect(new Set(MODELOS_SEGMENTOS.map(m => m.mensagem)).size).toBe(16);
    expect(new Set(MODELOS_SEGMENTOS.map(m => m.id)).size).toBe(16);
    for (const modelo of MODELOS_SEGMENTOS) expect(modelo.mensagem).toContain("{link}");
  });

  it("mostra critérios e prévia no detalhe, com ativação bloqueada", () => {
    const modelo = MODELOS_SEGMENTOS[0];
    const html = renderToStaticMarkup(createElement(CampanhaDetalhe, {
      modelo, segmentos: [{ chave: modelo.chave, rotulo: modelo.rotulo, total: 8, podemReceber: 5 }],
      jogos: [], enviosBloqueados: true, onAlterar: async () => {}, onFechar: () => {},
    }));
    expect(html).toContain(modelo.objetivo);
    expect(html).toContain("Prévia da mensagem");
    expect(html).not.toContain("responda PARAR");
    expect(html).toContain("Envios de campanhas bloqueados");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Ativar campanha<\/button>/);
    expect(html).not.toContain("Confirmar envio do lote");
  });

  it("permite preparar somente o lote conferido mesmo com a campanha pausada", () => {
    const modelo = MODELOS_SEGMENTOS[0];
    const html = renderToStaticMarkup(createElement(CampanhaDetalhe, {
      modelo, segmentos: [{ chave: modelo.chave, rotulo: modelo.rotulo, total: 120, podemReceber: 110 }],
      campanha: { ...modelo, segmentos: [modelo.chave], status: "PAUSADA", jogo: null, criadoEm: "", criadoPor: null,
        fila: 0, enviados: 0, falhas: 0, pulados: 0, enviadosHoje: 0, marcaram: 0, pararam: 0, elegiveis: 110, loteAutorizado: 10 },
      jogos: [], enviosBloqueados: true, onAlterar: async () => {}, onFechar: () => {},
    }));
    expect(html).toContain("10 contatos conferidos");
    expect(html).toMatch(/<button[^>]*class="btn-primario"[^>]*>Preparar envio do lote<\/button>/);
    expect(html).not.toContain("Tamanho do próximo lote");
    expect(html).not.toContain("Ativar campanha");
  });

  it("prepara pela gestão sem chamar criação ativa ou liberação de lote", async () => {
    const resposta = await POST(req({ acao: "preparar_segmentos" }));
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ criadas: 16 });
    expect(m.sessao).toHaveBeenCalledWith(["DONO", "GERENTE"]);
    expect(m.preparar).toHaveBeenCalledWith({ usuarioId: "dono-teste", papel: "DONO" });
    expect(m.criar).not.toHaveBeenCalled();
    expect(m.lote).not.toHaveBeenCalled();
  });

  it("recusa origem externa e sessão sem permissão antes de preparar", async () => {
    expect((await POST(req({ acao: "preparar_segmentos" }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    m.sessao.mockRejectedValue(proibido());
    expect((await POST(req({ acao: "preparar_segmentos" }))).status).toBe(403);
    expect(m.preparar).not.toHaveBeenCalled();
  });

  it("limita alterações aos campos da edição", async () => {
    m.editar.mockResolvedValue({ id: "campanha-segmento-quente" });
    const ctx = { params: Promise.resolve({ id: "campanha-segmento-quente" }) };
    const campanha = { nome: "Agenda de retorno", segmentos: ["quente"], mensagem: "Veja a agenda: {link}", limiteDiario: 10, taxaRespostaBps: 2000 };
    expect((await PATCH(req({ acao: "editar", campanha: { ...campanha, status: "ATIVA" } }), ctx)).status).toBe(200);
    expect(m.editar).toHaveBeenCalledWith({ usuarioId: "dono-teste", papel: "DONO" }, "campanha-segmento-quente", { ...campanha, jogoId: null });
  });
});
