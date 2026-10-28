import { describe, expect, it } from "vitest";
import { chaveAviso, descontoReativacao, diasDecorridos, podeRecomendar } from "@/lib/recompras/regras";
import { schemaConfig } from "@/lib/recompras/schemas";

const politica = { descontoAtivo: true, descontoPct: 20, descontoMaxCentavos: 1000, descontoValidadeDias: 7, reativacaoDias: 30, margemMinimaPct: 20 };
const regra = { avulsoTipo: "PERCENTUAL" as const, avulsoValor: 4000, planoTipo: "FIXO" as const, planoValor: 1500 };
const base = { politica, preco: 5000, custo: 1000, regra, adicionalBps: 0, diasSemVisita: 35, cobertoPlano: false };

describe("ciclo de recompra", () => {
  it("considera o dia da barbearia, não meia-noite UTC", () => {
    expect(diasDecorridos(new Date("2026-10-01T01:30:00Z"), "2026-10-10", "America/Sao_Paulo")).toBe(10);
    expect(() => diasDecorridos(new Date(), "2026-02-30", "America/Sao_Paulo")).toThrow();
  });
  it("não oferece antes do prazo ou quando o serviço já está marcado", () => {
    expect(podeRecomendar({ dias: 9, intervalo: 10, agendado: false, agora: 100 })).toBe(false);
    expect(podeRecomendar({ dias: 10, intervalo: 10, agendado: false, agora: 100 })).toBe(true);
    expect(podeRecomendar({ dias: 12, intervalo: 10, agendado: true, agora: 100 })).toBe(false);
  });
  it("respeita recusa, conversão e adiamento", () => {
    const p = { dias: 12, intervalo: 10, agendado: false, agora: 100 };
    expect(podeRecomendar({ ...p, estado: "RECUSOU" })).toBe(false);
    expect(podeRecomendar({ ...p, estado: "ACEITOU" })).toBe(false);
    expect(podeRecomendar({ ...p, estado: "LEMBRAR", lembrarEm: new Date(101) })).toBe(false);
    expect(podeRecomendar({ ...p, estado: "LEMBRAR", lembrarEm: new Date(100) })).toBe(true);
  });
  it("deduplica o mesmo conjunto de serviços independente da ordem", () => {
    const ciclos = [{ servicoId: "a", ultimaEm: "1" }, { servicoId: "b", ultimaEm: "2" }];
    expect(chaveAviso("cliente", ciclos, 1)).toBe(chaveAviso("cliente", [...ciclos].reverse(), 1));
    expect(chaveAviso("cliente", ciclos, 2)).not.toBe(chaveAviso("cliente", ciclos, 1));
  });
});

describe("desconto de reativação", () => {
  it("respeita teto em centavos e margem depois da comissão", () => {
    expect(descontoReativacao(base)).toBe(1000);
    expect(descontoReativacao({ ...base, politica: { ...politica, descontoMaxCentavos: 500 } })).toBe(500);
    expect(descontoReativacao({ ...base, custo: 3000 })).toBe(0);
  });
  it("não presume custo ou comissão quando faltam dados", () => {
    expect(descontoReativacao({ ...base, custo: null })).toBe(0);
    expect(descontoReativacao({ ...base, regra: null })).toBe(0);
    expect(descontoReativacao({ ...base, custo: 0 })).toBe(1000);
  });
  it("não concede sem autorização, fora do público, vencida ou incluída no plano", () => {
    expect(descontoReativacao({ ...base, politica: { ...politica, descontoAtivo: false } })).toBe(0);
    expect(descontoReativacao({ ...base, diasSemVisita: 29 })).toBe(0);
    expect(descontoReativacao({ ...base, expirou: true })).toBe(0);
    expect(descontoReativacao({ ...base, cobertoPlano: true })).toBe(0);
  });
  it("considera comissão fixa e adicional vigente", () => {
    expect(descontoReativacao({ ...base, adicionalBps: 4000 })).toBe(0);
    expect(descontoReativacao({ ...base, regra: { ...regra, avulsoTipo: "FIXO", avulsoValor: 3000 } })).toBe(0);
  });
  it("bloqueia configuração ativa sem teto definido e serviços duplicados", () => {
    const cfg = { ...politica, ativo: true, whatsapp: false, intervaloContatoDias: 7, servicos: [] };
    expect(schemaConfig.safeParse(cfg).success).toBe(true);
    expect(schemaConfig.safeParse({ ...cfg, descontoMaxCentavos: 0 }).success).toBe(false);
    const servico = { id: "corte", custoCentavos: 0, intervaloRecompraDias: 10 };
    expect(schemaConfig.safeParse({ ...cfg, servicos: [servico, servico] }).success).toBe(false);
  });
});
