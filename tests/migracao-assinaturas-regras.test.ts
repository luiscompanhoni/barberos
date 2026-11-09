import { describe, expect, it } from "vitest";
import { proximoPassoMigracao, validarTransicaoMigracao } from "@/lib/migracao-assinaturas/regras";
import { zAcaoMigracao, zReferenciaConferencia, type ConferenciaMigracao } from "@/lib/migracao-assinaturas/schemas";

const conferencia: ConferenciaMigracao = {
  referencia: "REV-2026-001", contratoConciliado: true, rotaVerificada: true, vinculoNovoConfirmado: true,
  legadoInterrompido: true, consentimentoConfirmado: true, proximaCobrancaUnica: true,
};
const base = {
  de: "LEGADO_CONCILIADO", para: "CONCLUIDO" as const, statusAssinatura: "ATIVA", gatewayAtual: "sub_destino",
  destinoGatewayId: "sub_destino", proximoVencimento: "2026-12-01", adiadoAte: null,
  hoje: "2026-11-08", contatoImpedido: false, conferencia,
};
describe("conferência de migração", () => {
  it("conclui apenas após conferências e vínculo efetivo ao destino", () => {
    expect(() => validarTransicaoMigracao(base)).not.toThrow();
    expect(() => validarTransicaoMigracao({ ...base, gatewayAtual: "celsub_origem" })).toThrow(/vínculo efetivo/);
    expect(() => validarTransicaoMigracao({ ...base, conferencia: { ...conferencia, proximaCobrancaUnica: false } })).toThrow(/única/);
  });
  it.each(["contratoConciliado", "rotaVerificada", "vinculoNovoConfirmado", "legadoInterrompido", "consentimentoConfirmado"] as const)("exige a evidência %s", campo => {
    expect(() => validarTransicaoMigracao({ ...base, conferencia: { ...conferencia, [campo]: false } })).toThrow();
  });
  it("não pula etapas nem reabre conclusão", () => {
    expect(() => validarTransicaoMigracao({ ...base, de: "A_CONFERIR" })).toThrow(/uma etapa/);
    expect(() => validarTransicaoMigracao({ ...base, de: "CONCLUIDO", para: "AJUDA" })).toThrow(/não pode ser reaberta/);
    expect(() => validarTransicaoMigracao({ ...base, de: "AJUDA" })).toThrow(/A conferir/);
    expect(() => validarTransicaoMigracao({ ...base, de: "AJUDA", para: "A_CONFERIR" })).not.toThrow();
  });
  it("contrato cancelado não vira ativo; pendências podem ser encaminhadas à ajuda", () => {
    expect(() => validarTransicaoMigracao({ ...base, statusAssinatura: "CANCELADA" })).toThrow(/histórico/);
    expect(() => validarTransicaoMigracao({ ...base, statusAssinatura: "CANCELADA", para: "AJUDA" })).not.toThrow();
  });
  it("contato impedido não avança para convite, mas conferência administrativa pode terminar", () => {
    expect(() => validarTransicaoMigracao({ ...base, de: "A_CONFERIR", para: "PRONTO", contatoImpedido: true })).toThrow(/atendimento humano/);
    expect(() => validarTransicaoMigracao({ ...base, contatoImpedido: true })).not.toThrow();
  });
  it("adiamento exige data futura e retorno passa pela conferência", () => {
    expect(() => validarTransicaoMigracao({ ...base, para: "ADIADO" })).toThrow(/data futura/);
    expect(() => validarTransicaoMigracao({ ...base, para: "ADIADO", adiadoAte: "2026-11-08" })).toThrow();
    expect(() => validarTransicaoMigracao({ ...base, para: "ADIADO", adiadoAte: "2026-11-21" })).not.toThrow();
    expect(() => validarTransicaoMigracao({ ...base, para: "AJUDA", adiadoAte: "2026-11-21" })).toThrow(/somente/);
  });
});

const instante = (dia: string) => new Date(`2026-11-${dia}T12:00:00-03:00`);
const cadencia = {
  agora: instante("08"), estado: "PRONTO" as const, aceitaMensagens: true, humano: false, excluido: false,
  recusaAutomaticas: false, contatosMigracao: [] as Date[], ultimoContatoGlobalEm: null,
};
describe("cadência apenas calculada, sem enviar", () => {
  it("oferece D0, D+2, D+5 e véspera, com intervalo global", () => {
    expect(proximoPassoMigracao(cadencia).acao).toBe("CONVITE");
    expect(proximoPassoMigracao({ ...cadencia, agora: instante("10"), contatosMigracao: [instante("08")] }).acao).toBe("LEMBRETE");
    expect(proximoPassoMigracao({ ...cadencia, agora: instante("13"), contatosMigracao: [instante("08"), instante("10")] }).acao).toBe("OFERECER_AJUDA");
    expect(proximoPassoMigracao({ ...cadencia, agora: instante("19"), contatosMigracao: [instante("08"), instante("10"), instante("13")] }).acao).toBe("VESPERA");
    expect(proximoPassoMigracao({ ...cadencia, agora: instante("19"), contatosMigracao: [instante("08"), instante("10"), instante("13")], ultimoContatoGlobalEm: instante("18") }).acao).toBe("NENHUMA");
  });
  it("não comprime contatos de quem entrou tarde, nem passa do teto", () => {
    expect(proximoPassoMigracao({ ...cadencia, agora: instante("19"), contatosMigracao: [instante("18")] }).acao).toBe("NENHUMA");
    expect(proximoPassoMigracao({ ...cadencia, agora: instante("20"), contatosMigracao: [instante("08"), instante("10"), instante("13"), instante("19")] }).acao).toBe("NENHUMA");
    expect(proximoPassoMigracao({ ...cadencia, agora: instante("21") }).acao).toBe("REVISAO_HUMANA");
  });
  it.each([
    { aceitaMensagens: false }, { humano: true }, { excluido: true }, { recusaAutomaticas: true },
    { estado: "CONCLUIDO" as const }, { estado: "ADIADO" as const }, { estado: "AJUDA" as const }, { estado: "NAO_CONTATAR" as const },
  ])("encerra contato em %j", extra => {
    expect(proximoPassoMigracao({ ...cadencia, ...extra }).acao).toBe("NENHUMA");
  });
  it("histórico futuro/inválido bloqueia a cadência", () => {
    expect(proximoPassoMigracao({ ...cadencia, contatosMigracao: [instante("09")] }).acao).toBe("NENHUMA");
    expect(proximoPassoMigracao({ ...cadencia, ultimoContatoGlobalEm: new Date("inválido") }).acao).toBe("NENHUMA");
  });
});

describe("entrada mínima sem segredos", () => {
  it.each(["https://pagamento.example/link", "CARTAO-4111111111111111", "CPF-123.456.789-00", "sk_test_privado", "token_secreto", "nome@email.example"])("recusa referência sensível %s", valor => {
    expect(zReferenciaConferencia.safeParse(valor).success).toBe(false);
  });
  it("recusa data inexistente e campos de cartão", () => {
    const entrada = { acao: "atualizar", assinaturaId: "assinatura", versao: 0, estado: "ADIADO", destinoGatewayId: null,
      adiadoAte: "2026-02-30", contrato: { planoId: "plano", precoCentavos: 11800, proximoVencimento: null, cicloInicio: null }, conferencia };
    expect(zAcaoMigracao.safeParse(entrada).success).toBe(false);
    expect(zAcaoMigracao.safeParse({ ...entrada, adiadoAte: "2026-11-21", cartao: "segredo" }).success).toBe(false);
  });
});
