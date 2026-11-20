import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModalResultado } from "@/components/jogos/kit/ModalResultado";
import type { JogadaCliente, PremioCliente } from "@/lib/jogos/tipos";
import type { JogoPremio } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ saiu: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { premioGanho: { groupBy: m.saiu } } }));
import { premiosExibiveis } from "@/lib/jogos/motor";
const premio = (id: string, extra: object = {}) => ({ id, ativo: true, chanceBps: 5000, estoque: null, limiteMensal: null, ...extra }) as JogoPremio;
beforeEach(() => { vi.clearAllMocks(); m.saiu.mockResolvedValue([]); });
describe("vitrine de prêmios possíveis", () => {
  it("exibe somente prêmios sorteáveis, inclusive em configuração antiga com chance zero", async () => {
    const ps = [premio("real"), premio("impossivel", { chanceBps: 0 }), premio("esgotado", { estoque: 0 }), premio("inativo", { ativo: false }), premio("limitado", { limiteMensal: 2 })];
    m.saiu.mockResolvedValue([{ premioId: "limitado", _count: 2 }]);
    expect((await premiosExibiveis(ps)).map(p => p.id)).toEqual(["real"]);
  });
  it("preserva prêmio que ainda tem estoque e quota", async () => {
    m.saiu.mockResolvedValue([{ premioId: "a", _count: 1 }]);
    expect(await premiosExibiveis([premio("a", { estoque: 1, limiteMensal: 2 })])).toHaveLength(1);
  });
  it("não consulta contagem sem prêmios", async () => {
    expect(await premiosExibiveis([])).toEqual([]); expect(m.saiu).not.toHaveBeenCalled();
  });
});

describe("resultado público da campanha", () => {
  const premio: PremioCliente = { id: "premio-1", jogoId: "jogo", codigo: "BB-1", tipo: "BRINDE", rotulo: "Brinde",
    icone: "presente", valorCentavos: 0, percentual: 0, raridade: "COMUM", status: "DISPONIVEL",
    expiraEm: null, criadoEm: "2026-01-01", utilizadoEm: null, agendamento: null };
  function resultado(p: PremioCliente) {
    const jogada: JogadaCliente = { id: "j", jogoId: "jogo", tipo: "CAIXA", vitoria: true, multiplicador: 100, premios: [p],
      resultado: { tipo: "CAIXA", quantidade: 1 }, revelada: true, criadoEm: "2026-01-01" };
    return renderToStaticMarkup(createElement(ModalResultado, { jogada, campanha: true, aoFechar: () => {} }));
  }
  it("agendar para utilizar leva o prêmio disponível através do login", () => {
    expect(resultado(premio)).toContain('href="/c/agendar?premio=premio-1"');
  });
  it.each<Partial<PremioCliente>>([{ status: "RESERVADO" }, { status: "UTILIZADO" }, { status: "CANCELADO" },
    { expiraEm: "2000-01-01" }, { tipo: "CREDITO" }])("prêmio indisponível ou crédito deixa o agendamento comum", dados => {
    expect(resultado({ ...premio, ...dados })).toContain('href="/c/agendar"');
  });
});
