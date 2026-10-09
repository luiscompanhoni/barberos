import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { configuracao } from "@/lib/agenda/carregar";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";

/** Servicos e barbeiros para o cliente escolher (so o que esta ativo). */
export const GET = rota(async () => {
  await exigirCliente();
  const [cfg, servicos] = await Promise.all([
    configuracao(),
    db.servico.findMany({
      where: { ativo: true, barbeiros: { some: { barbeiro: { ativo: true } } } },
      orderBy: [{ ordem: "asc" }, { nome: "asc" }],
      select: {
        id: true, nome: true, duracaoMin: true, precoCentavos: true,
        barbeiros: { where: { barbeiro: { ativo: true } }, select: { barbeiro: { select: { id: true, nome: true, cor: true, fotoVersao: true } } } },
      },
    }),
  ]);
  return NextResponse.json({
    nomeBarbearia: cfg.nomeBarbearia,
    janelaDias: cfg.janelaAgendamentoDias,
    prazoCancelamentoMin: cfg.prazoCancelamentoMin,
    servicos: servicos.map((s) => ({ ...s, barbeiros: s.barbeiros.map((b) => b.barbeiro) })),
  });
});
