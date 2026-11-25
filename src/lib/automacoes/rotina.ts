/**
 * Mensagens automaticas (roda a cada 5 min no servidor):
 * lembretes, aviso depois da falta, agradecimento pos-atendimento e reativacao de sumidos.
 * Cada envio grava antes uma linha unica (tipo + chave): nada sai duas vezes.
 */
import { rodarRetomadas } from "@/lib/convites/retomadas";
import { lembrarHorarios } from "./lembrar-horarios";
import { recursoPiloto } from "@/lib/whatsapp/piloto-regras";
import { sincronizarDisponibilidadeAtendimento } from "@/lib/whatsapp/disponibilidade-atendimento";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";
import { apagarCandidaturasVencidas } from "@/lib/recrutamento/servico";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";
import { processarCampanhas } from "@/lib/campanhas/servico";
import { loteAutorizadoConfigurado } from "@/lib/campanhas/lote-autorizado";
import { db } from "@/lib/db";
import { processarConvitesAvaliacao } from "@/lib/avaliacoes/automacao";
import { processarRecompras } from "@/lib/recompras/rotina";
import { gerarNotificacoes } from "@/lib/notificacoes/geracao";
import { processarPush } from "@/lib/notificacoes/envio";
import { atualizarPremios } from "@/lib/jogos/premios";
import { acompanhamentoRoletaAtivo } from "@/lib/jogos/jornada-roleta";
import { registrarAbandonosRoleta, rodarNudgesRoleta, rodarPosRoleta } from "@/lib/jogos/jornada-roleta-rotina";
import { sincronizarRecentes } from "@/lib/conciliacao/celcash";
import { processarEsperas, processarIndicacoes, processarRetornos } from "@/lib/crescimento/rotina";
import { enviarAutomacao as enviar } from "./enviar";
import { canalDaReativacaoAtivo, iniciarReativacao } from "./reativacao";
import { fazAniversario, horarioComercial, TEXTOS } from "./regras";

const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const MAX_REATIVACAO_POR_RODADA = 15;

