import { describe, expect, it } from "vitest";
import { descreverAcao, formatarCampo, linhasDeMudanca, mudancas, resumoAparelho } from "@/lib/auditoria-regras";

describe("auditoria: antes e depois", () => {
  it("guarda so os campos enviados que mudaram", () => {
    const atual = { nome: "Corte", precoCentavos: 6500, duracaoMin: 30, ativo: true };
    expect(mudancas(atual, { precoCentavos: 5000, duracaoMin: 30, nome: undefined })).toEqual({ antes: { precoCentavos: 6500 }, depois: { precoCentavos: 5000 } });
    expect(mudancas(atual, { precoCentavos: 6500 })).toBeNull();
    expect(mudancas(atual, { ativo: false }, ["ativo"])).toBeNull();
  });
  it("datas comparam pelo valor", () => {
    const d = new Date("1990-05-10T00:00:00Z");
    expect(mudancas({ dataNascimento: d }, { dataNascimento: new Date(d) })).toBeNull();
    expect(mudancas({ dataNascimento: null }, { dataNascimento: d })).toEqual({ antes: { dataNascimento: null }, depois: { dataNascimento: "1990-05-10T00:00:00.000Z" } });
  });
});

describe("auditoria: textos da tela", () => {
  it("acao e entidade em portugues; codigo desconhecido fica legivel", () => {
    expect(descreverAcao("desconto", "comanda")).toBe("Comanda · mudou o desconto");
    expect(descreverAcao("retencao_pausa", "assinatura")).toBe("Assinatura · retenção: pausa");
    expect(descreverAcao("algo_novo", "coisa_x")).toBe("coisa x · algo novo");
  });
  it("valores: R$, %, datas e sim/nao", () => {
    expect(formatarCampo("precoCentavos", 6500)).toBe("R$ 65,00");
    expect(formatarCampo("percentualBps", 3550)).toBe("35,5%");
    expect(formatarCampo("inicio", "2026-10-01")).toBe("01/10/2026");
    expect(formatarCampo("ativo", false)).toBe("não");
    expect(formatarCampo("motivo", null)).toBe("—");
  });
  it("linhas de mudanca: 'preco: R$ 65,00 → R$ 50,00'", () => {
    expect(linhasDeMudanca({ antes: { precoCentavos: 6500 }, depois: { precoCentavos: 5000 } })).toEqual(["preço: R$ 65,00 → R$ 50,00"]);
    expect(linhasDeMudanca({ depois: { fim: "2026-10-31" } })).toEqual(["fim: 31/10/2026"]);
    expect(linhasDeMudanca({ descontoCentavos: 500 })).toEqual([]);
  });
});

describe("auditoria: aparelho", () => {
  it("resume o user agent", () => {
    expect(resumoAparelho("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(resumoAparelho("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(resumoAparelho("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0")).toBe("Windows · Edge");
    expect(resumoAparelho(null)).toBeNull();
  });
});
