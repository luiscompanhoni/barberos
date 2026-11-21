import type { Configuracao } from "@prisma/client";
import { db } from "@/lib/db";
import { minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";
import { canalConviteAtivo } from "@/lib/convites/canal";
import { enviarNaConversa } from "@/lib/whatsapp/conversas";
import { temJanela24h, provedorWhatsApp } from "@/lib/whatsapp/canal";
import { naFila } from "@/lib/whatsapp/fila-conversa";
import { acompanhamentoRoletaAtivo, lembreteVesperaRoleta } from "@/lib/jogos/jornada-roleta";
import { enviarLembreteRoleta, registrarLembreteRoleta } from "@/lib/jogos/jornada-roleta-envios";
import { enviarAutomacao as enviar } from "./enviar";
import { horarioComercial, quandoFalar, lembreteDevido, TEXTOS } from "./regras";

export async function lembrarHorarios(agora: number, cfg: Configuracao, clienteIds: string[] | undefined, soConvidados: boolean) {
  if (soConvidados && !await canalConviteAtivo()) return 0;
  let total = 0;
  const comercial = horarioComercial(agora, cfg.fuso);
  const so = clienteIds ? { clienteId: { in: clienteIds } } : {};
  const MIN = 60_000;
  const horizonte = Math.max(24 * 60, cfg.lembreteHorasAntes * 60, cfg.lembreteMinutosAntes) * MIN;
  if (horizonte > 0) {
    const ags = await db.agendamento.findMany({
      where: {
        status: { in: ["MARCADO", "CONFIRMADO"] },
        inicio: { gt: new Date(agora), lte: new Date(agora + horizonte) },
        adicionalDeId: null, cliente: { aceitaMensagens: true, excluidoEm: null,
          ...(soConvidados ? { conversa: { estado: "BOT", recusaAutomaticas: false, jornadaApp: { linkId: { not: null }, parouEm: null } } } : {}) },
        ...so,
      },
      include: { cliente: { select: { nome: true, telefone: true, conversa: { select: { id: true, telefone: true, estado: true, recusaAutomaticas: true, ultimaEntradaEm: true, jornadaApp: { select: { parouEm: true, clienteId: true, link: { select: { criadoEm: true } } } } } } } }, barbeiro: { select: { nome: true } }, servico: { select: { nome: true } },
        jornadaRoleta: { select: { jogadaId: true } } },
    });
    for (const a of ags) {
      const c = a.cliente.conversa, j = c?.jornadaApp;
      const convidado = !!j?.link && !j.parouEm && j.clienteId === a.clienteId && a.criadoEm >= j.link.criadoEm && +a.criadoEm <= +j.link.criadoEm + 30 * 86_400_000;
      if (soConvidados && !convidado) continue;
      const roleta = acompanhamentoRoletaAtivo() && !soConvidados && !!a.jornadaRoleta;
      const tipo = lembreteDevido({ inicio: +a.inicio, criadoEm: +a.criadoEm, status: a.status }, agora, convidado ? { lembreteHorasAntes: 24, lembreteMinutosAntes: 90 } : cfg);
      if (!tipo || ((roleta || tipo === "LEMBRETE_VESPERA") && !comercial)) continue;
      const texto = tipo === "LEMBRETE_VESPERA"
        ? (roleta ? lembreteVesperaRoleta : TEXTOS.LEMBRETE_VESPERA)({ nome: a.cliente.nome, quando: quandoFalar(+a.inicio, agora, cfg.fuso), servico: a.servico.nome, barbeiro: a.barbeiro.nome, barbearia: cfg.nomeBarbearia })
        : TEXTOS.LEMBRETE_PROXIMO({ nome: a.cliente.nome, hora: minParaHhmm(minutosLocal(a.inicio, cfg.fuso)), servico: a.servico.nome, barbeiro: a.barbeiro.nome, endereco: cfg.endereco, confirmaPresenca: a.status === "MARCADO" });
      // Chave com o horario: se remarcar, o lembrete do novo horario sai de novo.
      const envio = { tipo, chave: `${a.id}@${a.inicio.toISOString()}`, clienteId: a.clienteId, agendamentoId: a.id, telefone: a.cliente.telefone, texto };
      if (roleta && (!convidado || !c)) {
        if (await enviarLembreteRoleta(envio, cfg, agora, a.inicio)) total++;
        continue;
      }
      if (!convidado || !c) { if (await enviar(envio)) total++; continue; }
      if (c.estado !== "BOT" || c.recusaAutomaticas || (temJanela24h() && (!c.ultimaEntradaEm || agora - +c.ultimaEntradaEm >= 86_400_000))) continue;
      if (await naFila(c.telefone, () => enviar(envio, async () => {
        const atual = await db.agendamento.findUnique({ where: { id: a.id } });
        if (!atual || +atual.inicio !== +a.inicio || atual.status !== a.status || !await canalConviteAtivo()) throw new Error("Reserva ou canal mudou.");
        const r = await enviarNaConversa(c.id, texto, "SISTEMA", { conviteIndividual: true, pararSeHumano: true });
        if (!r.ok || (!r.wamid && provedorWhatsApp() !== "simulador")) throw new Error("Lembrete sem confirmação do canal.");
        await db.jornadaConviteApp.updateMany({ where: { conversaId: c.id, parouEm: null }, data: {
          lembreteMensagemId: r.mensagemId, lembreteAgendamentoId: a.id, lembreteInicio: a.inicio, proximaEm: null,
        } });
        if (roleta) await registrarLembreteRoleta(a.id, agora);
        return r;
      }))) total++;
    }
  }

  return total;
}
