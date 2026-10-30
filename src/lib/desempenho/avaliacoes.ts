import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, diaSemana, somarDias } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { exigirPessoa, travarCompetencia } from "./acesso";
import { zNotas, type Notas } from "./schemas";

export async function avaliarDesempenho(s: Sessao, d: { pessoaId: string; data: string; tipo: "DIARIA" | "SEMANAL"; notas: Notas; comentario: string }) {
  await exigirPessoa(s, d.pessoaId, { avaliar: true });
  const hoje = dataLocal(Date.now(), (await configuracao()).fuso), notas = zNotas.parse(d.notas);
  if (d.data > hoje) throw new ErroNegocio("A avaliação deve se referir a um dia já iniciado.");
  if (Object.values(notas).some((n) => n <= 2) && d.comentario.trim().length < 10) throw new ErroNegocio("Explique o motivo das notas 1 ou 2 com pelo menos 10 caracteres.");
  const data = d.tipo === "SEMANAL" ? somarDias(d.data, -((diaSemana(d.data) + 6) % 7)) : d.data;
  return db.$transaction(async (tx) => {
    if (d.tipo === "DIARIA") await travarCompetencia(tx, d.pessoaId, data.slice(0, 7));
    else await tx.$queryRaw`SELECT id FROM checklist_pessoas WHERE id = ${d.pessoaId} FOR UPDATE`;
    const chave = { pessoaId: d.pessoaId, data, tipo: d.tipo };
    const antes = await tx.desempenhoAvaliacao.findUnique({ where: { pessoaId_data_tipo: chave } });
    const a = await tx.desempenhoAvaliacao.upsert({ where: { pessoaId_data_tipo: chave }, create: { ...chave, notas, comentario: d.comentario, porId: s.usuarioId }, update: { notas, comentario: d.comentario, porId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "desempenho_avaliar", "desempenho_avaliacao", a.id, { antes: antes ? { notas: antes.notas, comentario: antes.comentario } : null, depois: { ...chave, notas, comentario: d.comentario } });
    return a;
  });
}
