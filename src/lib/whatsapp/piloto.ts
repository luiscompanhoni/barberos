import type { EstadoConversa } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, proibido } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { atendimentoAposPiloto, recursoPiloto, permitePiloto } from "./piloto-regras";
export async function estadoPiloto() {
  return recursoPiloto() ? db.pilotoEntrevistaWhatsApp.findUnique({ where: { id: 1 } }) : null;
}
export async function reservarEnvioPiloto(para: string, origem: string) {
  if (!recursoPiloto()) {
    if (origem === "ENTREVISTA_PILOTO") throw new ErroNegocio("Piloto indisponível.", 403);
    return;
  }
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('whatsapp-piloto',0))`;
    const p = await tx.pilotoEntrevistaWhatsApp.findUnique({ where: { id: 1 } });
    if (!p) throw new ErroNegocio("Modo piloto: nenhum destinatário autorizado.", 403);
    if (origem === "ATENDIMENTO" && atendimentoAposPiloto(p)) return;
    if (!p.ativo || !permitePiloto(p, para, origem)) throw new ErroNegocio("Envio bloqueado pelo piloto restrito de entrevistas.", 403);
    await tx.pilotoEntrevistaWhatsApp.update({ where: { id: 1 }, data: { enviados: { increment: 1 } } });
    await auditar(tx, p.usuarioId, "recrutamento.piloto.tentativa", "PilotoEntrevistaWhatsApp", "1", { tentativa: p.enviados + 1 });
  }, { maxWait: 10000, timeout: 15000 });
}
export async function configurarPiloto(usuarioId: string, versao: number, telefone: string | null, minutos = 30) {
  if (!recursoPiloto()) throw new ErroNegocio("Piloto indisponível nesta instalação.", 503);
  return db.$transaction(async tx => {
    if (!await tx.usuario.findFirst({ where: { id: usuarioId, papel: "DONO", ativo: true }, select: { id: true } })) throw proibido();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('whatsapp-piloto',0))`;
    const atual = await tx.pilotoEntrevistaWhatsApp.findUnique({ where: { id: 1 } });
    if ((atual?.versao ?? 0) !== versao) throw new ErroNegocio("Piloto alterado. Atualize a tela.", 409);
    if (telefone !== null) {
      if (atual?.ativo) throw new ErroNegocio("Encerre o piloto atual antes de iniciar outro.", 409);
      if (!Number.isInteger(minutos) || minutos < 1 || minutos > 60) throw new ErroNegocio("Use de 1 a 60 minutos.", 400);
      const numero = normalizarTelefone(telefone); if (!numero) throw new ErroNegocio("Telefone inválido.", 400);
      if (!await tx.configuracao.findUnique({where:{id:1}})) throw new ErroNegocio("Configuração da barbearia ausente.", 409);
      await tx.configuracao.update({ where: { id: 1 }, data: { botAtivo: false } });
      const conversa = await tx.conversa.upsert({ where: { telefone: numero }, create: { telefone: numero, estado: "BOT" }, update: {} });
      const estadoAnterior = conversa.estado;
      await tx.conversa.update({where:{id:conversa.id},data:{estado:"BOT"}});
      const dados = { ativo: true, telefone: numero, expiraEm: new Date(Date.now() + minutos * 60000), usuarioId, conversaId: conversa.id, estadoAnterior, conviteChave: null, enviados: 0, versao: versao + 1 };
      const p = await tx.pilotoEntrevistaWhatsApp.upsert({ where: { id: 1 }, create: { id: 1, ...dados }, update: dados });
      await auditar(tx, usuarioId, "recrutamento.piloto.iniciar", "PilotoEntrevistaWhatsApp", "1", { finalTelefone: numero.slice(-4), minutos, botGeralPausado: true });
      return p;
    }
    if (atual?.conversaId && atual.estadoAnterior) await tx.conversa.updateMany({where:{id:atual.conversaId,telefone:atual.telefone??"",estado:"BOT"},data:{estado:atual.estadoAnterior as EstadoConversa}});
    if (atual) await tx.pilotoEntrevistaWhatsApp.update({ where: { id: 1 }, data: { ativo: false, versao: { increment: 1 } } });
    await auditar(tx, usuarioId, "recrutamento.piloto.encerrar", "PilotoEntrevistaWhatsApp", "1", {});
    return tx.pilotoEntrevistaWhatsApp.findUnique({ where: { id: 1 } });
  });
}
export async function reservarConvitePiloto(chave: string, versao: number) {
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('whatsapp-piloto',0))`;
  const p=await tx.pilotoEntrevistaWhatsApp.findUnique({where:{id:1}});
  if(!p?.ativo || p.versao!==versao || !p.expiraEm || +p.expiraEm<=Date.now()) throw new ErroNegocio("Piloto expirado ou alterado.",409);
  if(p.conviteChave===chave)return false;
  await tx.pilotoEntrevistaWhatsApp.update({where:{id:1},data:{conviteChave:chave}});
  await auditar(tx,p.usuarioId,"recrutamento.piloto.reservar_convite","PilotoEntrevistaWhatsApp","1",{conviteChave:chave});return true;
 });
}
