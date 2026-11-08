import { beforeEach, describe, expect, it, vi } from "vitest";
import { calcularAssinaturas, type Adicional } from "@/lib/rh/regras";
import { regrasExtrasVigentes } from "@/lib/rh/vigencia-regras";

const { salvar } = vi.hoisted(() => ({ salvar: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/auth/permissoes", () => ({ exigirSessaoCom: vi.fn(async () => ({ usuarioId: "dono" })) }));
vi.mock("@/lib/rh/pote", () => ({ salvarExtras: salvar, configExtras: vi.fn() }));
import { PUT } from "@/app/api/rh/comissoes/extras/route";

const cfg = { percentualBps: 3500, creditos: { corte: 40, barba: 20 }, arredondamento: "MAIORES_RESTOS_V1" as const };
const at = (barbeiroId: string, servicoId = "corte", dia = "2026-11-01") => ({ barbeiroId, servicoId, dia });
const tres = [at("b1"), at("b2"), at("b3")];
const receita = (recebidoCentavos: number, estornosCentavos = 0) => ({ recebidoCentavos, estornosCentavos });
const adicional = (barbeiroId: string, pontosBps: number, inicio = "2026-11-01", fim: string | null = null): Adicional => ({ barbeiroId, modalidade: "ASSINATURA", pontosBps, inicio, fim });
const valores = (r: ReturnType<typeof calcularAssinaturas>) => r.barbeiros.map(b => b.comissao);

describe("rateio versionado das assinaturas", () => {
  it("preserva o método ausente/LEGADO e evidencia o centavo excedente sem reescrever a regra antiga", () => {
    const ausente = calcularAssinaturas({ percentualBps: 3500, creditos: cfg.creditos }, receita(10000), tres);
    const legado = calcularAssinaturas({ ...cfg, arredondamento: "LEGADO" }, receita(10000), tres);
    expect(ausente).toEqual(legado);
    expect(valores(legado)).toEqual([1167, 1167, 1167]);
    expect(legado.conciliacao).toMatchObject({ metodo: "LEGADO", status: "REVISAO", pendente: true, poteBaseAlvoCentavos: 3500, poteBaseSomaCentavos: 3501, poteBaseResiduoCentavos: -1 });
  });

  it.each([[10000, [1167, 1167, 1166]], [20000, [2334, 2333, 2333]]] as const)("distribui todo o pote em %i centavos, com sobra ou excesso individual anterior", (d, esperado) => {
    const r = calcularAssinaturas(cfg, receita(d), tres);
    expect(valores(r)).toEqual(esperado);
    expect(r.conciliacao).toMatchObject({ status: "OK", pendente: false, poteBaseResiduoCentavos: 0, totalFinalDiferencaCentavos: 0 });
    expect(r.conciliacao.detalhes.filter(x => x.baseCentavoResidual).map(x => x.barbeiroId)).toEqual(d === 10000 ? ["b1", "b2"] : ["b1"]);
  });

  it("preserva o exemplo aprovado de 35/25/20/20 sobre R$ 10.000", () => {
    const atendimentos = [35, 25, 20, 20].flatMap((qtd, i) => Array.from({ length: qtd }, () => at(`b${i + 1}`)));
    const r = calcularAssinaturas(cfg, receita(1000000), atendimentos);
    expect(valores(r)).toEqual([122500, 87500, 70000, 70000]);
    expect(r.conciliacao.poteBaseSomaCentavos).toBe(350000);
  });

  it("respeita os pesos mistos sem arredondar o valor do crédito antes do rateio", () => {
    const r = calcularAssinaturas(cfg, receita(10000), [at("b1"), at("b1"), at("b2"), at("b3"), at("b4", "barba")]);
    expect(r.creditosTotal).toBe(180);
    expect(valores(r)).toEqual([1555, 778, 778, 389]);
    expect(r.conciliacao.poteBaseResiduoCentavos).toBe(0);
  });

  it("desempata pelo ID fixo da cadeira e independe da ordem dos atendimentos/adicionais", () => {
    const adicionais = [adicional("b1", 500), adicional("b2", 500), adicional("b3", 500)];
    const normal = calcularAssinaturas(cfg, receita(10000), tres, adicionais);
    const invertido = calcularAssinaturas(cfg, receita(10000), [...tres].reverse(), [...adicionais].reverse());
    expect(invertido).toEqual(normal);
    expect(normal.conciliacao.ordemDesempate).toEqual(["b1", "b2", "b3"]);
    expect(normal.conciliacao.criterioDesempate).toContain("LEXICOGRAFICO_ASC_V1");
    expect(valores(normal)).toEqual([1334, 1333, 1333]);
  });

  it("distingue valor não rateado de resíduo e não bloqueia falta de fundos sem atividade", () => {
    for (const entradas of [[], [at("b1", "sem-credito")]]) {
      const r = calcularAssinaturas(cfg, receita(10000), entradas);
      expect(r.barbeiros).toEqual([]);
      expect(r.conciliacao).toMatchObject({ status: "SEM_ELEGIVEIS", pendente: true, naoRateadoCentavos: 3500, poteBaseSomaCentavos: 0, poteBaseResiduoCentavos: 0 });
      expect(calcularAssinaturas(cfg, receita(0), entradas).conciliacao.pendente).toBe(false);
      expect(calcularAssinaturas({ ...cfg, percentualBps: 0 }, receita(10000), entradas).conciliacao).toMatchObject({ status: "SEM_ELEGIVEIS", pendente: false, naoRateadoCentavos: 0 });
    }
  });

  it("zera a base após estornos, sem comissões negativas nem divisão por zero", () => {
    const r = calcularAssinaturas(cfg, receita(5000, 9000), tres, [adicional("b1", -10000), adicional("b2", 10000)]);
    expect(valores(r)).toEqual([0, 0, 0]);
    expect(r.conciliacao).toMatchObject({ pendente: false, totalFinalAlvoCentavos: 0, totalFinalSomaCentavos: 0 });
  });

  it("não retira centavos de quem não recebeu adicional", () => {
    const base = calcularAssinaturas(cfg, receita(10000), tres);
    const r = calcularAssinaturas(cfg, receita(10000), tres, [adicional("b1", 500)]);
    expect(valores(r)).toEqual([1334, 1167, 1166]);
    expect(r.barbeiros.slice(1)).toEqual(base.barbeiros.slice(1));
    expect(r.conciliacao.totalFinalDiferencaCentavos).toBe(0);
  });

  it.each([
    { d: 15, atendimentos: [at("b1"), at("b2")], adicionais: [adicional("b1", 500)], bases: [3, 2], alvo: 6 },
    { d: 10000, atendimentos: tres, adicionais: [adicional("b3", -3500)], bases: [1167, 1167, 1166], alvo: 2333 },
  ])("bloqueia a prévia base quando quotas, sinal e terceiros não admitem o alvo em $d centavos", c => {
    const r = calcularAssinaturas(cfg, receita(c.d), c.atendimentos, c.adicionais);
    expect(valores(r)).toEqual(c.bases);
    expect(r.barbeiros.every(b => b.adicionalCentavos === 0)).toBe(true);
    expect(r.conciliacao).toMatchObject({ status: "REVISAO", pendente: true, totalFinalAlvoCentavos: c.alvo });
    expect(r.conciliacao.motivos.join(" ")).toContain("somente o pote base");
    expect(r.conciliacao.motivos.join(" ")).toContain("Nenhuma diferença foi absorvida");
  });

  it("rateia quotas finais a 100% sem conservar deltas legados excessivos nem extrapolar tetos individuais", () => {
    const r = calcularAssinaturas(cfg, receita(20000), tres, tres.map(a => adicional(a.barbeiroId, 6500)));
    expect(valores(r)).toEqual([6667, 6667, 6666]);
    expect(r.barbeiros.reduce((s, b) => s + b.adicionalCentavos, 0)).toBe(13000);
    expect(r.conciliacao).toMatchObject({ pendente: false, totalFinalSomaCentavos: 20000, totalFinalDiferencaCentavos: 0 });
    expect(r.conciliacao.detalhes.every(x => x.finalPisoCentavos === 6666 && x.finalTetoCentavos === 6667)).toBe(true);
  });

  it("usa os limites efetivos por atendimento mesmo quando os pontos brutos se anulam", () => {
    const r = calcularAssinaturas(cfg, receita(10000), [at("b1"), at("b1", "corte", "2026-11-02")],
      [adicional("b1", 10000, "2026-11-01", "2026-11-01"), adicional("b1", -10000, "2026-11-02", "2026-11-02")]);
    expect(r.barbeiros[0]).toMatchObject({ comissaoBase: 3500, adicionalBps: 0, adicionalCentavos: 1500, comissao: 5000 });
    expect(r.conciliacao.detalhes[0].ajusteEfetivo).toBe(true);
  });

  it("fixa o adicional efetivo líquido zero na baseMR e respeita início/fim inclusivos", () => {
    const r = calcularAssinaturas(cfg, receita(10000), [at("b1"), at("b1", "corte", "2026-11-02")],
      [adicional("b1", 500, "2026-11-01", "2026-11-01"), adicional("b1", -500, "2026-11-02", "2026-11-02")]);
    expect(r.barbeiros[0]).toMatchObject({ comissaoBase: 3500, adicionalCentavos: 0, comissao: 3500 });
    expect(r.conciliacao).toMatchObject({ pendente: false, totalFinalAlvoCentavos: 3500 });
    const comOutros = calcularAssinaturas(cfg, receita(10000), [at("b1"), at("b1", "corte", "2026-11-02"), at("b2"), at("b3")],
      [adicional("b1", 3500, "2026-11-01", "2026-11-01"), adicional("b1", -3500, "2026-11-02", "2026-11-02"), adicional("b2", 500)]);
    expect(comOutros.barbeiros[0]).toMatchObject({ comissaoBase: 1750, comissao: 1750, adicionalCentavos: 0 });
    expect(comOutros.conciliacao.detalhes[0].ajusteEfetivo).toBe(false);
    expect(valores(comOutros)).toEqual([1750, 1000, 875]);
  });

  it("mantém um centavo mínimo inteiro e permite final positivo só quando o adicional o justifica", () => {
    expect(valores(calcularAssinaturas(cfg, receita(1), tres))).toEqual([0, 0, 0]);
    const r = calcularAssinaturas(cfg, receita(1), tres, tres.map(a => adicional(a.barbeiroId, 6500)));
    expect(valores(r)).toEqual([1, 0, 0]);
    expect(r.conciliacao).toMatchObject({ poteBaseAlvoCentavos: 0, totalFinalAlvoCentavos: 1, pendente: false });
  });

  it("não perde precisão em produtos intermediários grandes e serializa a evidência em JSON", () => {
    const r = calcularAssinaturas(cfg, receita(Number.MAX_SAFE_INTEGER), tres);
    expect(r.conciliacao.poteBaseAlvoCentavos).toBe(Number((BigInt(Number.MAX_SAFE_INTEGER) * BigInt(3500) * BigInt(2) + BigInt(10000)) / BigInt(20000)));
    expect(r.conciliacao.poteBaseResiduoCentavos).toBe(0);
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(() => calcularAssinaturas(cfg, receita(0.5), tres)).toThrow("inteiros seguros");
  });

  it("verifica limites, sinal e conservação em combinações pequenas de positivos, negativos e caps", () => {
    for (let d = 0; d <= 20; d++) for (const percentualBps of [0, 3500, 10000]) {
      for (const p1 of [-10000, -3500, 0, 500, 6500, 10000]) for (const p2 of [-10000, -3500, 0, 500, 6500, 10000]) {
        const r = calcularAssinaturas({ ...cfg, percentualBps }, receita(d), [at("b1"), at("b2")], [adicional("b1", p1), adicional("b2", p2)]);
        expect(r.conciliacao.poteBaseResiduoCentavos).toBe(0);
        expect(r.barbeiros.every(b => Number.isSafeInteger(b.comissao) && b.comissao >= 0)).toBe(true);
        if (r.conciliacao.pendente) continue;
        expect(r.conciliacao.totalFinalDiferencaCentavos).toBe(0);
        expect(r.conciliacao.totalFinalSomaCentavos).toBeLessThanOrEqual(d);
        r.barbeiros.forEach((b, i) => {
          const pontos = i ? p2 : p1;
          const efetivo = Math.min(10000, Math.max(0, percentualBps + pontos));
          if (efetivo === percentualBps) expect(b.comissao).toBe(b.comissaoBase);
          else {
            const detalhe = r.conciliacao.detalhes[i];
            expect(b.comissao).toBeGreaterThanOrEqual(detalhe.finalPisoCentavos);
            expect(b.comissao).toBeLessThanOrEqual(detalhe.finalTetoCentavos);
            expect(efetivo > percentualBps ? b.adicionalCentavos >= 0 : b.adicionalCentavos <= 0).toBe(true);
          }
        });
      }
    }
  });
});

describe("validação e vigência explícita do método", () => {
  const extras = { assinaturas: { ativo: true, percentualBps: 3500, creditos: { corte: 40 } }, faixas: [] };
  beforeEach(() => salvar.mockClear());
  it("versões históricas ausentes mantêm LEGADO e enums desconhecidos são recusados", () => {
    expect(regrasExtrasVigentes(extras).assinaturas.arredondamento).toBe("LEGADO");
    expect(regrasExtrasVigentes({ ...extras, assinaturas: { ...extras.assinaturas, arredondamento: "MAIORES_RESTOS_V1" } }).assinaturas.arredondamento).toBe("MAIORES_RESTOS_V1");
    expect(() => regrasExtrasVigentes({ ...extras, assinaturas: { ...extras.assinaturas, arredondamento: "INVALIDO" } })).toThrow("dados inválidos");
  });

  const body = { competencia: "2027-01", revisao: "a".repeat(64), assinaturas: { ativo: true, percentualBps: 3500, arredondamento: "MAIORES_RESTOS_V1", creditos: [{ servicoId: "corte", creditos: 40 }] }, faixas: [] };
  const put = (v: unknown) => PUT(new Request("http://localhost/api/rh/comissoes/extras", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(v) }));
  it("exige enum, competência e revisão explícitos na rota antes de salvar", async () => {
    for (const invalido of [
      { ...body, assinaturas: { ...body.assinaturas, arredondamento: "INVALIDO" } },
      { ...body, assinaturas: { ...body.assinaturas, arredondamento: undefined } },
      { ...body, competencia: undefined }, { ...body, revisao: undefined },
    ]) expect((await put(invalido)).status).toBe(400);
    expect(salvar).not.toHaveBeenCalled();
    expect((await put(body)).status).toBe(200);
    expect(salvar).toHaveBeenCalledWith({ usuarioId: "dono" }, body);
  });
});
