import { z } from "zod";
import { normalizarTelefone } from "@/lib/telefone";
export const ETAPAS = ["NOVO", "TRIAGEM", "ENTREVISTA", "TESTE", "APROVADO", "CONTRATADO", "BANCO", "ENCERRADO"] as const;
export const ROTULOS: Record<(typeof ETAPAS)[number], string> = { NOVO: "Novo", TRIAGEM: "Em triagem", ENTREVISTA: "Entrevista", TESTE: "Teste prático", APROVADO: "Aprovado", CONTRATADO: "Contratado", BANCO: "Banco de talentos", ENCERRADO: "Encerrado" };
export const SERVICOS = ["Corte com máquina", "Corte com tesoura", "Degradê", "Barba", "Acabamento", "Coloração"] as const;
export const VERSAO_FORMULARIO = "2026-10-v1";
export const AVISO_PRIVACIDADE = "A Black Barber usará seus dados para analisar esta candidatura e entrar em contato sobre esta seleção. O acesso fica restrito à gestão. Não envie documentos ou informações sensíveis. A autorização para futuras oportunidades é opcional e separada.";
const texto = (max: number) => z.string().trim().min(2).max(max);
const link = z.string().trim().max(500).refine((s) => {
  if (!s) return true;
  try { const u = new URL(s); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}, "Use um link https válido.").default("");
export const zVaga = z.object({ titulo: texto(100), cidade: texto(100), descricao: texto(4000), privacidade: texto(3000), ativa: z.boolean().default(false) }).strict();
export const zCandidatura = z.object({
  envioId: z.uuid(), nome: texto(120), telefone: z.string().max(30).transform(normalizarTelefone).refine((s) => s !== null, "WhatsApp inválido."), cidade: texto(100),
  experienciaMeses: z.number().int().min(0).max(720), servicos: z.array(z.enum(SERVICOS)).min(1).max(SERVICOS.length).refine((s) => new Set(s).size === s.length),
  disponibilidade: texto(1000), portfolio: link, instagram: link, cienciaPrivacidade: z.literal(true), futurasOportunidades: z.boolean().default(false),
  origem: z.object({ utm_source: z.string().max(150).optional(), utm_medium: z.string().max(150).optional(), utm_campaign: z.string().max(150).optional(), utm_content: z.string().max(150).optional() }).strict().default({}),
  /** Campo-isca escondido: pessoa nao preenche; robo preenche e o envio e descartado em silencio. */
  site: z.string().max(500).optional(),
}).strict();
export const zEtapa = z.object({ etapa: z.enum(ETAPAS), versao: z.number().int().min(0), motivo: texto(1500) }).strict();
export function podeRecrutar(papel: string) { return papel === "DONO" || papel === "GERENTE"; }
