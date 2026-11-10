import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { configuracao } from "@/lib/agenda/carregar";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { contatoParaConfirmacao } from "@/lib/agenda/transicao";
import { antecipadoDisponivel } from "@/lib/agenda/antecipado";
import { checkoutProprio } from "@/lib/pagamentos/checkout";
import { etiquetasDoServico } from "@/lib/servicos/etiquetas";

/** Servicos e barbeiros para o cliente escolher (so o que esta ativo). */
export const GET = rota(async () => {
  await exigirCliente();
  const [cfg, servicos] = await Promise.all([
    configuracao(),
    db.servico.findMany({
      where: { ativo: true, barbeiros: { some: { barbeiro: { ativo: true } } } },
      orderBy: [{ ordem: "asc" }, { nome: "asc" }],
      select: {
        id: true, nome: true, duracaoMin: true, precoCentavos: true, etiquetas: true,
        barbeiros: { where: { barbeiro: { ativo: true } }, select: { barbeiro: { select: { id: true, nome: true, cor: true, fotoVersao: true } } } },
      },
    }),
  ]);
  return NextResponse.json({
    nomeBarbearia: cfg.nomeBarbearia,
    // O app confirma na agenda local; o modo legado continua valendo para o bot.
    confirmacaoEquipe: false,
    atendimentoUrl: contatoParaConfirmacao(process.env.WHATSAPP_NUMERO_PUBLICO),
    janelaDias: cfg.janelaAgendamentoDias,
    pagarAntes: await antecipadoDisponivel(),
    checkout: checkoutProprio(),
    prazoCancelamentoMin: cfg.prazoCancelamentoMin,
    servicos: servicos.map((s) => ({ ...s, etiquetas: etiquetasDoServico(s.etiquetas), barbeiros: s.barbeiros.map((b) => b.barbeiro) })),
  });
});
