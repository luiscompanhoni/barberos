import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { configuracao } from "@/lib/agenda/carregar";
import { horariosDisponiveis } from "@/lib/agenda/consultas";
import { dataLocal, somarDias } from "@/lib/agenda/tempo";
import { ErroNegocio, naoEncontrado, rota } from "@/lib/erros";
import { db } from "@/lib/db";
import { parametros, zData, zId } from "@/lib/validacao";

export const GET = rota(async (req: Request) => {
  const s = await exigirCliente();
  const q = parametros(req, z.object({ data: zData, servicoId: zId, barbeiroId: zId.optional(), adicionais: z.string().max(409).optional(), remarcar: zId.optional() }));
  const servicosAdicionais = q.adicionais ? z.array(zId).max(9).parse(q.adicionais.split(",")) : [];
  if (new Set([q.servicoId, ...servicosAdicionais]).size !== servicosAdicionais.length + 1) return NextResponse.json([], { status: 400 });
  const cfg = await configuracao();
  const hoje = dataLocal(Date.now(), cfg.fuso);
  if (q.data < hoje || q.data > somarDias(hoje, cfg.janelaAgendamentoDias)) return NextResponse.json([]);
  if (q.remarcar) {
    const ag = await db.agendamento.findFirst({ where: { id: q.remarcar, clienteId: s.clienteId, adicionalDeId: null, status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date() } }, include: { adicionais: { where: { origem: "SITE", status: { not: "CANCELADO" } }, orderBy: { inicio: "asc" } } } });
    if (!ag) throw naoEncontrado("Agendamento");
    if (JSON.stringify([ag.servicoId, ...ag.adicionais.map(a => a.servicoId)]) !== JSON.stringify([q.servicoId, ...servicosAdicionais])) throw new ErroNegocio("Os serviços do agendamento não coincidem.", 409);
  }
  return NextResponse.json(await horariosDisponiveis({ ...q, servicosAdicionais, paraCliente: true, ignorarAgendamentoId: q.remarcar,
    app: { clienteId: s.clienteId, titular: { usuarioId: s.usuarioId, sessaoVersao: s.sessaoVersao ?? 0 } } }));
});
