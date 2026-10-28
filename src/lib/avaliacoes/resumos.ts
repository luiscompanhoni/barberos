import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CATEGORIAS, competenciaResposta, notaPublica, quantidadePublicavel, resumirNotas, type TotaisCategorias } from "./regras";

type Periodos = Record<string, { quantidade: number; soma: number }>;

/** Chamado sob lock por barbeiro. Resto de 1–4 respostas não altera o resumo visível. */
export async function publicarLotes(tx: Prisma.TransactionClient, barbeiroId: string) {
  const respostas = await tx.avaliacaoCliente.findMany({
    where: { convite: { barbeiroId } }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
  });
  const publicadas = respostas.slice(0, quantidadePublicavel(respostas.length));
  if (!publicadas.length) return;
  const totais = resumirNotas(publicadas);
  const porMes = new Map<string, typeof respostas>();
  for (const resposta of respostas) {
    const mes = competenciaResposta(resposta.criadoEm);
    const grupo = porMes.get(mes) ?? [];
    grupo.push(resposta);
    porMes.set(mes, grupo);
  }
  const periodos: Periodos = {};
  for (const [mes, grupo] of porMes) {
    const lote = grupo.slice(0, quantidadePublicavel(grupo.length));
    if (lote.length) periodos[mes] = { quantidade: lote.length, soma: lote.reduce((s, n) => s + n.nota, 0) };
  }
  await tx.avaliacaoResumo.upsert({ where: { barbeiroId },
    create: { barbeiroId, ...totais, periodos }, update: { ...totais, periodos },
  });
  await tx.avaliacaoCliente.updateMany({ where: { id: { in: publicadas.map(r => r.id) }, publicada: false }, data: { publicada: true } });
}

export async function resumoPublicado(barbeiroId: string) {
  const resumo = await db.avaliacaoResumo.findUnique({ where: { barbeiroId } });
  const categorias = (resumo?.categorias ?? {}) as TotaisCategorias;
  return { ...notaPublica(resumo?.quantidade ?? 0, resumo?.soma ?? 0), categorias: CATEGORIAS.map(chave => ({
    chave, media: notaPublica(categorias[chave]?.quantidade ?? 0, categorias[chave]?.soma ?? 0).media,
  })) };
}

/** Não retorna datas de respostas, comentários ou identificação dos clientes. */
export async function resumosPublicados(barbeiroIds?: string[]) {
  const [barbeiros, resumos] = await Promise.all([
    db.barbeiro.findMany({ where: barbeiroIds ? { id: { in: barbeiroIds } } : { ativo: true }, select: { id: true, nome: true }, orderBy: { ordem: "asc" } }),
    db.avaliacaoResumo.findMany({ where: barbeiroIds ? { barbeiroId: { in: barbeiroIds } } : {} }),
  ]);
  const porId = new Map(resumos.map(r => [r.barbeiroId, r]));
  return barbeiros.map(b => {
    const r = porId.get(b.id);
    const c = (r?.categorias ?? {}) as TotaisCategorias;
    return { barbeiroId: b.id, nome: b.nome, ...notaPublica(r?.quantidade ?? 0, r?.soma ?? 0),
      categorias: CATEGORIAS.map(chave => ({ chave, media: notaPublica(c[chave]?.quantidade ?? 0, c[chave]?.soma ?? 0).media })) };
  });
}

export async function resumoAvaliacaoBarbeiro(barbeiroId: string, competencia?: string) {
  const resumo = await db.avaliacaoResumo.findUnique({ where: { barbeiroId } });
  const periodos = (resumo?.periodos ?? {}) as Periodos;
  const valor = competencia ? periodos[competencia] : resumo;
  const { media, quantidade } = notaPublica(valor?.quantidade ?? 0, valor?.soma ?? 0);
  return { media, quantidade, periodo: competencia ?? "GERAL" };
}
