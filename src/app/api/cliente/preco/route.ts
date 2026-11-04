import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { precificar } from "@/lib/assinaturas/agenda";
import { configuracao, servicoDoBarbeiro } from "@/lib/agenda/carregar";
import { ErroNegocio, rota } from "@/lib/erros";
import { parametros, zId, zInstante } from "@/lib/validacao";
import { db } from "@/lib/db";

/**
 * Previa do preco antes de confirmar: incluso no plano, com desconto de
 * assinante ou bloqueado pela regra do plano (com o preco avulso).
 */
export const GET = rota(async (req: Request) => {
  const s = await exigirCliente();
  const q = parametros(req, z.object({ servicoId: zId, barbeiroId: zId, inicio: zInstante, remarcar: zId.optional(), adicionais: z.string().max(409).optional() }));
  const ids = [q.servicoId, ...(q.adicionais ? z.array(zId).max(9).parse(q.adicionais.split(",")) : [])];
  if (new Set(ids).size !== ids.length) throw new ErroNegocio("Selecione serviços diferentes.");
  const ag = q.remarcar ? await db.agendamento.findFirst({ where: { id: q.remarcar, clienteId: s.clienteId, adicionalDeId: null }, include: { adicionais: { where: { origem: "SITE", status: { not: "CANCELADO" } }, orderBy: { inicio: "asc" } } } }) : null;
  if (q.remarcar && (!ag || JSON.stringify(ids) !== JSON.stringify([ag.servicoId, ...ag.adicionais.map((a) => a.servicoId)]))) throw new ErroNegocio("Os serviços do agendamento não coincidem.", 409);
  const ignorar = ag ? [ag.id, ...ag.adicionais.map((a) => a.id)] : [];
  const cfg = await configuracao();
  const usosExtras: { id: string; inicio: number; servicoId: string; futuro: boolean }[] = [];
  let inicio = q.inicio.getTime();
  let precoCentavos = 0;
  let peloPlano = true;
  let bloqueio: string | null = null;
  let nota: string | null = null;
  for (const id of ids) {
    const sb = await servicoDoBarbeiro(q.barbeiroId, id);
    if (!sb) throw new ErroNegocio("Esse barbeiro não faz todos os serviços selecionados.");
    try {
      const p = await precificar({ clienteId: s.clienteId, servicoId: id, barbeiroId: q.barbeiroId, inicio,
        precoBase: sb.precoCentavos, fuso: cfg.fuso, ignorarAgendamentoIds: ignorar, usosExtras });
      precoCentavos += p.precoCentavos;
      if (p.assinaturaId) usosExtras.push({ id: `previa-${id}`, inicio, servicoId: id, futuro: inicio > Date.now() });
      else peloPlano = false;
      nota ??= p.nota;
    } catch (e) {
      if (!(e instanceof ErroNegocio) || e.codigo !== "regra_plano") throw e;
      precoCentavos += (e.detalhes as { precoAvulso: number }).precoAvulso;
      peloPlano = false;
      bloqueio ??= e.message;
    }
    inicio += sb.duracaoMin * 60_000;
  }
  return NextResponse.json({ precoCentavos, peloPlano, nota: ids.length === 1 ? nota : null, bloqueio });
});
