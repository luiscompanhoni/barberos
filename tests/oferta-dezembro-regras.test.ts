import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CRONOGRAMA_DEZEMBRO, TERMO_DEZEMBRO, adesaoNoPeriodo, calcularMultaSimulada,
  dentroDoPeriodoGratis, motivoInelegibilidade, avaliarLimiteDezembro, erroUsarOfertaDezembro,
} from "@/lib/oferta-dezembro/regras";
import { schemaAdesaoDezembro } from "@/lib/oferta-dezembro/schemas";
import { lerConfigOfertaDezembro, ofertaDezembroEmHomologacao, planoBaseDezembroEmHomologacao } from "@/lib/oferta-dezembro/config";

const em = (iso: string) => new Date(iso);
const aderiu = em("2026-11-22T21:00:00-03:00");
afterEach(() => vi.unstubAllEnvs());

describe("calendário da oferta de dezembro", () => {
  it("separa pré-adesão, benefício e as seis competências pagas", () => {
    expect(adesaoNoPeriodo(em("2026-11-22T02:59:59.999Z"))).toBe(false);
    expect(adesaoNoPeriodo(em("2026-11-22T03:00:00Z"))).toBe(true);
    expect(dentroDoPeriodoGratis(em("2026-12-01T02:59:59.999Z"))).toBe(false);
    expect(dentroDoPeriodoGratis(em("2026-12-01T03:00:00Z"))).toBe(true);
    expect(dentroDoPeriodoGratis(em("2027-01-01T02:59:59.999Z"))).toBe(true);
    expect(dentroDoPeriodoGratis(em("2027-01-01T03:00:00Z"))).toBe(false);
    expect(adesaoNoPeriodo(em("2027-01-01T03:00:00Z"))).toBe(false);
    expect(CRONOGRAMA_DEZEMBRO.competencias).toEqual([
      "2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01", "2027-05-01", "2027-06-01",
    ]);
    expect(CRONOGRAMA_DEZEMBRO.fimFidelidade).toBe("2027-07-01");
  });

  it("zera no arrependimento, proporcionaliza meses completos e limita ao mês dispensado", () => {
    const multa = (quando: string) => calcularMultaSimulada(10001, aderiu, em(quando));
    expect(multa("2026-11-29T21:00:00-03:00")).toBe(0);
    expect(multa("2026-12-19T00:00:00-03:00")).toBe(10001);
    expect(multa("2027-02-01T02:59:59.999Z")).toBe(10001);
    expect(multa("2027-02-01T03:00:00Z")).toBe(8334);
    expect(multa("2027-04-01T03:00:00Z")).toBe(5000);
    expect(multa("2027-07-01T03:00:00Z")).toBe(0);
  });
});

describe("adesão", () => {
  it("rejeita recorrência aberta, repetição e cancelamento até 90 dias antes", () => {
    const base = { jaAderiu: false, assinaturaAberta: false, cancelamentoRecente: false };
    expect(motivoInelegibilidade(base)).toBeNull();
    expect(motivoInelegibilidade({ ...base, assinaturaAberta: true })?.codigo).toBe("assinatura_existente");
    expect(motivoInelegibilidade({ ...base, jaAderiu: true })?.codigo).toBe("adesao_existente");
    expect(motivoInelegibilidade({ ...base, cancelamentoRecente: true })?.codigo).toBe("cancelamento_recente");
  });

  it("rejeita Pix, cartão fora do simulador, aceite ausente e termo divergente", () => {
    const proposta = {
      chave: "c3f44761-a857-4c36-9906-530e409f0950", forma: "CARTAO", cartaoToken: "dezembro_cartao_aprovado",
      aceitaTermos: true, termosVersao: TERMO_DEZEMBRO, planoId: "plano", precoCentavos: 10000, limiteUsos: 2,
    };
    expect(schemaAdesaoDezembro.safeParse(proposta).success).toBe(true);
    expect(schemaAdesaoDezembro.safeParse({ ...proposta, forma: "PIX" }).success).toBe(false);
    expect(schemaAdesaoDezembro.safeParse({ ...proposta, cartaoToken: "cartao_de_fora" }).success).toBe(false);
    expect(schemaAdesaoDezembro.safeParse({ ...proposta, aceitaTermos: false }).success).toBe(false);
    expect(schemaAdesaoDezembro.safeParse({ ...proposta, termosVersao: "outra" }).success).toBe(false);
    expect(schemaAdesaoDezembro.safeParse({ ...proposta, campoExtra: true }).success).toBe(false);
  });

  it("só aceita a configuração explícita, positiva e em homologação", () => {
    const env = {
      AMBIENTE: "homologacao", OFERTA_DEZEMBRO_MODO: "homologacao", OFERTA_DEZEMBRO_ATIVA: "true",
      OFERTA_DEZEMBRO_PLANO_ID: "base", OFERTA_DEZEMBRO_VAGAS: "20", OFERTA_DEZEMBRO_LIMITE_USOS: "2",
    };
    expect(lerConfigOfertaDezembro(env)).toEqual({ planoId: "base", vagas: 20, limiteUsos: 2 });
    for (const valor of [undefined, "false", "TRUE", "1"]) {
      const fechada = { ...env, OFERTA_DEZEMBRO_ATIVA: valor };
      expect(ofertaDezembroEmHomologacao(fechada)).toBe(false);
      expect(planoBaseDezembroEmHomologacao(fechada)).toBe("base");
      expect(lerConfigOfertaDezembro(fechada)).toBeNull();
    }
    expect(lerConfigOfertaDezembro({ ...env, AMBIENTE: "producao" })).toBeNull();
    expect(ofertaDezembroEmHomologacao({ ...env, OFERTA_DEZEMBRO_MODO: "" })).toBe(true);
    expect(lerConfigOfertaDezembro({ ...env, OFERTA_DEZEMBRO_MODO: "real" })).toBeNull();
    expect(lerConfigOfertaDezembro({ ...env, OFERTA_DEZEMBRO_VAGAS: "0" })).toBeNull();
    expect(lerConfigOfertaDezembro({ ...env, OFERTA_DEZEMBRO_LIMITE_USOS: "2.5" })).toBeNull();
    expect(lerConfigOfertaDezembro({ ...env, OFERTA_DEZEMBRO_PLANO_ID: undefined })).toBeNull();
  });

  it("não divulga contratos simulados pelas operações de assinaturas quando a oferta está fechada", () => {
    vi.stubEnv("AMBIENTE", "homologacao");
    vi.stubEnv("OFERTA_DEZEMBRO_ATIVA", "false");
    const erro = erroUsarOfertaDezembro();
    expect(erro).toMatchObject({ status: 404, codigo: "nao_encontrado" });
    expect(erro.message).not.toMatch(/Dezembro|homologa/i);
  });
});

describe("limite de dezembro", () => {
  it("soma serviços distintos e só conta usos de dezembro", () => {
    const usos = [
      { inicio: +em("2026-12-05T18:00:00Z"), servicoId: "corte" },
      { inicio: +em("2026-12-05T18:40:00Z"), servicoId: "barba" },
      { inicio: +em("2027-01-01T03:00:00Z"), servicoId: "corte" },
    ];
    expect(avaliarLimiteDezembro(usos, 3)).toEqual({ usados: 2, restantes: 1 });
    expect(avaliarLimiteDezembro(usos, 2)).toEqual({ usados: 2, restantes: 0 });
  });
});