/** `clienteIds` limita a rodada a esses clientes (usado nos testes). */
export async function rodarAutomacoes(agora = Date.now(), opts: { clienteIds?: string[] } = {}) {
  const cont = { retomadasConvite: 0, lembretes: 0, faltas: 0, pos: 0, reativacao: 0, aniversario: 0, espera: 0, retorno: 0, indicacao: 0, campanha: 0, roletaNudge: 0, roletaUpsell: 0 };
  if (quarentenaRestauracao()) return cont;
  // Push tem consentimento próprio e continua funcionando com o WhatsApp pausado ou em piloto.
  try {
    const usuarios = opts.clienteIds
      ? await db.usuario.findMany({ where: { cliente: { id: { in: opts.clienteIds } } }, select: { id: true } })
      : undefined;
    await gerarNotificacoes(new Date(agora), opts);
    await processarPush(new Date(agora), { ...(usuarios ? { usuarioIds: usuarios.map(u => u.id) } : {}) });
  } catch { console.error("[notificacoes] Falha na rotina de avisos do aplicativo."); }
  await registrarAbandonosRoleta(agora, opts).catch(() => console.error("[roleta] Falha ao medir jornadas sem continuidade."));
  if (process.env.WHATSAPP_ENVIOS_BLOQUEADOS === "true") {
    if (loteAutorizadoConfigurado()) cont.campanha = await processarCampanhas(agora, opts);
    return cont;
  }
  const cfg = await configuracao();
  const so = opts.clienteIds ? { clienteId: { in: opts.clienteIds } } : {};
  const comercial = horarioComercial(agora, cfg.fuso);

  cont.retomadasConvite = await rodarRetomadas(agora, cfg.fuso, opts.clienteIds);
  cont.lembretes = await lembrarHorarios(agora, cfg, opts.clienteIds, recursoPiloto());
  if (recursoPiloto()) {
    if (comercial && process.env.WHATSAPP_CAMPANHAS_MANUAIS_ATIVAS === "true") cont.campanha = await processarCampanhas(agora, opts);
    return cont;
  }

  // Vaga que abriu e premio de indicacao nao esperam o horario comercial das outras mensagens.
  cont.espera = await processarEsperas(agora, opts);
  cont.indicacao = await processarIndicacoes(opts);
  await processarConvitesAvaliacao(opts, new Date(agora));
  await processarRecompras(agora, opts);

  if (!comercial) return cont;

  cont.roletaNudge = await rodarNudgesRoleta(agora, cfg, opts).catch(() => {
    console.error("[roleta] Falha na rotina de retomada.");
    return 0;
  });
  const roleta = await rodarPosRoleta(agora, cfg, opts).catch(() => {
    console.error("[roleta] Falha na rotina pós-atendimento.");
    return { pos: 0, upsell: 0 };
  });
  cont.pos += roleta.pos;
  cont.roletaUpsell = roleta.upsell;

  // ---- depois da falta: oferece remarcar (se ainda nao remarcou)
  if (cfg.avisoFalta) {
    const faltas = await db.agendamento.findMany({
      where: { status: "FALTOU", inicio: { gt: new Date(agora - DIA), lt: new Date(agora) }, cliente: { aceitaMensagens: true }, ...so },
      include: { cliente: true },
    });
    for (const a of faltas) {
      const remarcou = await db.agendamento.count({ where: { clienteId: a.clienteId, status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(agora) } } });
      if (remarcou) continue;
      const texto = TEXTOS.POS_FALTA({ nome: a.cliente.nome, hora: minParaHhmm(minutosLocal(a.inicio, cfg.fuso)) });
      if (await enviar({ tipo: "POS_FALTA", chave: a.id, clienteId: a.clienteId, agendamentoId: a.id, telefone: a.cliente.telefone, texto })) cont.faltas++;
    }
  }

  // ---- agradecimento (30 min a 12 h depois de concluir)
  if (cfg.posAtendimento) {
    const feitos = await db.agendamento.findMany({
      where: { status: "CONCLUIDO", fim: { gt: new Date(agora - 12 * 60 * MIN), lt: new Date(agora - 30 * MIN) }, cliente: { aceitaMensagens: true },
        ...(acompanhamentoRoletaAtivo() ? { jornadaRoleta: null, OR: [{ adicionalDeId: null }, { adicionalDe: { jornadaRoleta: null } }] } : {}), ...so },
      include: { cliente: true },
    });
    // Um por cliente por dia (corte + barba seguidos = uma mensagem).
    const vistos = new Set<string>();
    for (const a of feitos) {
      if (vistos.has(a.clienteId)) continue;
      vistos.add(a.clienteId);
      const texto = TEXTOS.POS_ATENDIMENTO({ nome: a.cliente.nome, link: cfg.linkAvaliacao });
      const chave = `${a.clienteId}:${new Date(agora).toISOString().slice(0, 10)}`;
      if (await enviar({ tipo: "POS_ATENDIMENTO", chave, clienteId: a.clienteId, agendamentoId: a.adicionalDeId ?? a.id, telefone: a.cliente.telefone, texto })) cont.pos++;
    }
  }

  // ---- retorno no ritmo de cada cliente
  cont.retorno = await processarRetornos(agora, opts);

  // ---- campanhas: fila dos lotes liberados, no limite diario de cada uma
  cont.campanha = await processarCampanhas(agora, opts);

  // ---- extrato da Celcash (ultimos dias): conciliacao do resultado do mes
  if (!opts.clienteIds) await sincronizarRecentes(agora).catch((e) => console.error("[conciliacao] celcash", e));

  // ---- premios de jogo: vence o que passou da validade e solta reserva de horario cancelado
  if (!opts.clienteIds) await atualizarPremios().catch((e) => console.error("[jogos] atualizar premios", e));

  // ---- LGPD: candidaturas sem autorizacao para futuras oportunidades saem em 12 meses
  if (!opts.clienteIds) await apagarCandidaturasVencidas(agora).catch((e) => console.error("[lgpd] candidaturas", e));

  // ---- aniversario (a partir das 9h, uma vez por ano)
  if (cfg.aniversario && minutosLocal(agora, cfg.fuso) >= 9 * 60) {
    const hoje = dataLocal(agora, cfg.fuso);
    const clientes = await db.cliente.findMany({
      where: { dataNascimento: { not: null }, aceitaMensagens: true, ...(opts.clienteIds ? { id: { in: opts.clienteIds } } : {}) },
      select: { id: true, nome: true, telefone: true, dataNascimento: true },
    });
    for (const c of clientes) {
      if (!fazAniversario(c.dataNascimento!.toISOString().slice(0, 10), hoje)) continue;
      const texto = TEXTOS.ANIVERSARIO({ nome: c.nome, barbearia: cfg.nomeBarbearia, presente: cfg.presenteAniversario });
      if (await enviar({ tipo: "ANIVERSARIO", chave: `${c.id}:${hoje.slice(0, 4)}`, clienteId: c.id, telefone: c.telefone, texto })) cont.aniversario++;
    }
  }

  // ---- reativacao de quem sumiu (ultima visita ha X dias, nada marcado)
  if (cfg.reativacaoDias > 0 && canalDaReativacaoAtivo(cfg.botAtivo)) {
    const limite = new Date(agora - cfg.reativacaoDias * DIA);
    const ultimas = await db.agendamento.groupBy({
      by: ["clienteId"],
      where: { status: "CONCLUIDO", ...so },
      _max: { inicio: true },
      having: { inicio: { _max: { lt: limite, gt: new Date(agora - 4 * cfg.reativacaoDias * DIA) } } },
    });
    let enviados = 0;
    for (const u of ultimas) {
      if (enviados >= MAX_REATIVACAO_POR_RODADA) break;
      const visita = u._max.inicio!;
      const c = await db.cliente.findUnique({ where: { id: u.clienteId } });
      if (!c || c.excluidoEm || !c.aceitaMensagens || (c.ultimaReativacaoEm && c.ultimaReativacaoEm > visita)) continue;
      const futuro = await db.agendamento.count({ where: { clienteId: c.id, status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(agora) } } });
      if (futuro) continue;
      if (await iniciarReativacao(c, visita, agora)) {
        await db.cliente.update({ where: { id: c.id }, data: { ultimaReativacaoEm: new Date(agora) } });
        enviados++;
      }
    }
    cont.reativacao = enviados;
  }
  return cont;
}

