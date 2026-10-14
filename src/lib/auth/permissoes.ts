/**
 * Permissoes por acao, lidas do banco (matriz que o dono edita em Configuracoes). Regras em permissoes-regras.ts.
 */
import type { Papel } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import {
  CHAVES, configuravel, linhasParaSalvar, PAPEIS_CONFIGURAVEIS, PERMISSOES, permissoesDoPapel, rotuloPermissao,
  type PapelConfiguravel, type Permissao, type Permissoes,
} from "./permissoes-regras";
import { EQUIPE, exigirSessao, type Sessao } from "./sessao";

export type { Permissao, Permissoes };

export async function permissoesDe(papel: Papel): Promise<Permissoes> {
  if (papel === "DONO" || papel === "CLIENTE") return permissoesDoPapel(papel, []);
  return permissoesDoPapel(papel, await db.permissaoPapel.findMany({ where: { papel } }));
}

export async function pode(s: Pick<Sessao, "papel">, p: Permissao) {
  return (await permissoesDe(s.papel))[p];
}

export async function exigirPermissao(s: Pick<Sessao, "papel">, ...ps: Permissao[]) {
  const t = await permissoesDe(s.papel);
  if (!ps.some((p) => t[p])) {
    throw new ErroNegocio(`Seu acesso não permite: ${ps.map(rotuloPermissao).join(" ou ").toLowerCase()}. Fale com o dono.`, 403, "proibido");
  }
}

/** Sessao da equipe que tenha pelo menos uma das permissoes. */
export async function exigirSessaoCom(...ps: Permissao[]): Promise<Sessao> {
  const s = await exigirSessao(EQUIPE);
  await exigirPermissao(s, ...ps);
  return s;
}

/** Telefones de quem pode a acao (ex.: avisar no WhatsApp quem aprova estornos). */
export async function telefonesCom(p: Permissao) {
  const papeis: Papel[] = ["DONO"];
  for (const papel of PAPEIS_CONFIGURAVEIS) if ((await permissoesDe(papel))[p]) papeis.push(papel);
  const us = await db.usuario.findMany({ where: { papel: { in: papeis }, ativo: true }, select: { telefone: true } });
  return us.map((u) => u.telefone);
}

/** Matriz para a tela do dono: cada acao com o valor atual e o padrao por papel. */
export async function matrizPermissoes() {
  const linhas = await db.permissaoPapel.findMany();
  const atual = Object.fromEntries(PAPEIS_CONFIGURAVEIS.map((p) => [p, permissoesDoPapel(p, linhas)])) as Record<PapelConfiguravel, Permissoes>;
  return PERMISSOES.map((d) => ({
    chave: d.chave, rotulo: d.rotulo, detalhe: d.detalhe,
    papeis: Object.fromEntries(PAPEIS_CONFIGURAVEIS.map((p) => [p, configuravel(p, d.chave)
      ? { permitido: atual[p][d.chave], padrao: (d.padrao as readonly string[]).includes(p) }
      : null])) as Record<PapelConfiguravel, { permitido: boolean; padrao: boolean } | null>,
  }));
}

/** Salva a matriz (so o que difere do padrao fica gravado) com antes -> depois na auditoria. */
export async function salvarPermissoes(s: Sessao, matriz: Record<PapelConfiguravel, Partial<Permissoes>>) {
  const { gravar, apagar } = linhasParaSalvar(matriz);
  await db.$transaction(async (tx) => {
    const linhas = await tx.permissaoPapel.findMany();
    const antes = Object.fromEntries(PAPEIS_CONFIGURAVEIS.map((p) => [p, permissoesDoPapel(p, linhas)]));
    for (const a of apagar) await tx.permissaoPapel.deleteMany({ where: a });
    for (const g of gravar) {
      await tx.permissaoPapel.upsert({ where: { papel_permissao: { papel: g.papel, permissao: g.permissao } }, create: g, update: { permitido: g.permitido } });
    }
    const novas = await tx.permissaoPapel.findMany();
    const depois = Object.fromEntries(PAPEIS_CONFIGURAVEIS.map((p) => [p, permissoesDoPapel(p, novas)]));
    // So o que mudou, como "GERENTE.estorno": false -> true.
    const de: Record<string, boolean> = {}, para: Record<string, boolean> = {};
    for (const p of PAPEIS_CONFIGURAVEIS) for (const k of CHAVES) {
      if (antes[p][k] !== depois[p][k]) { de[`${p}.${k}`] = antes[p][k]; para[`${p}.${k}`] = depois[p][k]; }
    }
    if (Object.keys(para).length) await auditar(tx, s.usuarioId, "permissoes", "permissao", "matriz", { antes: de, depois: para });
  });
  return matrizPermissoes();
}
