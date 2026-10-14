import { NextResponse } from "next/server";
import { configuracao } from "@/lib/agenda/carregar";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { indicadoresDeAssinaturas, indicadoresDoBar } from "@/lib/indicadores/assinaturas-bar";
import { rankingDaEquipe } from "@/lib/indicadores/barbeiro";
import { gerarLeituras } from "@/lib/indicadores/leituras";
import { indicadoresDoNegocio } from "@/lib/indicadores/negocio";
import { resolverPeriodo } from "@/lib/indicadores/periodo";

/** Indicadores do negocio no periodo (?periodo=7d|30d|mes|mes_passado|90d|ano). So o dono. */
export const GET = rota(async (req: Request) => {
  await exigirSessaoCom("resultado");
  const cfg = await configuracao();
  const p = resolverPeriodo(new URL(req.url).searchParams.get("periodo"), cfg.fuso);
  const [negocio, assinaturas, equipe] = await Promise.all([indicadoresDoNegocio(p), indicadoresDeAssinaturas(p), rankingDaEquipe(p)]);
  const bar = await indicadoresDoBar(p, negocio.atual.atendimentos);
  const leituras = gerarLeituras({
    ocupacao: equipe.total,
    porDiaSemana: equipe.porDiaSemana,
    taxaFalta: negocio.agenda.taxaFalta,
    retorno: negocio.clientes.retorno,
    base: negocio.clientes.base,
    assinaturas,
    idade: negocio.clientes.idade,
    origens: negocio.clientes.origens,
    novos: negocio.clientes.novos,
    bar,
    atendimentos: negocio.atual.atendimentos,
    automacoes: cfg,
  });
  return NextResponse.json({ periodo: { chave: p.chave, rotulo: p.rotulo, de: p.de, ate: p.ate, dias: p.dias.length }, negocio, assinaturas, bar, equipe, leituras });
});
