import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { precificar } from "@/lib/assinaturas/agenda";
import { configuracao, servicoDoBarbeiro } from "@/lib/agenda/carregar";
import { ErroNegocio, rota } from "@/lib/erros";
import { parametros, zId, zInstante } from "@/lib/validacao";

/**
 * Previa do preco antes de confirmar: incluso no plano, com desconto de
 * assinante ou bloqueado pela regra do plano (com o preco avulso).
 */
export const GET = rota(async (req: Request) => {
  const s = await exigirCliente();
  const q = parametros(req, z.object({ servicoId: zId, barbeiroId: zId, inicio: zInstante, remarcar: zId.optional() }));
  const sb = await servicoDoBarbeiro(q.barbeiroId, q.servicoId);
  if (!sb) throw new ErroNegocio("Esse barbeiro não faz esse serviço.");
  const cfg = await configuracao();
  try {
    const p = await precificar({
      clienteId: s.clienteId, servicoId: q.servicoId, barbeiroId: q.barbeiroId, inicio: q.inicio.getTime(),
      precoBase: sb.precoCentavos, fuso: cfg.fuso, ignorarAgendamentoId: q.remarcar,
    });
    return NextResponse.json({ precoCentavos: p.precoCentavos, peloPlano: p.assinaturaId !== null, nota: p.nota, bloqueio: null });
  } catch (e) {
    if (e instanceof ErroNegocio && e.codigo === "regra_plano") {
      const d = e.detalhes as { precoAvulso: number };
      return NextResponse.json({ precoCentavos: d.precoAvulso, peloPlano: false, nota: null, bloqueio: e.message });
    }
    throw e;
  }
});
