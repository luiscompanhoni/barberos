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
