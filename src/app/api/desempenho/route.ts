import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { avaliarDesempenho } from "@/lib/desempenho/avaliacoes";
import { aprovarBonus } from "@/lib/desempenho/bonus";
import { justificarPresenca, proporAdesao, responderAdesao, salvarPrograma, vincularPessoa } from "@/lib/desempenho/configuracao";
import { painelDesempenho } from "@/lib/desempenho/consultas";
import { marcarPresenca, revisarAjuste, revisarAjustes, solicitarAjuste } from "@/lib/desempenho/presenca";
import { TIPOS_MARCACAO, zCompetencia, zDia, zNotas, zPrograma } from "@/lib/desempenho/schemas";
import { rota } from "@/lib/erros";
import { corpo, parametros, zId, zInstante } from "@/lib/validacao";

export const dynamic = "force-dynamic";

export const GET = rota(async (req: Request) => {
  const s = await exigirSessao();
  const q = parametros(req, z.object({ competencia: zCompetencia.optional(), pessoaId: zId.optional() }));
  return NextResponse.json(await painelDesempenho(s, q.competencia, q.pessoaId));
});

const schema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("marcar"), pessoaId: zId, tipo: z.enum(TIPOS_MARCACAO), chave: z.string().uuid() }),
  z.object({ acao: z.literal("solicitar_ajuste"), pessoaId: zId, marcacaoId: zId.optional(), tipo: z.enum(TIPOS_MARCACAO).optional(), instante: zInstante, motivo: z.string().trim().min(10).max(500) }),
  z.object({ acao: z.literal("revisar_ajuste"), id: zId, aprovar: z.boolean() }),
  z.object({ acao: z.literal("revisar_ajustes"), ids: z.array(zId).min(1).max(20), aprovar: z.boolean() }),
  z.object({ acao: z.literal("justificar"), pessoaId: zId, data: zDia, tipo: z.enum(["FOLGA", "ABONO"]), motivo: z.string().trim().min(10).max(500) }),
  z.object({ acao: z.literal("avaliar"), pessoaId: zId, data: zDia, tipo: z.enum(["DIARIA", "SEMANAL"]), notas: zNotas, comentario: z.string().trim().max(1000) }),
  z.object({ acao: z.literal("programa"), competenciaInicio: zCompetencia, config: zPrograma }),
  z.object({ acao: z.literal("propor_adesao"), pessoaId: zId, inicio: zDia, diasSemana: z.array(z.number().int().min(0).max(6)).min(1).max(7), inicioMin: z.number().int().min(0).max(1439), fimMin: z.number().int().min(1).max(1440) }),
  z.object({ acao: z.literal("aceitar_adesao"), id: zId }),
  z.object({ acao: z.literal("encerrar_adesao"), id: zId }),
  z.object({ acao: z.literal("aprovar_bonus"), pessoaId: zId, competencia: zCompetencia }),
  z.object({ acao: z.literal("vincular"), pessoaId: zId, usuarioId: zId }),
]);

export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(), d = await corpo(req, schema);
  switch (d.acao) {
    case "marcar": return NextResponse.json(await marcarPresenca(s, d));
    case "solicitar_ajuste": return NextResponse.json(await solicitarAjuste(s, d));
    case "revisar_ajuste": return NextResponse.json(await revisarAjuste(s, d));
    case "revisar_ajustes": return NextResponse.json(await revisarAjustes(s, d));
    case "justificar": return NextResponse.json(await justificarPresenca(s, d));
    case "avaliar": return NextResponse.json(await avaliarDesempenho(s, d));
    case "programa": return NextResponse.json(await salvarPrograma(s, d.competenciaInicio, d.config));
    case "propor_adesao": return NextResponse.json(await proporAdesao(s, d));
    case "aceitar_adesao": return NextResponse.json(await responderAdesao(s, d.id, "aceitar"));
    case "encerrar_adesao": return NextResponse.json(await responderAdesao(s, d.id, "encerrar"));
    case "aprovar_bonus": return NextResponse.json(await aprovarBonus(s, d.pessoaId, d.competencia));
    case "vincular": return NextResponse.json(await vincularPessoa(s, d.pessoaId, d.usuarioId));
  }
});
