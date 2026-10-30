import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { horarioComercial } from "@/lib/automacoes/regras";
import { notificarCliente } from "@/lib/whatsapp/conversas";
import { temJanela24h } from "@/lib/whatsapp/canal";
import { configRecompras } from "./configuracao";
import { ultimasCompras } from "./historico";
import { chaveAviso, diasDecorridos, podeRecomendar, DIA } from "./regras";

type Ciclo = { servicoId: string; nome: string; ultimaEm: string };
export async function ciclosDoCliente(clienteId: string, agora: number, fuso: string) {
  const [servicos, historico, futuros, ofertas] = await Promise.all([
    db.servico.findMany({ where: { ativo: true, intervaloRecompraDias: { not: null } } }),
    ultimasCompras([clienteId], new Date(agora)),
    db.agendamento.findMany({ where: { clienteId, fim: { gt: new Date(agora) }, status: { in: ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO"] } }, select: { servicoId: true } }),
    db.ofertaRecompra.findMany({ where: { clienteId }, orderBy: { atualizadoEm: "desc" } }),
  ]);
  const ciclos: Ciclo[] = [];
  for (const servico of servicos) {
    const ultima = historico.ultimas.get(`${clienteId}:${servico.id}`);
    if (!ultima || !servico.intervaloRecompraDias) continue;
    const oferta = ofertas.find(o => o.servicoId === servico.id && +o.ultimaEm === +ultima.fim);
    if (podeRecomendar({ dias: diasDecorridos(ultima.fim, dataLocal(agora, fuso), fuso), intervalo: servico.intervaloRecompraDias, agendado: futuros.some(f => f.servicoId === servico.id), estado: oferta?.estado, lembrarEm: oferta?.lembrarEm, agora })) ciclos.push({ servicoId: servico.id, nome: servico.nome, ultimaEm: ultima.fim.toISOString() });
  }
  return ciclos;
}

/** Agrupa servicos num contato e reserva antes de chamar o provedor. Falha incerta nunca e repetida cegamente. */
export async function processarRecompras(agora = Date.now(), opts: { clienteIds?: string[] } = {}) {
  const [politica, cfg] = await Promise.all([configRecompras(), configuracao()]);
  if (!politica.ativo || !politica.whatsapp || !horarioComercial(agora, cfg.fuso)) return 0;
  const clientes = await db.cliente.findMany({ where: { aceitaMensagens: true, ...(opts.clienteIds ? { id: { in: opts.clienteIds } } : {}), agendamentos: { some: { status: "CONCLUIDO", servico: { intervaloRecompraDias: { not: null } } } } }, select: { id: true, nome: true, telefone: true }, orderBy: { id: "asc" } });
  let enviados = 0;
  for (const cliente of clientes) {
    if (enviados >= 15) break;
    const pendente = await db.recompraAviso.findFirst({ where: { clienteId: cliente.id, estado: { in: ["PENDENTE", "FALHOU", "PROCESSANDO", "INCERTO"] } }, orderBy: { criadoEm: "desc" } });
    if (pendente && (["PROCESSANDO", "INCERTO"].includes(pendente.estado) || (pendente.proximaTentativaEm && +pendente.proximaTentativaEm > agora))) continue;
    const ultimo = await db.recompraAviso.findFirst({ where: { clienteId: cliente.id, estado: "ENVIADO" }, orderBy: { enviadoEm: "desc" } });
    if (ultimo?.enviadoEm && agora - +ultimo.enviadoEm < politica.intervaloContatoDias * DIA) continue;
    const ciclos = await ciclosDoCliente(cliente.id, agora, cfg.fuso);
    if (!ciclos.length) {
      if (pendente) await db.recompraAviso.update({ where: { id: pendente.id }, data: { estado: "CANCELADO", erro: "Cliente recomprou, agendou ou suspendeu a sugestão." } });
      continue;
    }
    let aviso = pendente;
    if (!aviso) {
      try {
        aviso = await db.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recompra-contato:${cliente.id}`}))`;
          const aberto = await tx.recompraAviso.findFirst({ where: { clienteId: cliente.id, estado: { in: ["PENDENTE", "FALHOU", "PROCESSANDO", "INCERTO"] } } });
          if (aberto) return aberto;
          const recente = await tx.recompraAviso.findFirst({ where: { clienteId: cliente.id, estado: "ENVIADO", enviadoEm: { gt: new Date(agora - politica.intervaloContatoDias * DIA) } } });
          if (recente) return null;
          return tx.recompraAviso.create({ data: { clienteId: cliente.id, chave: chaveAviso(cliente.id, ciclos, Math.floor(agora / (politica.intervaloContatoDias * DIA))), servicos: ciclos } });
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
    if (!aviso || !["PENDENTE", "FALHOU"].includes(aviso.estado)) continue;
    // Provedor Meta fora da janela: ainda nao houve tentativa externa, pode tentar quando configurado.
    const conversa = await db.conversa.findUnique({ where: { telefone: cliente.telefone }, select: { ultimaEntradaEm: true } });
    if (temJanela24h() && (!conversa?.ultimaEntradaEm || agora - +conversa.ultimaEntradaEm >= DIA) && !process.env.WHATSAPP_TEMPLATE_AVISO) {
      await db.recompraAviso.updateMany({ where: { id: aviso.id, estado: { in: ["PENDENTE", "FALHOU"] } }, data: { estado: "FALHOU", erro: "Configure o modelo de aviso do WhatsApp para contatos fora de 24 horas.", proximaTentativaEm: new Date(agora + 3_600_000) } });
      continue;
    }
    const reservado = await db.recompraAviso.updateMany({ where: { id: aviso.id, estado: { in: ["PENDENTE", "FALHOU"] } }, data: { estado: "PROCESSANDO", tentativas: { increment: 1 }, servicos: ciclos } });
    if (!reservado.count) continue;
    // Reconfere opt-out imediatamente antes do efeito externo.
    if (!(await db.cliente.findUnique({ where: { id: cliente.id }, select: { aceitaMensagens: true } }))?.aceitaMensagens) {
      await db.recompraAviso.update({ where: { id: aviso.id }, data: { estado: "CANCELADO", erro: "Cliente suspendeu as mensagens." } });
      continue;
    }
    const texto = `Olá, ${cliente.nome.split(" ")[0]}! Já está no período de repetir: ${ciclos.map(c => c.nome).join(", ")}. Quer ver um horário na ${cfg.nomeBarbearia}? Se preferir não receber lembretes, responda PARAR.`;
    try {
      const r = await notificarCliente(cliente.telefone, texto);
      await db.recompraAviso.update({ where: { id: aviso.id }, data: { estado: r.ok ? "ENVIADO" : "INCERTO", enviadoEm: r.ok ? new Date(agora) : null, mensagemId: r.mensagemId, erro: r.ok ? null : "Não foi possível confirmar a entrega. Confira o histórico da conversa antes de encerrar o aviso." } });
      if (r.ok) enviados++;
    } catch {
      await db.recompraAviso.update({ where: { id: aviso.id }, data: { estado: "INCERTO", erro: "Resultado do envio desconhecido. Confira a conversa; nenhuma nova tentativa automática será feita." } });
    }
  }
  return enviados;
}