export function agendarAutomacoes() {
  if (quarentenaRestauracao()) return;
  const g = globalThis as unknown as { rotinaAutomacoes?: boolean };
  if (g.rotinaAutomacoes) return;
  g.rotinaAutomacoes = true;
  let rodando = false;
  const rodar = async () => {
    // Não consome fila nem marca checklist como enviado durante o bloqueio de mensagens.
    if (rodando || quarentenaRestauracao()) return;
    rodando = true;
    try {
      await sincronizarDisponibilidadeAtendimento();
      const r = await rodarAutomacoes();
      if (process.env.WHATSAPP_ENVIOS_BLOQUEADOS === "true") return;
      // Checklist da equipe (lista da manha e resumo da noite).
      const ck = await (await import("@/lib/checklist/servico")).rodarChecklist().catch((e) => {
        console.error("[checklist] falhou:", e);
        return { listas: 0, resumos: 0, lembretes: 0 };
      });
      if (ck.listas || ck.resumos || ck.lembretes) console.log(`[checklist] listas ${ck.listas}, resumos ${ck.resumos}, lembretes ${ck.lembretes}`);
      const total = Object.values(r).reduce((a, b) => a + b, 0);
      if (total) console.log(`[automacoes] lembretes ${r.lembretes}, pós-falta ${r.faltas}, pós-atendimento ${r.pos}, reativação ${r.reativacao}, aniversário ${r.aniversario}, espera ${r.espera}, retorno ${r.retorno}, indicação ${r.indicacao}, campanha ${r.campanha}, retomadas da roleta ${r.roletaNudge}, ofertas pós-roleta ${r.roletaUpsell}`);
    } catch (e) {
      console.error("[automacoes] falhou:", e);
    } finally {
      rodando = false;
    }
  };
  setTimeout(rodar, 45_000);
  setInterval(rodar, 5 * MIN);
}
