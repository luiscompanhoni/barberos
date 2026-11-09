import { z } from "zod";

export const ESTADOS_MIGRACAO = ["A_CONFERIR", "PRONTO", "CONVIDADO", "INICIOU", "CARTAO_CONFIRMADO", "LEGADO_CONCILIADO", "CONCLUIDO", "AJUDA", "ADIADO", "NAO_CONTATAR"] as const;
export type EstadoMigracao = typeof ESTADOS_MIGRACAO[number];
export const ROTULOS_MIGRACAO: Record<EstadoMigracao, string> = {
  A_CONFERIR: "A conferir", PRONTO: "Pronto para convite", CONVIDADO: "Convite registrado", INICIOU: "Início registrado",
  CARTAO_CONFIRMADO: "Meio de pagamento conferido", LEGADO_CONCILIADO: "Legado conciliado", CONCLUIDO: "Concluído por conferência gerencial",
  AJUDA: "Precisa de ajuda", ADIADO: "Adiado", NAO_CONTATAR: "Não contatar",
};

export const zEstadoMigracao = z.enum(ESTADOS_MIGRACAO);
const zId = z.string().trim().min(1).max(40);
const zDataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
}, "Data inválida.");

/** Referência de conferência interna, nunca cartão, URL de pagamento ou credencial. */
export const zReferenciaConferencia = z.string().trim().min(3).max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_.:/-]*$/, "Use somente o código da conferência interna.")
  .refine(s => !/https?:\/\/|(?:\d[ .-]?){11,19}|(?:sk|pk|token)[_-]/i.test(s), "Não informe documento, cartão, link ou segredo.");

export const zConferenciaMigracao = z.object({
  referencia: zReferenciaConferencia,
  contratoConciliado: z.boolean(),
  rotaVerificada: z.boolean(),
  vinculoNovoConfirmado: z.boolean(),
  legadoInterrompido: z.boolean(),
  consentimentoConfirmado: z.boolean(),
  proximaCobrancaUnica: z.boolean(),
}).strict();
export type ConferenciaMigracao = z.infer<typeof zConferenciaMigracao>;

export const zContratoMigracao = z.object({
  planoId: zId,
  precoCentavos: z.number().int().nonnegative().max(2_147_483_647),
  proximoVencimento: zDataCivil.nullable(),
  cicloInicio: z.string().datetime({ offset: true }).nullable(),
}).strict();

export const zConsultaMigracao = z.object({
  cursor: zId.optional(),
  estado: zEstadoMigracao.optional(),
  responsavelId: zId.optional(),
});

export const zAcaoMigracao = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("iniciar"), assinaturaId: zId }).strict(),
  z.object({
    acao: z.literal("atualizar"), assinaturaId: zId,
    versao: z.number().int().nonnegative(), estado: zEstadoMigracao,
    destinoGatewayId: z.string().regex(/^(?:sub|pixrec)_[A-Za-z0-9_-]{1,90}$/).nullable(),
    adiadoAte: zDataCivil.nullable(),
    contrato: zContratoMigracao,
    conferencia: zConferenciaMigracao,
  }).strict(),
]);
export type AcaoMigracao = z.infer<typeof zAcaoMigracao>;
export type ConsultaMigracao = z.infer<typeof zConsultaMigracao>;
