import { lembreteAgendamentoDevido } from "@/lib/agenda/abandono-regras";
import { minutosLocal } from "@/lib/agenda/tempo";
import { db } from "@/lib/db";
import { enviarNaConversa } from "@/lib/whatsapp/conversas";
import { naFila } from "@/lib/whatsapp/fila-conversa";
import { temJanela24h, provedorWhatsApp } from "@/lib/whatsapp/canal";
import { telefoneCanonico } from "@/lib/whatsapp/webhook";
import { canalConviteAtivo } from "./canal";

const DIA = 86_400_000;
const HORA = DIA / 24;

function carregar(id: string) {
  return db.jornadaConviteApp.findUnique({ where: { conversaId: id }, include: {
    abertura: { select: { erro: true, lidaEm: true } }, link: { select: { erro: true, lidaEm: true, criadoEm: true } },
    conversa: { select: { telefone: true, waId: true, estado: true, recusaAutomaticas: true, ultimaEntradaEm: true, conviteApp: true,
      cliente: { select: { id: true, telefone: true, nome: true, aceitaMensagens: true, excluidoEm: true } } } },
  } });
}
type Jornada = NonNullable<Awaited<ReturnType<typeof carregar>>>;

function textoAjuda(j: Jornada) {
  const nome = j.conversa.cliente!.nome.trim().split(/\s+/)[0];
  if (j.retomadas === 2) return "Vou deixar contigo. Quando quiser ajuda com o app ou com um horário, é só chamar a Black por aqui.";
  if (j.agendaEm || j.entrouEm) return j.retomadas === 0
    ? "Quer uma mão pra achar um horário? Pode me dizer o serviço e o dia que tu prefere."
    : "Se ficou alguma dúvida na hora de marcar, posso te ajudar por aqui.";
  if (j.loginEm) return j.retomadas === 0
    ? "Conseguiu entrar no app? Se travou em alguma tela, me diz o que apareceu que eu te ajudo."
    : "Se ainda precisar de ajuda pra entrar, me chama aqui. A gente vê isso junto.";
  if (j.clicouEm || j.instalouEm || j.link?.lidaEm) return j.retomadas === 0
    ? "Conseguiu abrir o app da Black? Se quiser, te ajudo a colocar ele na tela inicial do celular."
    : "Ficou alguma dúvida sobre o aplicativo? Me diz se tu usa Android ou iPhone que eu te ajudo.";
  if (j.link) return "Oi! O link do app chegou por aí? Se precisar de ajuda, tô por aqui.";
  if (j.retomadas) return "Quando tiver um minutinho, me dá um oi por aqui. Posso te ajudar com o app da Black.";
  return j.abertura?.lidaEm ? `${nome}, tudo certo? Posso te explicar a mudança do app da Black por aqui?`
    : `Oi, ${nome}! Aqui é o Leonel. Quando puder, me dá um oi?`;
}

async function retomar(id: string, agora: number) {
  const j = await carregar(id);
  if (!j?.proximaEm || +j.proximaEm > agora || j.parouEm || j.retomadas >= 3) return false;
  const c = j.conversa, cliente = c.cliente;
  const parar = () => db.jornadaConviteApp.updateMany({ where: { conversaId: id, proximaEm: j.proximaEm }, data: { proximaEm: null } });
  if (!cliente || cliente.id !== j.clienteId || cliente.telefone !== c.telefone || c.estado !== "BOT" || c.recusaAutomaticas ||
    !cliente.aceitaMensagens || cliente.excluidoEm || (c.waId && telefoneCanonico(c.waId) !== c.telefone) ||
    !j.abertura || j.abertura.erro || j.link?.erro || agora - +j.inicioEm > 14 * DIA ||
    (!j.link && (c.conviteApp !== "AGUARDANDO" || j.respostaEm)) ||
    (j.link && c.ultimaEntradaEm && c.ultimaEntradaEm > j.link.criadoEm)) { await parar(); return false; }
  if (j.agendaEm) {
    const preferencia = await db.lembreteAgendamento.findUnique({ where: { clienteId: j.clienteId } });
    if (!preferencia || !lembreteAgendamentoDevido(preferencia, agora)) {
      if (preferencia && !preferencia.canceladoEm && +preferencia.ultimaAcaoEm + 2 * HORA > agora) return false;
      await parar();
      return false;
    }
  }
  const [reserva, pedido] = await Promise.all([
    db.agendamento.findFirst({ where: { clienteId: cliente.id, status: { notIn: ["CANCELADO", "FALTOU"] },
      OR: [{ inicio: { gte: new Date(agora) } }, { inicio: { gte: j.inicioEm }, status: { in: ["CHEGOU", "EM_ATENDIMENTO", "CONCLUIDO"] } }] }, select: { id: true } }),
    db.pedidoAgendamento.findFirst({ where: { clienteId: cliente.id, status: "PENDENTE" }, select: { id: true } }),
  ]);
  if (reserva || pedido || (temJanela24h() && (!c.ultimaEntradaEm || agora - +c.ultimaEntradaEm >= DIA))) { await parar(); return false; }
  // Dá tempo de concluir a etapa recém-aberta no navegador antes de oferecer ajuda.
  const ultimaVisita = Math.max(...[j.clicouEm, j.loginEm, j.entrouEm, j.agendaEm, j.instalouEm].map(d => d?.getTime() ?? 0));
  if (!j.agendaEm && ultimaVisita + 4 * HORA > agora) {
    await db.jornadaConviteApp.updateMany({ where: { conversaId: id, proximaEm: j.proximaEm }, data: { proximaEm: new Date(ultimaVisita + 4 * HORA) } });
    return false;
  }
  if (!await canalConviteAtivo()) return false;
  const reservaEnvio = await db.jornadaConviteApp.updateMany({ where: { conversaId: id, parouEm: null, proximaEm: j.proximaEm,
    retomadas: j.retomadas, respostaEm: j.respostaEm, linkId: j.linkId, loginEm: j.loginEm, agendaEm: j.agendaEm,
    conversa: { estado: "BOT", clienteId: j.clienteId, recusaAutomaticas: false, ultimaEntradaEm: c.ultimaEntradaEm } },
    data: { retomadas: { increment: 1 }, ultimaRetomadaEm: new Date(agora), proximaEm: null } });
  if (!reservaEnvio.count) return false;
  const r = await enviarNaConversa(id, textoAjuda(j), "BOT", { pararSeHumano: true, conviteIndividual: true });
  if (!r.ok || (!r.wamid && provedorWhatsApp() !== "simulador")) return false;
  if (!j.agendaEm && j.retomadas < 2) await db.jornadaConviteApp.updateMany({ where: { conversaId: id, parouEm: null, respostaEm: j.respostaEm, proximaEm: null },
    data: { proximaEm: new Date(agora + (j.retomadas === 0 ? 2 : 4) * DIA) } });
  return true;
}

export async function rodarRetomadas(agora: number, fuso: string, clienteIds?: string[]) {
  const minuto = minutosLocal(agora, fuso);
  if (minuto < 9 * 60 || minuto >= 18 * 60 || !await canalConviteAtivo()) return 0;
  const devidos = await db.jornadaConviteApp.findMany({ where: { parouEm: null, proximaEm: { lte: new Date(agora) },
    ...(clienteIds ? { clienteId: { in: clienteIds } } : {}) }, orderBy: { proximaEm: "asc" }, take: 30,
    select: { conversaId: true, conversa: { select: { telefone: true } } } });
  let enviadas = 0;
  for (const j of devidos) if (await naFila(j.conversa.telefone, () => retomar(j.conversaId, agora))) enviadas++;
  return enviadas;
}
