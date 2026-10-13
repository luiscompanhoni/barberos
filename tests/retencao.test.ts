import { describe, expect, it } from "vitest";
import {
  CONFIG_PADRAO, estaPausada, fimDoAcesso, motivoPorTexto, ofertaPara, opcoesDePausa, proximoAniversario,
  resumoPorMotivo, ultimoDia, ultimoVencimentoComDesconto, valorComRetencao, type Motivo,
} from "@/lib/assinaturas/retencao-regras";
import { capacidades, comoAplicar } from "@/lib/pagamentos/retencao-gateway";

const base = {
  status: "ATIVA",
  pausada: false,
  encerrando: false,
  cfg: CONFIG_PADRAO,
  cap: { pausa: true, desconto: true },
  historico: { descontoRecente: false, pausaRecente: false },
};
const oferta = (motivo: Motivo, extra: Partial<typeof base> = {}) => ofertaPara({ ...base, ...extra, motivo });

describe("oferta de retenção por motivo", () => {
  it("preço -> desconto configurado", () => {
    expect(oferta("PRECO")).toEqual({ tipo: "DESCONTO", pct: 20, meses: 2 });
  });
  it("não estou usando / viagem -> pausa 30/60", () => {
    expect(oferta("NAO_USA")).toEqual({ tipo: "PAUSA", opcoesDias: [30, 60] });
    expect(oferta("VIAGEM")).toEqual({ tipo: "PAUSA", opcoesDias: [30, 60] });
  });
  it("mudou de cidade e outro -> cancela direto", () => {
    expect(oferta("MUDANCA").tipo).toBe("NENHUMA");
    expect(oferta("OUTRO").tipo).toBe("NENHUMA");
  });
  it("insatisfeito e horários -> gerente", () => {
    expect(oferta("INSATISFEITO").tipo).toBe("GERENTE");
    expect(oferta("HORARIOS").tipo).toBe("GERENTE");
  });
  it("dono desligou -> sem oferta", () => {
    expect(oferta("PRECO", { cfg: { ...CONFIG_PADRAO, descontoAtivo: false } }).tipo).toBe("NENHUMA");
    expect(oferta("VIAGEM", { cfg: { ...CONFIG_PADRAO, pausaAtiva: false } }).tipo).toBe("NENHUMA");
  });
  it("gateway não aplica sozinho (Celcash, CashBarber) -> gerente", () => {
    expect(oferta("PRECO", { cap: { pausa: false, desconto: false } }).tipo).toBe("GERENTE");
    expect(oferta("NAO_USA", { cap: { pausa: false, desconto: false } }).tipo).toBe("GERENTE");
  });
  it("já usou há pouco -> sem oferta", () => {
    expect(oferta("PRECO", { historico: { descontoRecente: true, pausaRecente: false } }).tipo).toBe("NENHUMA");
    expect(oferta("VIAGEM", { historico: { descontoRecente: false, pausaRecente: true } }).tipo).toBe("NENHUMA");
  });
  it("só plano ativo e em dia ganha desconto/pausa", () => {
    expect(oferta("PRECO", { status: "ATRASADA" }).tipo).toBe("NENHUMA");
    expect(oferta("VIAGEM", { pausada: true }).tipo).toBe("NENHUMA");
    expect(oferta("INSATISFEITO", { status: "PENDENTE" }).tipo).toBe("NENHUMA");
    expect(oferta("INSATISFEITO", { encerrando: true }).tipo).toBe("NENHUMA");
  });
});

describe("opções de pausa", () => {
  it("até o máximo do dono", () => {
    expect(opcoesDePausa(60)).toEqual([30, 60]);
    expect(opcoesDePausa(90)).toEqual([30, 60, 90]);
    expect(opcoesDePausa(45)).toEqual([30]);
    expect(opcoesDePausa(15)).toEqual([15]);
    expect(opcoesDePausa(0)).toEqual([]);
  });
});

