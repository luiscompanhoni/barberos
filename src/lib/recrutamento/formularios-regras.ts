import { z } from "zod";
import { ErroNegocio } from "@/lib/erros";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/).refine(v => !["__proto__", "prototype", "constructor"].includes(v), "Identificador reservado.");
export const zPergunta = z.object({
  id, secao: z.string().trim().min(2).max(100), texto: z.string().trim().min(5).max(1000),
  instrucao: z.string().trim().max(500).default(""),
  tipo: z.enum(["CURTO", "LONGO", "UNICA", "MULTIPLA", "LINK"]), obrigatoria: z.boolean(),
  opcoes: z.array(z.string().trim().min(1).max(150)).max(20),
  condicao: z.object({ perguntaId: id, valor: z.string().max(150) }).strict().nullable(),
}).strict();
const zCriterio = z.object({ id, nome: z.string().trim().min(2).max(120), peso: z.number().int().min(1).max(100),
  perguntas: z.array(id).min(1).max(100), critico: z.boolean(),
  rubrica: z.array(z.string().trim().min(5).max(1000)).length(4),
}).strict();
export const zDefinicao = z.object({ perguntas: z.array(zPergunta).min(1).max(100), criterios: z.array(zCriterio).min(1).max(30) }).strict().superRefine((d, ctx) => {
  const falha = (message: string) => ctx.addIssue({ code: "custom", message });
  const vistos = new Map<string, (typeof d.perguntas)[number]>();
  for (const p of d.perguntas) {
    if (vistos.has(p.id)) falha("Identificador de pergunta repetido.");
    if (["UNICA", "MULTIPLA"].includes(p.tipo) && (p.opcoes.length < 2 || new Set(p.opcoes).size !== p.opcoes.length)) falha("Informe ao menos duas opções distintas.");
    if (!["UNICA", "MULTIPLA"].includes(p.tipo) && p.opcoes.length) falha("Este tipo não aceita opções.");
    if (p.condicao) {
      const anterior = vistos.get(p.condicao.perguntaId);
      if (!anterior || anterior.tipo !== "UNICA" || !anterior.opcoes.includes(p.condicao.valor)) falha("Condição deve usar opção de uma escolha única anterior.");
    }
    vistos.set(p.id, p);
  }
  if (new Set(d.criterios.map(c => c.id)).size !== d.criterios.length) falha("Identificador de competência repetido.");
  if (d.criterios.reduce((s, c) => s + c.peso, 0) !== 100) falha("Os pesos devem somar 100%.");
  for (const c of d.criterios) if (new Set(c.perguntas).size !== c.perguntas.length || c.perguntas.some(p => !vistos.has(p))) falha("Revise as perguntas vinculadas às competências.");
});
export type Definicao = z.infer<typeof zDefinicao>;
export type Pergunta = z.infer<typeof zPergunta>;
export type Respostas = Record<string, string | string[]>;
export type FormularioPublico = { id: string; titulo: string; funcao: string; perguntas: Pergunta[] };
export const zFormulario = z.object({ titulo: z.string().trim().min(2).max(100), funcao: z.enum(["BARBEIRO", "RECEPCAO", "AUXILIAR"]), definicao: zDefinicao }).strict();
export function visivel(p: Pergunta, respostas: Respostas) { return !p.condicao || respostas[p.condicao.perguntaId] === p.condicao.valor; }
export function perguntasVisiveis(perguntas: Pergunta[], respostas: Respostas) {
  const ativas: Respostas = {}; const resultado: Pergunta[] = [];
  for (const p of perguntas) if (visivel(p, ativas)) { resultado.push(p); if (respostas[p.id] !== undefined) ativas[p.id] = respostas[p.id]; }
  return resultado;
}
export function validarRespostas(d: Definicao, respostas: Respostas) {
  const ativas = perguntasVisiveis(d.perguntas, respostas); const ids = new Set(ativas.map(p => p.id));
  if (Object.keys(respostas).some(k => !ids.has(k))) throw new ErroNegocio("Há respostas para perguntas que não pertencem a este formulário.");
  const limpas: Respostas = {};
  for (const p of ativas) {
    const v = respostas[p.id]; const vazio = v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
    if (vazio) { if (p.obrigatoria) throw new ErroNegocio(`Responda: ${p.texto}`); continue; }
    if (p.tipo === "MULTIPLA") {
      if (!Array.isArray(v) || new Set(v).size !== v.length || v.some(x => !p.opcoes.includes(x))) throw new ErroNegocio("Selecione opções válidas.");
    } else {
      if (typeof v !== "string" || !v.trim() || v.length > (p.tipo === "CURTO" ? 300 : 3000)) throw new ErroNegocio("Revise o tamanho e o formato da resposta.");
      if (p.tipo === "UNICA" && !p.opcoes.includes(v)) throw new ErroNegocio("Opção inválida.");
      if (p.tipo === "LINK") { try { const u = new URL(v); if (u.protocol !== "https:" || u.username || u.password) throw Error(); } catch { throw new ErroNegocio("Use um link https sem credenciais."); } }
    }
    limpas[p.id] = typeof v === "string" ? v.trim() : v;
  }
  return limpas;
}
export function publico(f: { id: string; titulo: string; funcao: string; definicao: unknown }): FormularioPublico {
  return { id: f.id, titulo: f.titulo, funcao: f.funcao, perguntas: zDefinicao.parse(f.definicao).perguntas };
}
export const zAvaliacao = z.object({ versao: z.number().int().min(0), etapa: z.enum(["FORMULARIO", "ENTREVISTA", "PRATICA"]),
  criterios: z.array(z.object({ id, nivel: z.number().int().min(0).max(3).nullable(), evidencia: z.string().trim().max(2000) }).strict()).max(30),
}).strict();
export function calcularAvaliacao(d: Definicao, criterios: z.infer<typeof zAvaliacao>["criterios"]) {
  criterios = zAvaliacao.shape.criterios.parse(criterios);
  if (criterios.length !== d.criterios.length || new Set(criterios.map(c => c.id)).size !== criterios.length || criterios.some(c => !d.criterios.some(x => x.id === c.id))) throw new ErroNegocio("Avalie os critérios da versão aplicada.");
  if (criterios.some(c => c.nivel !== null && c.evidencia.length < 5)) throw new ErroNegocio("Registre uma evidência para cada nível atribuído.");
  const cobertura = criterios.filter(c => c.nivel !== null).length;
  const nota = cobertura !== d.criterios.length ? null : Math.round(d.criterios.reduce((s, c) => s + c.peso * criterios.find(x => x.id === c.id)!.nivel! / 3, 0) / 10 * 100) / 100;
  return { cobertura, nota, criticosPendentes: d.criterios.filter(c => c.critico && (criterios.find(x => x.id === c.id)!.nivel ?? -1) < 2).map(c => c.nome) };
}
