import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { semNomeFolha } from "@/lib/financeiro/regras";
import { criarDespesa, listarDespesas } from "@/lib/financeiro/despesas";
import { corpo } from "@/lib/validacao";
import { zDadosDespesa, zMes } from "@/lib/financeiro/schemas";

export const dynamic = "force-dynamic";

/** Pendentes + pagas no mes (?mes=AAAA-MM), com os totais. */
export const GET = rota(async (req: Request) => {
  const s = await exigirSessao(BALCAO);
  const mes = zMes.parse(new URL(req.url).searchParams.get("mes"));
  const r = await listarDespesas(mes);
  if (await pode(s, "folha")) return NextResponse.json(r);
  // Sem a permissao "folha": o pagamento da folha aparece sem nome nem composicao do salario.
  return NextResponse.json({ ...r, despesas: r.despesas.map((d) => d.categoria === "FOLHA" ? { ...d, descricao: semNomeFolha(d.descricao), fornecedor: null, observacao: null } : d) });
});

export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(BALCAO);
  const b = await corpo(req, zDadosDespesa);
  return NextResponse.json(await criarDespesa(s, b), { status: 201 });
});
