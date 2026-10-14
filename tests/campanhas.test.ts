import { describe, expect, it } from "vitest";
import { loteSugerido, montarMensagem, segmentosDoCliente, vagasNasJanelas } from "@/lib/campanhas/regras";

const DIA = 86_400_000;
const agora = Date.parse("2026-10-14T15:00:00Z");
const ha = (dias: number) => agora - dias * DIA;

describe("campanhas: segmentos", () => {
  it("faixa pela ultima visita, perdido acima de 90 dias", () => {
    expect(segmentosDoCliente({ ultima: ha(10), primeira: ha(400), assinatura: null }, agora)).toEqual(["ate30"]);
    expect(segmentosDoCliente({ ultima: ha(45), primeira: ha(400), assinatura: null }, agora)).toEqual(["d31a60"]);
    expect(segmentosDoCliente({ ultima: ha(91), primeira: ha(400), assinatura: null }, agora)).toEqual(["d91a180", "perdido"]);
    expect(segmentosDoCliente({ ultima: ha(200), primeira: ha(400), assinatura: "ex" }, agora)).toEqual(["mais180", "perdido", "exAssinante"]);
  });
  it("novo pela primeira visita; assinante soma com a faixa; quem nunca veio", () => {
    expect(segmentosDoCliente({ ultima: ha(3), primeira: ha(20), assinatura: "ativa" }, agora)).toEqual(["ate30", "novo", "assinante"]);
    expect(segmentosDoCliente({ ultima: null, primeira: null, assinatura: null }, agora)).toEqual(["nunca"]);
  });
});

describe("campanhas: capacidade", () => {
  const h = (hhmm: string) => Date.parse(`2026-10-15T${hhmm}:00Z`);
  it("conta quantos atendimentos cabem em cada janela livre", () => {
    expect(vagasNasJanelas([{ inicio: h("09:00"), fim: h("10:00") }], 30)).toBe(2);
    expect(vagasNasJanelas([{ inicio: h("09:00"), fim: h("09:20") }], 30)).toBe(0);
    expect(vagasNasJanelas([{ inicio: h("09:00"), fim: h("10:00") }, { inicio: h("14:00"), fim: h("15:30") }], 40)).toBe(3);
  });
  it("intervalo entre clientes so entre um e outro", () => {
    expect(vagasNasJanelas([{ inicio: h("09:00"), fim: h("10:00") }], 30, 10)).toBe(1);
    expect(vagasNasJanelas([{ inicio: h("09:00"), fim: h("10:10") }], 30, 10)).toBe(2);
  });
  it("lote: vagas / taxa de quem marca, sem passar do limite diario nem de quem falta chamar", () => {
    expect(loteSugerido({ vagas: 20, taxaRespostaBps: 2000, limiteDiario: 200, elegiveis: 500, naFila: 0 })).toBe(100);
    expect(loteSugerido({ vagas: 20, taxaRespostaBps: 2000, limiteDiario: 50, elegiveis: 500, naFila: 0 })).toBe(50);
    expect(loteSugerido({ vagas: 20, taxaRespostaBps: 2000, limiteDiario: 200, elegiveis: 30, naFila: 0 })).toBe(30);
    expect(loteSugerido({ vagas: 20, taxaRespostaBps: 2000, limiteDiario: 200, elegiveis: 500, naFila: 120 })).toBe(0);
  });
});

describe("campanhas: mensagem", () => {
  it("troca as variaveis e sempre diz como parar", () => {
    const m = montarMensagem("Oi, {nome}! Aqui é da {barbearia}: {link}", { nome: "João da Silva", barbearia: "Black Barber", link: "https://x/c/agendar" });
    expect(m).toBe("Oi, João! Aqui é da Black Barber: https://x/c/agendar\n\nPara não receber mais, responda PARAR.");
    expect(montarMensagem("Responda PARAR para sair. {nome}", { nome: "Ana", barbearia: "B", link: "" })).toBe("Responda PARAR para sair. Ana");
  });
});