describe("até quando vale depois de cancelar", () => {
  const hoje = "2026-10-09";
  it("ativa com mês pago: até o próximo vencimento", () => {
    expect(fimDoAcesso({ status: "ATIVA", proximoVencimento: "2026-10-25", criadaEm: "2026-01-25", cashbarber: false, hoje })).toBe("2026-10-25");
    expect(ultimoDia("2026-10-25")).toBe("2026-10-24");
  });
  it("pendente, atrasada ou vencimento hoje: na hora", () => {
    expect(fimDoAcesso({ status: "PENDENTE", proximoVencimento: null, criadaEm: hoje, cashbarber: false, hoje })).toBeNull();
    expect(fimDoAcesso({ status: "ATRASADA", proximoVencimento: "2026-10-25", criadaEm: hoje, cashbarber: false, hoje })).toBeNull();
    expect(fimDoAcesso({ status: "ATIVA", proximoVencimento: hoje, criadaEm: hoje, cashbarber: false, hoje })).toBeNull();
  });
  it("CashBarber: estima pelo dia da adesão", () => {
    expect(fimDoAcesso({ status: "ATIVA", proximoVencimento: null, criadaEm: "2026-03-15", cashbarber: true, hoje })).toBe("2026-10-15");
    expect(proximoAniversario("2026-01-31", "2026-10-09")).toBe("2026-10-31");
    expect(proximoAniversario("2026-01-09", "2026-10-09")).toBe("2026-11-09");
  });
});

describe("pausa e desconto", () => {
  it("pausada só até a data e enquanto não reativada", () => {
    expect(estaPausada({ pausadaEm: new Date(), pausadaAte: "2026-11-08", hoje: "2026-10-09" })).toBe(true);
    expect(estaPausada({ pausadaEm: new Date(), pausadaAte: "2026-10-09", hoje: "2026-10-09" })).toBe(false);
    expect(estaPausada({ pausadaEm: null, pausadaAte: "2026-11-08", hoje: "2026-10-09" })).toBe(false);
  });
  it("desconto cobre as N mensalidades seguintes", () => {
    expect(ultimoVencimentoComDesconto("2026-10-31", 2)).toBe("2026-11-30");
    expect(ultimoVencimentoComDesconto("2026-10-31", 3)).toBe("2026-12-31");
    const d = { precoCentavos: 17800, pct: 20, ate: "2026-11-30" };
    expect(valorComRetencao({ ...d, vencimento: "2026-10-31" })).toBe(14240);
    expect(valorComRetencao({ ...d, vencimento: "2026-12-31" })).toBe(17800);
    expect(valorComRetencao({ ...d, pct: null, vencimento: "2026-10-31" })).toBe(17800);
  });
});

describe("motivos e indicador", () => {
  it("texto antigo vira código", () => {
    expect(motivoPorTexto("Ficou caro: mês apertado")).toBe("PRECO");
    expect(motivoPorTexto("Mudei de cidade ou de bairro")).toBe("MUDANCA");
    expect(motivoPorTexto("cliente pediu no balcão")).toBe("OUTRO");
  });
  it("resumo do mês por motivo e taxa de retenção", () => {
    const r = resumoPorMotivo([
      { motivo: "PRECO", desfecho: "DESCONTO" },
      { motivo: "PRECO", desfecho: "CANCELOU" },
      { motivo: "VIAGEM", desfecho: "PAUSA" },
      { motivo: "INSATISFEITO", desfecho: "GERENTE" },
    ]);
    expect(r.total).toEqual({ CANCELOU: 1, DESCONTO: 1, PAUSA: 1, GERENTE: 1 });
    expect(r.taxaRetencaoPct).toBe(67);
    expect(r.motivos.map((m) => m.motivo)).toEqual(["PRECO", "VIAGEM", "INSATISFEITO"]);
    expect(resumoPorMotivo([]).taxaRetencaoPct).toBeNull();
  });
});

describe("onde aplicar pausa/desconto", () => {
  it("roteia pelo prefixo do id", () => {
    expect(comoAplicar("sub_abc")).toBe("gateway"); // Pagar.me cartao/boleto
    expect(comoAplicar("pixrec_abc")).toBe("local"); // Pix gerado pelo BarberOS
    expect(comoAplicar("simsub_abc")).toBe("local");
    expect(comoAplicar("celsub_123")).toBeNull();
    expect(comoAplicar("cashbarber:1:abc")).toBeNull();
    expect(comoAplicar(null)).toBeNull();
    expect(capacidades("celsub_123")).toEqual({ pausa: false, desconto: false });
  });
});
