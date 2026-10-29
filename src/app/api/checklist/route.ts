import { NextResponse } from "next/server";
import { z } from "zod";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { cadastro, salvarCadastro } from "@/lib/checklist/servico";
import { rota } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";
const zFuncao = z.enum(["DIARISTA", "BARBEIRO", "GERENTE"]);
const zHora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Pessoas, tarefas e horarios do checklist. */
export const GET = rota(async () => {
  await exigirSessao(BALCAO);
  return NextResponse.json(await cadastro());
});

export const PUT = rota(async (req: Request) => {
  const s = await exigirSessao(BALCAO);
  const b = await corpo(req, z.object({
    config: z.object({
      ativo: z.boolean(), horaEnvio: zHora, horaResumo: zHora,
      pontosRe: z.number().int().min(0).max(10000).optional(),
      nivelPlatina: z.number().int().min(1).max(1_000_000).optional(),
      nivelLegend: z.number().int().min(2).max(1_000_000).optional(),
    }),
    pessoas: z.array(z.object({
      id: z.string().optional(),
      nome: z.string().trim().min(2).max(60),
      funcao: zFuncao,
      ativo: z.boolean(),
      telefone: z.string().max(30).transform((t, ctx) => {
        const n = normalizarTelefone(t);
        if (!n) ctx.addIssue({ code: "custom", message: `Telefone inválido: ${t}` });
        return n ?? "";
      }),
    })).max(50),
    tarefas: z.array(z.object({
      id: z.string().optional(),
      titulo: z.string().trim().min(2).max(120),
      funcao: zFuncao,
      diasSemana: z.array(z.number().int().min(0).max(6)).max(7),
      horario: zHora.nullable(),
      pontos: z.number().int().min(0).max(10000).optional(),
      ativo: z.boolean(),
    })).max(200),
    confirmarFaixas: z.boolean().optional(),
  }));
  return NextResponse.json(await salvarCadastro(s, b));
});
