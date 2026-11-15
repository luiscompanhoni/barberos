/** Prévia sem envio: consentimento, duas horas, conclusão e opt-out no banco local. */
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ATRASO_LEMBRETE_MS } from "@/lib/agenda/abandono-regras";
import { cancelarLembreteAgendamento, candidatosLembreteAgendamento, registrarAtividadeAgendamento } from "@/lib/agenda/abandono";

const endereco = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (!["127.0.0.1", "localhost"].includes(endereco.hostname) || !/teste|test|roleta_/i.test(endereco.pathname) ||
    process.env.WHATSAPP_ENVIOS_BLOQUEADOS !== "true") {
  throw new Error("Este teste exige banco local descartável e envios bloqueados.");
}
process.env.LEMBRETE_ABANDONO_PREVIA = "true";
const telefone = "5511933399201";

async function limpar() {
  const cliente = await db.cliente.findUnique({ where: { telefone }, select: { id: true } });
  if (!cliente) return;
  await db.agendamento.deleteMany({ where: { clienteId: cliente.id } });
  await db.cliente.delete({ where: { id: cliente.id } });
}

async function main() {
  await limpar();
  try {
    const cliente = await db.cliente.create({ data: { nome: "Lembrete Teste", telefone } });
    const anterior = new Date(Date.now() - ATRASO_LEMBRETE_MS - 5 * 60_000);
    await registrarAtividadeAgendamento(cliente.id, anterior);
    assert.ok((await candidatosLembreteAgendamento()).includes(cliente.id), "consentimento e duas horas tornam a prévia elegível");
    assert.equal(await db.auditoria.count({ where: { entidade: "lembrete_agendamento", entidadeId: cliente.id, acao: "consentir" } }), 1, "consentimento auditado");

    await registrarAtividadeAgendamento(cliente.id);
    assert.ok(!(await candidatosLembreteAgendamento()).includes(cliente.id), "nova ação reinicia as duas horas");
    await cancelarLembreteAgendamento(cliente.id);
    assert.ok(!(await candidatosLembreteAgendamento()).includes(cliente.id), "desmarcar revoga o consentimento");
    assert.equal(await db.auditoria.count({ where: { entidade: "lembrete_agendamento", entidadeId: cliente.id, acao: "revogar" } }), 1, "revogação auditada");

    await registrarAtividadeAgendamento(cliente.id, anterior);
    const [barbeiro, servico] = await Promise.all([
      db.barbeiro.findFirstOrThrow({ where: { ativo: true } }),
      db.servico.findFirstOrThrow({ where: { ativo: true } }),
    ]);
    const inicio = new Date(Date.now() + 2 * 86_400_000);
    const agendamento = await db.agendamento.create({ data: { clienteId: cliente.id, barbeiroId: barbeiro.id, servicoId: servico.id,
      inicio, fim: new Date(+inicio + servico.duracaoMin * 60_000), status: "MARCADO", origem: "SITE", precoCentavos: servico.precoCentavos } });
    assert.ok(!(await candidatosLembreteAgendamento()).includes(cliente.id), "agendamento concluído impede o lembrete");
    await db.agendamento.update({ where: { id: agendamento.id }, data: { criadoEm: new Date(+anterior - 86_400_000) } });
    assert.ok(!(await candidatosLembreteAgendamento()).includes(cliente.id), "horário futuro anterior ao consentimento também impede o lembrete");

    await db.cliente.update({ where: { id: cliente.id }, data: { aceitaMensagens: false } });
    await assert.rejects(registrarAtividadeAgendamento(cliente.id));
    assert.ok(!(await candidatosLembreteAgendamento()).includes(cliente.id), "opt-out prevalece");
    console.log("OK prévia de abandono: consentimento, 2 horas, atividade nova, revogação, agendamento e opt-out; nenhum envio");
  } finally {
    await limpar();
    await db.$disconnect();
  }
}

main().catch(erro => { console.error(erro); process.exitCode = 1; });
