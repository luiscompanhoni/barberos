import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal, minutosLocal, somarDias } from "@/lib/agenda/tempo";
import { horarioComercial } from "@/lib/automacoes/regras";
import { configuracaoPush } from "./configuracao";
import { notificacaoAindaRelevante } from "./geracao-relevancia";
import { enviarPush } from "./provedor";
import { categoriaPermitida, PREFERENCIAS_PADRAO } from "./regras";

export type OpcoesProcessarPush = { usuarioId?: string; usuarioIds?: string[]; notificacaoIds?: string[]; limite?: number; simular?: boolean };
const resumoVazio = () => ({ processados: 0, enviados: 0, simulados: 0, cancelados: 0, incertos: 0, falhas: 0, adiados: 0 });

/** Reservas abandonadas ficam incertas: a resposta do provedor pode ter se perdido. */
export async function processarPush(agoraEntrada: Date | number = new Date(), opts: OpcoesProcessarPush = {}) {
  const agora = new Date(agoraEntrada);
  const resumo = resumoVazio();
  const usuarios = opts.usuarioId ? (opts.usuarioIds && !opts.usuarioIds.includes(opts.usuarioId) ? [] : [opts.usuarioId]) : opts.usuarioIds;
  if (usuarios?.length === 0 || opts.notificacaoIds?.length === 0) return resumo;
  const escopo: Prisma.PushEntregaWhereInput = {
    ...(usuarios ? { notificacao: { usuarioId: { in: usuarios } } } : {}),
    ...(opts.notificacaoIds ? { notificacaoId: { in: opts.notificacaoIds } } : {}),
  };
  const limite = Math.max(1, Math.min(50, Math.floor(opts.limite ?? 20)));
  const vencidas = await db.pushEntrega.updateMany({ where: { ...escopo, estado: "ENVIANDO", tentadoEm: { lt: new Date(+agora - 2 * 60_000) } }, data: { estado: "INCERTO", codigoErro: "RESERVA_INTERROMPIDA" } });
  resumo.incertos += vencidas.count;
  const pendentes = await db.pushEntrega.findMany({ where: { ...escopo, estado: "PENDENTE", OR: [{ proximaTentativaEm: null }, { proximaTentativaEm: { lte: agora } }] }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }], take: limite, select: { id: true, notificacao: { select: { categoria: true, expiraEm: true } } } });
  const cfgAgenda = pendentes.some((p) => p.notificacao.categoria !== "TESTE") ? await configuracao() : null;
  for (const p of pendentes) {
    if (p.notificacao.expiraEm <= agora) {
      const r = await db.pushEntrega.updateMany({ where: { id: p.id, estado: "PENDENTE" }, data: { estado: "CANCELADO", codigoErro: "AVISO_EXPIRADO" } });
      resumo.cancelados += r.count; continue;
    }
    if (p.notificacao.categoria !== "TESTE" && cfgAgenda && !horarioComercial(+agora, cfgAgenda.fuso)) {
      const dia = dataLocal(+agora, cfgAgenda.fuso);
      const proximoDia = minutosLocal(+agora, cfgAgenda.fuso) < 8 * 60 ? dia : somarDias(dia, 1);
      await db.pushEntrega.updateMany({ where: { id: p.id, estado: "PENDENTE" }, data: { proximaTentativaEm: new Date(instanteLocal(proximoDia, 8 * 60, cfgAgenda.fuso)) } });
      resumo.adiados++; continue;
    }
    const reserva = await db.pushEntrega.updateMany({ where: { id: p.id, estado: "PENDENTE", OR: [{ proximaTentativaEm: null }, { proximaTentativaEm: { lte: agora } }] }, data: { estado: "ENVIANDO", tentadoEm: agora, tentativas: { increment: 1 }, codigoErro: null } });
    if (!reserva.count) continue;
    resumo.processados++;
    const entrega = await db.pushEntrega.findUniqueOrThrow({ where: { id: p.id }, include: { inscricao: true, notificacao: { include: { usuario: { select: { ativo: true, notificacaoPreferencia: true } } } } } });
    const n = entrega.notificacao;
    const cfg = configuracaoPush();
    let recusa: string | null = !n.usuario.ativo ? "CONTA_INATIVA"
      : !entrega.inscricao.ativo || entrega.inscricao.usuarioId !== n.usuarioId ? "DISPOSITIVO_INATIVO"
      : n.expiraEm <= agora ? "AVISO_EXPIRADO"
      : !categoriaPermitida(n.categoria, n.usuario.notificacaoPreferencia ?? PREFERENCIAS_PADRAO) ? "PREFERENCIA_DESATIVADA"
      : !cfg.disponivel ? "PROVEDOR_DESATIVADO"
      : entrega.inscricao.vapidHash !== cfg.vapidHash ? "CHAVE_ROTACIONADA" : null;
    if (!recusa) {
      try { if (!(await notificacaoAindaRelevante(n, agora))) recusa = "EVENTO_DESATUALIZADO"; }
      catch { recusa = "VALIDACAO_INDISPONIVEL"; }
    }
    if (recusa) {
      await db.pushEntrega.update({ where: { id: p.id }, data: { estado: "CANCELADO", codigoErro: recusa } });
      if (recusa === "CHAVE_ROTACIONADA") await db.pushInscricao.update({ where: { id: entrega.inscricaoId }, data: { ativo: false, codigoErro: recusa } });
      resumo.cancelados++; continue;
    }
    // Recheca desligamento do aparelho/preferência depois das consultas de relevância.
    const [dispositivo, usuario] = await Promise.all([
      db.pushInscricao.findUnique({ where: { id: entrega.inscricaoId }, select: { ativo: true, usuarioId: true, tokenHash: true } }),
      db.usuario.findUnique({ where: { id: n.usuarioId }, select: { ativo: true, notificacaoPreferencia: true } }),
    ]);
    if (!dispositivo?.ativo || dispositivo.usuarioId !== n.usuarioId || dispositivo.tokenHash !== entrega.inscricao.tokenHash || !usuario?.ativo || !categoriaPermitida(n.categoria, usuario.notificacaoPreferencia ?? PREFERENCIAS_PADRAO)) {
      await db.pushEntrega.update({ where: { id: p.id }, data: { estado: "CANCELADO", codigoErro: "CONSENTIMENTO_ALTERADO" } }); resumo.cancelados++; continue;
    }
    const resultado = await enviarPush(entrega.inscricao, n, { agora, simular: opts.simular });
    const repetir = resultado.estado === "PENDENTE" && entrega.tentativas < 3;
    const estado = resultado.estado === "PENDENTE" && !repetir ? "FALHOU" : resultado.estado;
    await db.$transaction(async (tx) => {
      await tx.pushEntrega.update({ where: { id: p.id }, data: {
        estado, codigoErro: resultado.codigo,
        enviadoEm: estado === "ENVIADO" || estado === "SIMULADO" ? agora : null,
        proximaTentativaEm: repetir ? new Date(+agora + (resultado.esperarSegundos ?? 300) * 1000) : null,
      } });
      if (resultado.desativar) {
        await tx.pushInscricao.update({ where: { id: entrega.inscricaoId }, data: { ativo: false, codigoErro: resultado.codigo } });
        await tx.pushEntrega.updateMany({ where: { inscricaoId: entrega.inscricaoId, estado: "PENDENTE" }, data: { estado: "CANCELADO", codigoErro: "DISPOSITIVO_EXPIRADO" } });
      } else if (estado === "ENVIADO" || estado === "SIMULADO") await tx.pushInscricao.update({ where: { id: entrega.inscricaoId }, data: { ultimoEnvioEm: agora, codigoErro: null } });
    });
    if (estado === "ENVIADO") resumo.enviados++;
    else if (estado === "SIMULADO") resumo.simulados++;
    else if (estado === "INCERTO") resumo.incertos++;
    else if (estado === "PENDENTE") resumo.adiados++;
    else resumo.falhas++;
  }
  return resumo;
}
