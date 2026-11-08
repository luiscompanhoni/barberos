import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ exigir: vi.fn(), pode: vi.fn(), relatorio: vi.fn() }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirSessaoCom: m.exigir, pode: m.pode }));
vi.mock("@/lib/agenda/carregar", () => ({ configuracao: async () => ({ fuso: "America/Sao_Paulo" }) }));
vi.mock("@/lib/rh/comissoes", () => ({ relatorioComissoes: m.relatorio }));
import { GET } from "@/app/api/rh/comissoes/relatorio/route";
beforeEach(() => {
  vi.clearAllMocks();
  m.exigir.mockResolvedValue({ usuarioId: "fixture", papel: "GERENTE" });
  m.relatorio.mockResolvedValue({ total: 2000, barbeiros: [{ barbeiroId: "fixture", total: 2000, folha: { salario: 300000, bonus: 100, descontos: 50, totalAPagar: 302050, memoria: { lancamentos: ["salário confidencial"] } } }] });
});
it("permissão só de comissão não transmite salário, vales ou memória da folha", async () => {
  m.pode.mockResolvedValue(false);
  const r = await GET(new Request("http://localhost/api/rh/comissoes/relatorio?inicio=2026-11-01&fim=2026-11-30"));
  const b = await r.json();
  expect(r.status).toBe(200); expect(b.barbeiros[0]).toMatchObject({ total: 2000, folha: null });
  expect(JSON.stringify(b)).not.toMatch(/salario|salário confidencial|descontos|memoria/);
});
it("mantém a memória e o total para quem também pode consultar a folha", async () => {
  m.pode.mockResolvedValue(true);
  const b = await (await GET(new Request("http://localhost/api/rh/comissoes/relatorio"))).json();
  expect(b.barbeiros[0].folha.salario).toBe(300000); expect(b.incluiFolha).toBe(true);
});
