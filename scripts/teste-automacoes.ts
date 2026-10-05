// Teste de integracao das automacoes (lembretes, falta, pos-atendimento, reativacao, PARAR,
// limite de faltas) contra o banco de DESENVOLVIMENTO, com o WhatsApp em modo simulador.
// Usa uma data em 2031 e so os clientes que ele cria. Rodar: npm run teste:automacoes
process.env.WHATSAPP_PROVIDER = "simulador";

import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { checarFaltas, confirmarPeloCliente } from "@/lib/agenda/cliente";
import { rodarAutomacoes } from "@/lib/automacoes/rotina";
import { receberMensagem } from "@/lib/bot/processar";

const ok = (c: boolean, msg: string) => console.log(`${c ? "OK  " : "FALHOU"} ${msg}`);
const H = 3_600_000;
const D = 24 * H;
const agora = Date.UTC(2031, 2, 5, 15, 0); // quarta 05/03/2031 12:00 em Brasilia
const TELS = ["5511933338001", "5511933338002", "5511933338003", "5511933338004", "5511933338005", "5511933338006"];

async function limpar() {
  const cs = await db.cliente.findMany({ where: { telefone: { in: TELS } }, select: { id: true } });
  const ids = cs.map((c) => c.id);
  await db.automacaoEnviada.deleteMany({ where: { clienteId: { in: ids } } });
  await db.agendamento.deleteMany({ where: { clienteId: { in: ids } } });
  const conversas = await db.conversa.findMany({ where: { telefone: { in: TELS } }, select: { id: true } });
  await db.mensagem.deleteMany({ where: { conversaId: { in: conversas.map((c) => c.id) } } });
  await db.conversa.deleteMany({ where: { telefone: { in: TELS } } });
  await db.cliente.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await limpar();
  const original = await db.configuracao.findUniqueOrThrow({ where: { id: 1 } });
  await db.configuracao.update({
    where: { id: 1 },
    data: { lembreteHorasAntes: 24, lembreteMinutosAntes: 90, avisoFalta: true, posAtendimento: true, linkAvaliacao: "https://g.page/r/teste", reativacaoDias: 30, limiteFaltas: 2, janelaFaltasDias: 60, botAtivo: true, aniversario: true, presenteAniversario: "uma cerveja por nossa conta" },
  });
  try {
    const barbeiro = await db.barbeiro.findFirstOrThrow({ where: { ativo: true } });
    const servico = await db.servico.findFirstOrThrow({ where: { ativo: true } });
    const [c1, c2, c3, c4, c5, c6] = await Promise.all(TELS.map((telefone, i) => db.cliente.create({ data: { telefone, nome: `Auto Teste ${i + 1}` } })));
    await db.cliente.update({ where: { id: c6.id }, data: { dataNascimento: new Date("1990-03-05T00:00:00Z") } });
    await db.cliente.update({ where: { id: c5.id }, data: { aceitaMensagens: false } });
    const ids = [c1, c2, c3, c4, c5, c6].map((c) => c.id);
    const ag = (clienteId: string, inicio: number, status: "MARCADO" | "CONFIRMADO" | "FALTOU" | "CONCLUIDO", criadoEm = agora - 3 * D) =>
      db.agendamento.create({ data: { barbeiroId: barbeiro.id, servicoId: servico.id, clienteId, inicio: new Date(inicio), fim: new Date(inicio + 30 * 60_000), status, origem: "RECEPCAO", precoCentavos: 5000, criadoEm: new Date(criadoEm) } });

    const vespera = await ag(c1.id, agora + 20 * H, "MARCADO");
    await ag(c1.id, agora + 60 * 60_000, "CONFIRMADO");     // proximo
    await ag(c2.id, agora - 3 * H, "FALTOU");                // pos-falta
    await ag(c3.id, agora - 150 * 60_000, "CONCLUIDO");       // agradecimento
    await ag(c4.id, agora - 40 * D, "CONCLUIDO");             // sumido ha 40 dias
    await ag(c5.id, agora + 22 * H, "MARCADO");               // pediu para nao receber

    const r1 = await rodarAutomacoes(agora, { clienteIds: ids });
    ok(r1.lembretes === 2 && r1.faltas === 1 && r1.pos === 1 && r1.reativacao === 1 && r1.aniversario === 1, `primeira rodada: ${JSON.stringify(r1)}`);
    const msgs = await db.mensagem.findMany({ where: { conversa: { telefone: { in: TELS } }, autor: "SISTEMA" }, include: { conversa: { select: { telefone: true } } } });
    const de = (tel: string) => msgs.filter((m) => m.conversa.telefone === tel).map((m) => m.texto);
    ok(de(TELS[0]).some((t) => t.includes("amanhã (quinta, 06/03)") && t.includes("*SIM*")), "véspera: fala 'amanhã' e pede SIM");
    ok(de(TELS[0]).some((t) => t.includes("Daqui a pouco, às 13:00")), "chegando a hora: 13:00");
    ok(de(TELS[1]).some((t) => t.includes("Sentimos sua falta")), "depois da falta oferece remarcar");
    ok(de(TELS[2]).some((t) => t.includes("https://g.page/r/teste")), "agradecimento com link de avaliação");
    ok(de(TELS[3]).some((t) => t.includes("Faz 40 dias") && t.includes("PARAR")), "reativação com opção de PARAR");
    ok(de(TELS[4]).length === 0, "quem pediu para parar não recebe");
    ok(de(TELS[5]).some((t) => t.includes("Feliz aniversário") && t.includes("uma cerveja por nossa conta")), "aniversário com o presente");

    const r2 = await rodarAutomacoes(agora + 5 * 60_000, { clienteIds: ids });
    ok(r2.lembretes + r2.faltas + r2.pos + r2.reativacao + r2.aniversario === 0, "segunda rodada não repete nada");

    await db.agendamento.update({ where: { id: vespera.id }, data: { inicio: new Date(agora + 21 * H), fim: new Date(agora + 21 * H + 30 * 60_000) } });
    const r3 = await rodarAutomacoes(agora + 10 * 60_000, { clienteIds: ids });
    ok(r3.lembretes === 1, "remarcou: lembra de novo o horário novo");

    const noite = Date.UTC(2031, 2, 6, 1, 0); // 22h em Brasilia
    await ag(c3.id, noite + 20 * H, "MARCADO", agora - 5 * D);
    const r4 = await rodarAutomacoes(noite, { clienteIds: ids });
    ok(r4.lembretes === 0, "às 22h a véspera espera o horário comercial");

    const conf = await confirmarPeloCliente(c1.id, vespera.id);
    ok(conf.status === "CONFIRMADO", "cliente confirma pelo lembrete");
    const outro = await db.cliente.findUniqueOrThrow({ where: { id: c2.id } });
    let erroOutro: unknown = null;
    try { await confirmarPeloCliente(outro.id, vespera.id); } catch (e) { erroOutro = e; }
    ok(erroOutro instanceof ErroNegocio, "não confirma horário de outro cliente");

    // limite de faltas: 2 em 60 dias
    await checarFaltas(c2.id, { limiteFaltas: 2, janelaFaltasDias: 60 });
    await ag(c2.id, Date.now() - 5 * D, "FALTOU");
    let erroFaltas: unknown = null;
    try { await checarFaltas(c2.id, { limiteFaltas: 2, janelaFaltasDias: 60 }); } catch (e) { erroFaltas = e; }
    ok(erroFaltas instanceof ErroNegocio && erroFaltas.codigo === "limite_faltas", "2 faltas em 60 dias: só marca com a equipe");

    // PARAR pelo WhatsApp (sem chamar o modelo)
    await receberMensagem({ telefone: TELS[0], texto: "PARAR", wamid: `teste-${Date.now()}` });
    const c1b = await db.cliente.findUniqueOrThrow({ where: { id: c1.id } });
    const resp = await db.mensagem.findFirst({ where: { conversa: { telefone: TELS[0] }, autor: "BOT" }, orderBy: { criadoEm: "desc" } });
    ok(!c1b.aceitaMensagens && !!resp?.texto.includes("Não vou mais mandar"), "PARAR desliga e responde na hora");
  } finally {
    const { id: _id, ...dados } = original;
    void _id;
    await db.configuracao.update({ where: { id: 1 }, data: dados });
    await limpar();
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
