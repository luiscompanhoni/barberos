import { z } from "zod";
import documento from "./calendario-black-novembro-2026.json";

const texto = z.string().trim().min(1);
const zItem = z.object({
  data: z.string().regex(/^2026-11-(0[89]|[12]\d|30)$/), tema: texto,
  tipo: z.enum(["INTERNO", "VIDEO"]), estado: z.literal("PREPARADO_PARA_REVISAO"),
  condicional: z.boolean(), bloqueadoDivulgacao: z.boolean(), dependenciaIndicacao: z.boolean(), textoOriginal: texto,
  gancho: texto.nullable(), roteiro: texto.nullable(), cenas: texto.nullable(), legendaRotulo: texto.nullable(),
  legenda: texto.nullable(), cta: texto.nullable(), stories: texto.nullable(), responsavelEstado: texto.nullable(),
}).strict().superRefine((item, contexto) => {
  if (item.tipo === "VIDEO" && [item.gancho, item.roteiro, item.cenas, item.legendaRotulo, item.legenda, item.cta, item.stories, item.responsavelEstado].some((campo) => !campo)) {
    contexto.addIssue({ code: "custom", message: "Vídeo precisa preservar todos os campos do roteiro." });
  }
  if (item.dependenciaIndicacao && (!item.condicional || !item.bloqueadoDivulgacao)) {
    contexto.addIssue({ code: "custom", message: "Indicação depende de homologação e permanece bloqueada para divulgação." });
  }
});
export const zCalendarioConteudo = z.object({
  versao: z.literal(1), titulo: texto, fonte: z.literal("docs/calendario-black-novembro-2026.md"),
  preparadoEm: z.literal("2026-11-08"), estado: z.literal("PLANEJAMENTO_PARA_REVISAO"), sincronizacao: z.literal("MANUAL"),
  aviso: texto, direcaoFontes: texto, captacaoOperacao: texto, fechamentoEditorial: texto,
  itens: z.array(zItem).length(23),
}).strict().superRefine((calendario, contexto) => {
  const datas = new Set(calendario.itens.map((item) => item.data));
  const completo = Array.from({ length: 23 }, (_, indice) => `2026-11-${String(indice + 8).padStart(2, "0")}`).every((data) => datas.has(data));
  if (!completo || calendario.itens.filter((item) => item.tipo === "INTERNO").length !== 1 || calendario.itens.find((item) => item.tipo === "INTERNO")?.data !== "2026-11-08") {
    contexto.addIssue({ code: "custom", message: "Calendário precisa de 08/11 interno e dos 22 roteiros de 09 a 30/11." });
  }
});
export type ItemCalendarioConteudo = z.infer<typeof zItem>;
export type CalendarioConteudo = z.infer<typeof zCalendarioConteudo>;
export const calendarioConteudo: CalendarioConteudo = zCalendarioConteudo.parse(documento);

export function filtrarCalendarioConteudo(itens: ItemCalendarioConteudo[], filtros: { data: string; tema: string; condicional: "todos" | "sim" | "nao" }) {
  const busca = filtros.tema.trim().toLocaleLowerCase("pt-BR");
  return itens.filter((item) => (!filtros.data || item.data === filtros.data) &&
    (!busca || item.tema.toLocaleLowerCase("pt-BR").includes(busca)) &&
    (filtros.condicional === "todos" || item.condicional === (filtros.condicional === "sim")));
}
