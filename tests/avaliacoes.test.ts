import { describe, expect, it } from "vitest";
import { competenciaResposta, falhaSemEnvioConfirmado, notaPublica, primeiraVisitaElegivel, quantidadePublicavel, resumirNotas } from "@/lib/avaliacoes/regras";

describe("privacidade das avaliações", () => {
  it("não publica uma média a cada resposta", () => {
    expect([0, 1, 4, 5, 6, 9, 10].map(quantidadePublicavel)).toEqual([0, 0, 0, 5, 5, 5, 10]);
    expect(notaPublica(4, 20)).toEqual({ media: null, quantidade: 0, faixa: "formacao", emFormacao: true });
  });
  it("aplica as cores sem arredondar uma nota ruim para a faixa melhor", () => {
    expect(notaPublica(100, 449).faixa).toBe("atencao");
    expect(notaPublica(1000, 4499).faixa).toBe("atencao");
    expect(notaPublica(10, 45).faixa).toBe("excelente");
    expect(notaPublica(5, 19).faixa).toBe("melhorar");
  });
  it("reenvio automático nunca inclui falhas de entrega ambígua", () => {
    expect(falhaSemEnvioConfirmado("Fora da janela de 24h e WHATSAPP_TEMPLATE_AVISO não configurado: aviso não enviado.")).toBe(true);
    expect(falhaSemEnvioConfirmado("fetch failed")).toBe(false);
    expect(falhaSemEnvioConfirmado("Timeout do provedor")).toBe(false);
    expect(falhaSemEnvioConfirmado(null)).toBe(false);
  });
  it("perguntas opcionais só mostram lotes de pelo menos cinco respostas", () => {
    const r = resumirNotas([{ nota: 5, corte: 1 }, { nota: 4 }, { nota: 3 }, { nota: 2 }, { nota: 1 }]);
    expect(r).toMatchObject({ quantidade: 5, soma: 15, categorias: { corte: { quantidade: 0, soma: 0 } } });
  });
  it("a sexta resposta opcional fica fora até fechar o próximo grupo", () => {
    const r = resumirNotas([...Array.from({ length: 5 }, () => ({ nota: 5, corte: 5 })), { nota: 1, corte: 1 }]);
    expect(r.categorias.corte).toEqual({ quantidade: 5, soma: 25 });
  });
  it("um lote global novo não publica somente uma nota adicional da categoria", () => {
    const r = resumirNotas([
      ...Array.from({ length: 5 }, () => ({ nota: 5, corte: 5 })),
      ...Array.from({ length: 4 }, () => ({ nota: 4 })), { nota: 1, corte: 1 },
    ]);
    expect(r.quantidade).toBe(10);
    expect(r.categorias.corte).toEqual({ quantidade: 5, soma: 25 });
  });
  it("fecha competência no horário da barbearia", () => {
    expect(competenciaResposta(new Date("2026-11-01T01:00:00Z"))).toBe("2026-10");
    expect(competenciaResposta(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11");
  });
});

describe("elegibilidade da primeira visita", () => {
  const ativaDesde = new Date("2026-10-01T00:00:00Z");
  const agora = new Date("2026-10-28T18:00:00Z");
  it("não convida cliente antigo nem atendimento futuro", () => {
    expect(primeiraVisitaElegivel({ ativo: true, ativaDesde, agora, primeiraFim: new Date("2026-09-30") })).toBe(false);
    expect(primeiraVisitaElegivel({ ativo: true, ativaDesde, agora, primeiraFim: new Date("2026-10-29") })).toBe(false);
    expect(primeiraVisitaElegivel({ ativo: true, ativaDesde, agora, primeiraFim: null })).toBe(false);
  });
  it("regra desligada não cria novos convites", () => {
    expect(primeiraVisitaElegivel({ ativo: false, ativaDesde, agora, primeiraFim: agora })).toBe(false);
    expect(primeiraVisitaElegivel({ ativo: true, ativaDesde: null, agora, primeiraFim: agora })).toBe(false);
  });
  it("preserva a elegibilidade mesmo se o convite for consultado após o prazo", () => {
    // O convite fica expirado; ele não pode se transformar em ficha de atendimento sem avaliar.
    expect(primeiraVisitaElegivel({ ativo: true, ativaDesde, agora, primeiraFim: new Date("2026-10-02") })).toBe(true);
  });
});
