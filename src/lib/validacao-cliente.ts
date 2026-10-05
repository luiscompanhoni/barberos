import { z } from "zod";

export const ORIGENS_CLIENTE = ["INDICACAO", "INSTAGRAM", "GOOGLE", "FACHADA", "WHATSAPP", "OUTRO"] as const;

/** Data de nascimento AAAA-MM-DD entre 5 e 100 anos atras (ou null para apagar). */
export const zNascimento = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD")
  .refine((d) => {
    const t = Date.parse(`${d}T12:00:00Z`);
    const anos = (Date.now() - t) / (365.25 * 86_400_000);
    return !Number.isNaN(t) && anos >= 5 && anos <= 100;
  }, "Data de nascimento inválida")
  .transform((d) => new Date(`${d}T00:00:00Z`))
  .nullable();

/** Campos de perfil de marketing que equipe, site e bot podem preencher. */
export const zPerfilCliente = z.object({
  dataNascimento: zNascimento.optional(),
  origem: z.enum(ORIGENS_CLIENTE).nullable().optional(),
  origemDetalhe: z.string().trim().max(80).nullable().optional(),
});

export const dataParaTexto = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
