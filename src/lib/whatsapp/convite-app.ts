import { randomBytes } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { auditar } from "@/lib/auditoria";
import { publicar } from "@/lib/eventos";
import { aberturaReativacao } from "@/lib/automacoes/regras";
import { canalConviteAtivo } from "@/lib/convites/canal";
import { aberturaDaJornada, instanteDeAjudaAposLeitura, instanteDeRetomada } from "@/lib/convites/jornada-leonel";
import { destinoDaJornada, ehJornadaComRoleta, PREFIXO_TESTE_FRIO, tokenDaJornada } from "@/lib/convites/link";
import { reservarRoletaLeonel } from "@/lib/convites/roleta-leonel";
import { temperaturaDoCliente } from "@/lib/clientes/segmentos";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { provedorWhatsApp, temJanela24h } from "./canal";
import { enviarNaConversa } from "./conversas";
import { naFila } from "./fila-conversa";
import { destinatarioTesteEquipe } from "./teste-equipe";
import { telefoneCanonico } from "./webhook";

async function conferirContato(id: string) {
  const c = await db.conversa.findUnique({ where: { id }, select: {
    telefone: true, waId: true, instagramIgsid: true, estado: true, conviteApp: true, recusaAutomaticas: true, ultimaEntradaEm: true,
    cliente: { select: { id: true, nome: true, telefone: true, aceitaMensagens: true, excluidoEm: true } },
  } });
  if (!c) throw naoEncontrado("Conversa");
  if (c.instagramIgsid) throw new ErroNegocio("Convites do Leonel estão disponíveis apenas em conversas de WhatsApp.");
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

export async function iniciarConviteApp(id: string, usuarioId: string, personalizar = false, testeFrio = false) {
  const contato = await conferirContato(id);
  return naFila(contato.telefone, async () => {
    if (testeFrio && !await db.usuario.findFirst({ where: { id: usuarioId, papel: "DONO", ativo: true, telefone: contato.telefone }, select: { id: true } })) {
      throw new ErroNegocio("O teste individual exige a conta do dono.", 403);
    }
    const ultima = personalizar && !testeFrio && await db.agendamento.findFirst({
      where: { clienteId: contato.clienteId, status: "CONCLUIDO", inicio: { lte: new Date() } },
      orderBy: { inicio: "desc" }, select: { inicio: true },
    });
    const segmento = testeFrio ? "frio" : personalizar ? temperaturaDoCliente(ultima ? +ultima.inicio : null, Date.now()) : null;
    if (segmento === "semVisitaRegistrada" || segmento === "historicoIncompleto") {
      throw new ErroNegocio("O cliente precisa ter uma visita concluída para identificar o segmento do convite.", 409);
    }
    const sufixo = randomBytes(16).toString("hex");
    const token = testeFrio ? PREFIXO_TESTE_FRIO + sufixo : segmento ? tokenDaJornada(segmento, sufixo) : "app_" + sufixo;
    const roleta = ehJornadaComRoleta(token);
    const baloes = segmento ? aberturaDaJornada(segmento, contato.nome, destinoDaJornada(token)) : aberturaReativacao(contato.nome);
    await db.$transaction(async tx => {
      const reserva = await tx.conversa.updateMany({
        where: { id, clienteId: contato.clienteId, instagramIgsid: null, telefone: contato.telefone, estado: "BOT", recusaAutomaticas: false,
          ...(testeFrio ? { OR: [{ conviteApp: null }, { conviteApp: "ENCERRADO" }] } : { conviteApp: null }) },
        data: { conviteApp: "ABRINDO" },
      });
      if (!reserva.count) throw new ErroNegocio("Esse convite já foi iniciado ou a conversa mudou. Confira o histórico.", 409);
      if (testeFrio) {
        await tx.jornadaConviteApp.deleteMany({ where: { conversaId: id, clienteId: contato.clienteId, proximaEm: null } });
      }
      if (segmento && roleta) await reservarRoletaLeonel(tx, segmento, contato.clienteId, token);
      await tx.jornadaConviteApp.create({ data: { conversaId: id, clienteId: contato.clienteId, token } });
      await auditar(tx, usuarioId, "iniciar_convite_app", "conversa", id, segmento ? { segmento, ...(testeFrio ? { testeFrio } : {}) } : undefined);
    });
    try {
      let aberturaId: string | undefined;
      for (const [i, texto] of baloes.entries()) {
        if (i && provedorWhatsApp() !== "simulador") await esperar(2000);
        const atual = await conferirContato(id);
        if (atual.telefone !== contato.telefone || atual.clienteId !== contato.clienteId || atual.etapa !== "ABRINDO") throw new ErroNegocio("O convite foi interrompido. Confira o histórico.", 409);
        const envio = await enviarNaConversa(id, texto, "BOT", {
          pararSeHumano: true, respostaAtendimento: atual.equipe, conviteIndividual: !atual.equipe,
          ...(roleta && i === baloes.length - 1 ? { previaRoleta: true } : {}),
        });
        if (!envio.ok || (!envio.wamid && provedorWhatsApp() !== "simulador")) {
          throw new ErroNegocio(`O canal não confirmou o balão ${i + 1}. Confira o histórico.`, 502);
        }
        if (!i) aberturaId = envio.mensagemId;
        if (i === baloes.length - 1) await db.$transaction(async tx => {
          const agora = new Date();
          // Serializa a associação do link ao convite com o primeiro recibo de leitura.
          const [link] = segmento ? await tx.$queryRaw<{ criadoEm: Date; lidaEm: Date | null }[]>`
            SELECT "criadoEm", "lidaEm" FROM mensagens WHERE id = ${envio.mensagemId} FOR UPDATE` : [];
          if (roleta) await tx.campanhaEnvio.update({ where: { token }, data: {
            mensagemId: envio.mensagemId, enviadoEm: agora, status: "ENVIADO",
          } });
          await tx.jornadaConviteApp.updateMany({ where: { conversaId: id, parouEm: null }, data: segmento ? {
            aberturaId, linkId: envio.mensagemId, proximaEm: link?.lidaEm
              ? instanteDeAjudaAposLeitura(link.criadoEm, link.lidaEm) : instanteDeRetomada(agora),
          } : { aberturaId: envio.mensagemId, proximaEm: new Date(+agora + 86_400_000) } });
        });
      }
      await db.conversa.updateMany({ where: { id, conviteApp: "ABRINDO" }, data: { conviteApp: segmento ? "ENCERRADO" : "AGUARDANDO" } });
    } catch (e) {
      if (roleta) await db.campanhaEnvio.updateMany({ where: { token, status: "PULADO" }, data: {
        status: "FALHOU", erro: "O envio do convite individual não foi confirmado.",
      } });
      await db.conversa.updateMany({ where: { id, conviteApp: "ABRINDO" }, data: { conviteApp: "ENCERRADO" } });
      throw e;
    } finally {
      publicar({ tipo: "conversa", conversaId: id });
    }
    return { segmento };
  });
}
