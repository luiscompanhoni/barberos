import { randomBytes } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { auditar } from "@/lib/auditoria";
import { publicar } from "@/lib/eventos";
import { aberturaReativacao } from "@/lib/automacoes/regras";
import { canalConviteAtivo } from "@/lib/convites/canal";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { provedorWhatsApp, temJanela24h } from "./canal";
import { enviarNaConversa } from "./conversas";
import { naFila } from "./fila-conversa";
import { destinatarioTesteEquipe } from "./teste-equipe";
import { telefoneCanonico } from "./webhook";

async function conferirContato(id: string) {
  const c = await db.conversa.findUnique({ where: { id }, select: {
    telefone: true, waId: true, estado: true, conviteApp: true, recusaAutomaticas: true, ultimaEntradaEm: true,
    cliente: { select: { id: true, nome: true, telefone: true, aceitaMensagens: true, excluidoEm: true } },
  } });
  if (!c) throw naoEncontrado("Conversa");
  if (c.estado !== "BOT" || c.recusaAutomaticas || !c.cliente?.aceitaMensagens || c.cliente.excluidoEm ||
      c.cliente.telefone !== c.telefone || (c.waId && telefoneCanonico(c.waId) !== c.telefone)) {
    throw new ErroNegocio("O convite exige um cliente que aceita mensagens e uma conversa com o bot.", 409);
  }
  const equipe = await destinatarioTesteEquipe(c.telefone);
  if (!await canalConviteAtivo(equipe)) {
    throw new ErroNegocio("O convite está bloqueado na configuração atual do WhatsApp.", 409);
  }
  if (temJanela24h() && (!c.ultimaEntradaEm || Date.now() - +c.ultimaEntradaEm >= 24 * 3_600_000)) {
    throw new ErroNegocio("A janela de atendimento do WhatsApp está fechada.", 409);
  }
  return { clienteId: c.cliente.id, telefone: c.telefone, nome: c.cliente.nome, etapa: c.conviteApp, equipe };
}

export async function iniciarConviteApp(id: string, usuarioId: string) {
  const contato = await conferirContato(id);
  return naFila(contato.telefone, async () => {
    await db.$transaction(async tx => {
      const reserva = await tx.conversa.updateMany({
        where: { id, telefone: contato.telefone, estado: "BOT", recusaAutomaticas: false, conviteApp: null },
        data: { conviteApp: "ABRINDO" },
      });
      if (!reserva.count) throw new ErroNegocio("Esse convite já foi iniciado ou a conversa mudou. Confira o histórico.", 409);
      await tx.jornadaConviteApp.create({ data: { conversaId: id, clienteId: contato.clienteId, token: "app_" + randomBytes(16).toString("hex") } });
      await auditar(tx, usuarioId, "iniciar_convite_app", "conversa", id);
    });
    try {
      for (const [i, texto] of aberturaReativacao(contato.nome).entries()) {
        if (i && provedorWhatsApp() !== "simulador") await esperar(2000);
        const atual = await conferirContato(id);
        if (atual.telefone !== contato.telefone || atual.etapa !== "ABRINDO") throw new ErroNegocio("O convite foi interrompido. Confira o histórico.", 409);
        const envio = await enviarNaConversa(id, texto, "BOT", {
          pararSeHumano: true, respostaAtendimento: atual.equipe, conviteIndividual: !atual.equipe,
        });
        if (!envio.ok || (!envio.wamid && provedorWhatsApp() !== "simulador")) {
          throw new ErroNegocio(`O canal não confirmou o balão ${i + 1}. Confira o histórico.`, 502);
        }
        if (i === 1) await db.jornadaConviteApp.updateMany({ where: { conversaId: id, parouEm: null }, data: {
          aberturaId: envio.mensagemId, proximaEm: new Date(Date.now() + 86_400_000),
        } });
      }
      await db.conversa.updateMany({ where: { id, conviteApp: "ABRINDO" }, data: { conviteApp: "AGUARDANDO" } });
    } catch (e) {
      await db.conversa.updateMany({ where: { id, conviteApp: "ABRINDO" }, data: { conviteApp: "ENCERRADO" } });
      throw e;
    } finally {
      publicar({ tipo: "conversa", conversaId: id });
    }
  });
}
