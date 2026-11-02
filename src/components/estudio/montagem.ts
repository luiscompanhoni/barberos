import type { Preset } from "@/lib/estudio/templates";

export type Clipe = { id: string; nome: string; bytes: number; pronto: boolean; duracao: number; inicio: number; fim: number; texto: string };
export type Montagem = { revisao: number; nome: string; preset: Preset; titulo: string; chamada: string; clipes: Clipe[] };
type Estado = { base: Montagem; rascunho: Montagem; servidor: Montagem; versaoConferida: string | null };
type Acao = { tipo: "receber"; montagem: Montagem } | { tipo: "alterar"; campos: Partial<Omit<Montagem, "revisao">> }
  | { tipo: "salvo"; montagem: Montagem } | { tipo: "descartar" } | { tipo: "conferir"; versaoId: string | null };

function conteudo(m: Montagem) {
  return JSON.stringify([m.nome, m.preset, m.titulo, m.chamada, m.clipes.map(c => [c.id, c.inicio, c.fim, c.texto])]);
}
export const alterada = (e: Estado) => conteudo(e.rascunho) !== conteudo(e.base);
export const emConflito = (e: Estado) => alterada(e) && e.servidor.revisao > e.base.revisao;
export const conferida = (e: Estado, versaoId?: string) => !!versaoId && e.versaoConferida === versaoId;
export function iniciarMontagem(m: Montagem): Estado {
  return { base: m, rascunho: m, servidor: m, versaoConferida: null };
}
export function reduzirMontagem(e: Estado, a: Acao): Estado {
  switch (a.tipo) {
    case "alterar": {
      const novo = { ...e, rascunho: { ...e.rascunho, ...a.campos } };
      return !alterada(novo) && e.servidor.revisao > e.base.revisao ? { ...novo, base: e.servidor, rascunho: e.servidor } : novo;
    }
    case "conferir": return { ...e, versaoConferida: a.versaoId };
    case "descartar": return { ...e, base: e.servidor, rascunho: e.servidor };
    case "receber":
      // Respostas atrasadas não revertem a revisão nem descartam o que está sendo editado.
      if (a.montagem.revisao <= e.servidor.revisao) return e;
      return alterada(e) ? { ...e, servidor: a.montagem } : { ...e, base: a.montagem, rascunho: a.montagem, servidor: a.montagem };
    case "salvo": {
      // O servidor pode ter avançado novamente enquanto a confirmação de gravação chegava.
      const atual = e.servidor.revisao > a.montagem.revisao ? e.servidor : a.montagem;
      return { ...e, base: atual, rascunho: atual, servidor: atual };
    }
  }
}
