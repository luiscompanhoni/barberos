import { minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";
import { db } from "@/lib/db";

/** Só usa visitas concluídas do titular e devolve uma preferência, não o histórico bruto. */
export async function preferenciaDeAtendimento(telefone: string, fuso: string, agora = new Date()) {
  const visitas = await db.agendamento.findMany({
    where: { cliente: { telefone, excluidoEm: null }, status: "CONCLUIDO", adicionalDeId: null, fim: { lte: agora } },
    orderBy: [{ inicio: "desc" }, { id: "desc" }], take: 8,
    select: { inicio: true, barbeiro: { select: { id: true, nome: true, ativo: true } },
      servico: { select: { id: true, nome: true, ativo: true } } },
  });
  const ultima = visitas[0];
  if (!ultima) return { visitas_consideradas: 0 };
  const media = Math.round(visitas.reduce((total, visita) => total + minutosLocal(+visita.inicio, fuso), 0) / visitas.length);
  return {
    visitas_consideradas: visitas.length,
    horario_medio: minParaHhmm(media),
    ultimo_barbeiro: ultima.barbeiro.ativo ? { barbeiro_id: ultima.barbeiro.id, nome: ultima.barbeiro.nome } : null,
    ultimo_servico: ultima.servico.ativo ? { servico_id: ultima.servico.id, nome: ultima.servico.nome } : null,
  };
}
