// Fluxos de agenda em banco local: cria dados próprios e remove no finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { alterarAgendamento, criarAgendamento } from "@/lib/agenda/agendamentos";
import { fecharAgenda, salvarExcecao, salvarExpediente } from "@/lib/agenda/expediente";
import { horariosDisponiveis } from "@/lib/agenda/consultas";
import { configuracao } from "@/lib/agenda/carregar";
import { salvarConfiguracaoOperacional } from "@/lib/agenda/configuracao-operacional";
import { dataLocal, diaSemana, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import type { Sessao } from "@/lib/auth/sessao";

const url = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Teste permitido somente em banco local.");
const tag = `agenda-${randomUUID()}`;
const usuarios: string[] = [], barbeiros: string[] = [];
let servicoId = "", cadeiraId = "", clienteId = "";
const ok = (nome: string) => console.log(`OK ${nome}`);

async function main() {
  const cfg = await configuracao();
  const data = somarDias(dataLocal(Date.now(), cfg.fuso), 2);
  const hora = (minutos: number) => new Date(instanteLocal(data, minutos, cfg.fuso));
  const u = await db.usuario.create({ data: { nome: tag, telefone: `${tag}-dono`, papel: "DONO" } }); usuarios.push(u.id);
  const dono: Sessao = { usuarioId: u.id, nome: tag, papel: "DONO", barbeiroId: null, clienteId: null };
  const cadeira = await db.cadeira.create({ data: { nome: tag } }); cadeiraId = cadeira.id;
  const servico = await db.servico.create({ data: { nome: tag, duracaoMin: 30, minimoDuracaoMin: 20, precoCentavos: 6500 } }); servicoId = servico.id;
  const cliente = await db.cliente.create({ data: { nome: tag, telefone: `${tag}-cliente` } }); clienteId = cliente.id;
  for (let n = 0; n < 2; n++) {
    const b = await db.barbeiro.create({ data: { nome: `${tag}-${n}`, cadeira: { connect: { id: cadeiraId } }, usuario: { create: { nome: `${tag}-${n}`, telefone: `${tag}-${n}`, papel: "BARBEIRO" } }, servicos: { create: { servicoId } }, expediente: { create: { diaSemana: diaSemana(data), inicioMin: 480, fimMin: 1200 } } } });
    usuarios.push(b.usuarioId); barbeiros.push(b.id);
  }
  const parceiro: Sessao = { usuarioId: usuarios[1], nome: tag, papel: "BARBEIRO", barbeiroId: barbeiros[0], clienteId: null };
  const criar = (barbeiroId: string, min: number, duracaoMin = 30, ator = dono) => criarAgendamento({ barbeiroId, servicoId, inicio: hora(min), duracaoMin, origem: "PAINEL", cliente: { id: clienteId } }, ator);
  await assert.rejects(criar(barbeiros[0], 540, 10), /duração/); ok("duração mínima de serviço aplicada na criação");
  const ag = await criar(barbeiros[0], 540);
  assert.equal(ag.cadeiraId, cadeiraId); ok("cadeira padrão atribuída sem alterar preço");
  const alterado = await alterarAgendamento(ag.id, { fim: hora(560), motivo: "Encaixe de teste" }, dono);
  assert.equal(alterado.precoCentavos, 6500); assert.equal(+alterado.fim - +alterado.inicio, 20 * 60_000); ok("reduzir duração mantém valor do atendimento");
  const servicoDepois = await db.servico.findUniqueOrThrow({ where: { id: servicoId } }); assert.equal(servicoDepois.duracaoMin, 30); ok("duração padrão do catálogo permanece");
  await db.permissaoUsuario.createMany({ data: ["duracao", "bloquear_agenda"].map(permissao => ({ usuarioId: parceiro.usuarioId, permissao, permitido: false })) });
  await assert.rejects(alterarAgendamento(ag.id, { fim: hora(565) }, parceiro), /acesso não permite/); ok("permissão individual impede alterar duração");
  await assert.rejects(criar(barbeiros[0], 600, 20, parceiro), /acesso não permite/); ok("criação personalizada não contorna permissão");
  await assert.rejects(fecharAgenda(barbeiros[0], { inicio: hora(600), fim: hora(620), motivo: "Teste", confirmar: true }, parceiro), /acesso não permite/); ok("parceiro sem permissão não bloqueia");
  await assert.rejects(salvarExcecao(barbeiros[0], { data, tipo: "FOLGA" }, parceiro), /acesso não permite/); ok("folga não contorna bloqueio negado");
  await assert.rejects(salvarExpediente(barbeiros[0], [], parceiro), /acesso não permite/); ok("expediente não contorna bloqueio negado");
  await assert.rejects(salvarConfiguracaoOperacional(dono, { tipo: "minimo", servicoId, minutos: 40 }), /mínimo/); ok("mínimo não pode superar duração padrão");
  const disponivel = await horariosDisponiveis({ data, servicoId, barbeiroId: barbeiros[1], paraCliente: true });
  assert(!disponivel[0].horarios.includes(hora(540).toISOString())); ok("cliente não recebe horário de cadeira ocupada por outro profissional");
  const corrida = await Promise.allSettled([criar(barbeiros[0], 660), criar(barbeiros[1], 660)]);
  assert.equal(corrida.filter(r => r.status === "fulfilled").length, 1); ok("duas reservas concorrentes na mesma cadeira: apenas uma aceita");
  const bloqueioCorrida = await Promise.allSettled([
    criar(barbeiros[0], 780),
    fecharAgenda(barbeiros[0], { inicio: hora(780), fim: hora(810), motivo: "Teste concorrente", confirmar: true }, dono),
  ]);
  assert.equal(bloqueioCorrida.filter(r => r.status === "fulfilled").length, 1); ok("bloquear e agendar concorrentes não produzem sobreposição");
  await db.agendamento.update({ where: { id: ag.id }, data: { status: "CONCLUIDO" } });
  await assert.rejects(alterarAgendamento(ag.id, { fim: hora(570) }, dono), /concluído/); ok("atendimento concluído não é redimensionado");
  const audit = await db.auditoria.findFirst({ where: { entidadeId: ag.id, acao: "alterar" } });
  assert(audit?.dados); ok("ajuste tem histórico auditável");
}

main().catch(e => { console.error(e instanceof Error ? e.message : "Falha no teste de agenda"); process.exitCode = 1; }).finally(async () => {
  await db.agendamento.deleteMany({ where: { barbeiroId: { in: barbeiros } } });
  await db.bloqueio.deleteMany({ where: { barbeiroId: { in: barbeiros } } });
  await db.expedientePadrao.deleteMany({ where: { barbeiroId: { in: barbeiros } } });
  await db.barbeiroServico.deleteMany({ where: { barbeiroId: { in: barbeiros } } });
  await db.barbeiro.deleteMany({ where: { id: { in: barbeiros } } });
  await db.permissaoUsuario.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await db.usuario.deleteMany({ where: { id: { in: usuarios } } });
  if (servicoId) await db.servico.delete({ where: { id: servicoId } });
  if (cadeiraId) await db.cadeira.delete({ where: { id: cadeiraId } });
  if (clienteId) await db.cliente.delete({ where: { id: clienteId } });
  await db.$disconnect();
});
