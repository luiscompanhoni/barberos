import { describe, expect, it } from "vitest";
import { loteSugerido, montarFunil, montarMensagem, segmentosDoCliente, vagasNasJanelas, type LinhaFunil } from "@/lib/campanhas/regras";

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

describe("campanhas: funil", () => {
  const l = (x: Partial<LinhaFunil> = {}): LinhaFunil => ({
    entregue: false, lida: false, clicou: false, girou: false, ganhou: false, app: false,
    conta: false, contaNova: false, agendou: false, compareceu: false, resgatou: false, ...x,
  });
  const linhas = [
    l({ entregue: true, lida: true, clicou: true, girou: true, ganhou: true, app: true, conta: true, contaNova: true, agendou: true, compareceu: true, resgatou: true }),
    l({ entregue: true, lida: true, clicou: true, girou: true }),
    l({ entregue: true }),
    l(),
  ];
  it("com jogo: todas as etapas, % das enviadas e da etapa anterior", () => {
    const f = montarFunil(linhas, { jogo: "Roleta Black", statusDisponivel: true });
    expect(f.map((e) => [e.chave, e.qtd])).toEqual([
      ["enviadas", 4], ["entregues", 3], ["lidas", 2], ["clicaram", 2], ["giraram", 2], ["ganharam", 1],
      ["app", 1], ["conta", 1], ["agendaram", 1], ["compareceram", 1], ["resgataram", 1],
    ]);
    const e = Object.fromEntries(f.map((x) => [x.chave, x]));
    expect(e.entregues.doTotal).toBe(0.75);
    expect(e.ganharam.daAnterior).toBe(0.5);
    expect(e.enviadas.daAnterior).toBeNull();
    expect(e.conta.detalhe).toBe("1 criada(s) depois da mensagem");
  });
  it("campanha comum sem confirmacao do WhatsApp: sem giro/premio/resgate e entregue/lida sem numero", () => {
    const f = montarFunil(linhas, { jogo: null, statusDisponivel: false });
    expect(f.map((e) => e.chave)).toEqual(["enviadas", "entregues", "lidas", "clicaram", "app", "conta", "agendaram", "compareceram"]);
    const e = Object.fromEntries(f.map((x) => [x.chave, x]));
    expect(e.entregues.qtd).toBeNull();
    // A etapa depois de uma sem numero compara com a ultima que tem.
    expect(e.clicaram.daAnterior).toBe(0.5);
  });
});
