import { describe, it, expect, afterEach, vi } from "vitest";
import { janelasEntrevista, sobrepoe, zConviteEntrevista } from "@/lib/recrutamento/entrevistas-regras";
import { dataLocal, diaSemana, minutosLocal } from "@/lib/agenda/tempo";
import { comandoEntrevista, inicioBotEntrevista, registroSeguroEntrevista, processarBotEntrevista } from "@/lib/bot/entrevistas";
import { tokenEntrevista, hashTokenEntrevista } from "@/lib/recrutamento/entrevistas-token";
afterEach(() => vi.unstubAllEnvs());
describe("agenda independente de entrevistas", () => {
  const agora = Date.parse("2031-03-03T15:00:00Z");
  it.each([1,15,30,45])("oferece somente segundas 14–16h com duração %s", duracao => {
    const slots = janelasEntrevista(duracao, agora); expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) { expect(diaSemana(dataLocal(s.inicio, "America/Sao_Paulo"))).toBe(1); expect(minutosLocal(s.inicio, "America/Sao_Paulo")).toBeGreaterThanOrEqual(840); expect(minutosLocal(s.fim, "America/Sao_Paulo")).toBeLessThanOrEqual(960); expect(+s.inicio).toBeGreaterThan(agora); expect(+s.fim - +s.inicio).toBe(duracao*60000); }
  });
  it.each([0,46,-1,1.5,NaN])("recusa duração %s", d => expect(() => janelasEntrevista(d, agora)).toThrow());
  it("não oferece 15h30 para entrevista de 45 minutos nem horário passado", () => {
    const slots = janelasEntrevista(45, Date.parse("2031-03-03T17:50:00Z"));
    expect(slots.every(s => minutosLocal(s.inicio, "America/Sao_Paulo") <= 915)).toBe(true);
    expect(slots.filter(s => dataLocal(s.inicio, "America/Sao_Paulo")==="2031-03-03").every(s => +s.inicio > Date.parse("2031-03-03T17:50:00Z"))).toBe(true);
  });
  it("limites encostados não conflitam e sobreposição parcial conflita", () => {
    const a={inicio:new Date(0),fim:new Date(100)}; expect(sobrepoe(a,{inicio:new Date(100),fim:new Date(200)})).toBe(false); expect(sobrepoe(a,{inicio:new Date(99),fim:new Date(200)})).toBe(true);
  });
  it("convite exige local, chave idempotente e versão da candidatura", () => expect(zConviteEntrevista.safeParse({ chave:"invalida",versao:-1,local:"x",duracaoMin:46 }).success).toBe(false));
});
describe("bot sem IA e segredo do convite", () => {
  it("não aceita confirmação vaga nem comando fora da janela sintática", () => { expect(comandoEntrevista("SIM")).toBeNull(); expect(comandoEntrevista("CONFIRMAR")).toBeNull(); expect(comandoEntrevista("CONFIRMAR 3")).toEqual({acao:"CONFIRMAR",versao:3}); expect(comandoEntrevista("ESCOLHER 2031-03-03 99:00 0")).toBeNull(); });
  it("preserva horário de São Paulo no comando de escolha", () => expect(comandoEntrevista("ESCOLHER 2031-03-03 14:00 2")).toEqual({acao:"ESCOLHER",inicio:"2031-03-03T17:00:00.000Z",versao:2}));
  it("token não contém identificação e muda ao renovar", () => { vi.stubEnv("SESSION_SECRET","fixture-entrevistas-2026-segredo-local-123456");const t=tokenEntrevista({id:"fixture",geracao:0});expect(t).toHaveLength(43);expect(t).not.toBe(tokenEntrevista({id:"fixture",geracao:1}));expect(hashTokenEntrevista(t)).toHaveLength(64);expect(registroSeguroEntrevista("ENTREVISTA "+t)).not.toContain(t);expect(inicioBotEntrevista("ENTREVISTA "+t)).not.toBeNull(); });
  it("sem ativação não acessa banco nem gera resposta para envio", async () => { vi.stubEnv("RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO","false");expect(await processarBotEntrevista({conversaId:"fixture",telefone:"47999990000"},"ENTREVISTA "+"a".repeat(43))).toEqual({tratado:true,resposta:null}); });
});
