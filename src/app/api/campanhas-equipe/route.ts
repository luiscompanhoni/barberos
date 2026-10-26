import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, proibido, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { configuracao } from "@/lib/agenda/carregar";
import { lancarBonusNaFolha, painelCampanhas, pessoaDaFolha, vendasDaCampanha } from "@/lib/campanha-equipe";
import { auditar } from "@/lib/auditoria";

export const dynamic = "force-dynamic";
export const GET = rota(async () => {
  const s = await exigirSessao();
  return NextResponse.json(await painelCampanhas(s.barbeiroId, GESTAO.includes(s.papel)), { headers: { "Cache-Control": "private, no-store" } });
});
const valor = z.number().int().min(1).max(100_000);
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao();
  const b = await corpo(req, z.discriminatedUnion("acao", [
    z.object({ acao: z.literal("criar"), nome: z.string().trim().min(3).max(100), inicio: z.iso.datetime(), fim: z.iso.datetime(), metaQuantidade: z.number().int().min(1).max(10000), metaCentavos: z.number().int().min(0).max(100_000_000), premios: z.array(valor).min(1).max(12) }),
    z.object({ acao: z.literal("girar"), campanhaId: z.string().min(1).max(40) }),
  ]));
  if (b.acao === "criar") {
    if (!GESTAO.includes(s.papel)) throw proibido();
    if (Date.parse(b.fim) <= Date.parse(b.inicio) || Date.parse(b.fim) <= Date.now()) throw new ErroNegocio("Informe um período válido e ainda não encerrado.");
    return NextResponse.json(await db.$transaction(async tx => {
      const c = await tx.campanhaEquipe.create({ data: { nome: b.nome, inicio: new Date(b.inicio), fim: new Date(b.fim), metaQuantidade: b.metaQuantidade, metaCentavos: b.metaCentavos, premios: b.premios, criadoPorId: s.usuarioId } });
      await auditar(tx, s.usuarioId, "criar", "campanha_equipe", c.id, { metaQuantidade: b.metaQuantidade, metaCentavos: b.metaCentavos, premios: b.premios });
      return c;
    }), { status: 201 });
  }
  if (!s.barbeiroId) throw proibido();
  const barbeiroId = s.barbeiroId;
  const { fuso } = await configuracao();
  return NextResponse.json(await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM campanhas_equipe WHERE id = ${b.campanhaId} FOR UPDATE`;
    const c = await tx.campanhaEquipe.findUniqueOrThrow({ where: { id: b.campanhaId } });
    if (+c.inicio > Date.now()) throw new ErroNegocio("A campanha ainda não começou.");
    const vendas = await vendasDaCampanha(tx, c, barbeiroId);
    const usados = await tx.bonusEquipe.count({ where: { campanhaId: c.id, barbeiroId } });
    if (usados >= vendas.ciclos) throw new ErroNegocio("Complete mais uma meta de vendas para liberar sua próxima rodada.");
    const premios = z.array(valor).min(1).parse(c.premios);
    const pessoaId = await pessoaDaFolha(tx, barbeiroId);
    const ciclo = usados + 1, valorCentavos = premios[randomInt(premios.length)];
    const folha = await lancarBonusNaFolha(tx, { pessoaId, valorCentavos, descricao: `Bônus da campanha ${c.nome} (rodada ${ciclo})`, porId: s.usuarioId, fuso });
    const bonus = await tx.bonusEquipe.create({ data: { campanhaId: c.id, barbeiroId, ciclo, valorCentavos, folhaLancamentoId: folha.id } });
    await auditar(tx, s.usuarioId, "sortear_bonus", "campanha_equipe", c.id, { barbeiroId, ciclo, bonusId: bonus.id, valorCentavos, folhaLancamentoId: folha.id, competencia: folha.competencia });
    await auditar(tx, s.usuarioId, "rh_lancamento", "folha_lancamento", folha.id, { pessoaId, competencia: folha.competencia, tipo: "BONUS", valorCentavos, origem: "campanha_equipe" });
    return bonus;
  }));
});
