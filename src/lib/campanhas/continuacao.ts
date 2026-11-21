import type { Conversa, Prisma } from "@prisma/client";
import { classificarRespostaAbertura, RECUSA_CONVITE } from "@/lib/bot/convite-app-textos";
import { db } from "@/lib/db";
import { dentroJanela24h, provedorWhatsApp, temJanela24h } from "@/lib/whatsapp/canal";
import { enviarNaConversa } from "@/lib/whatsapp/conversas";
import { campanhasBloqueadas } from "./bloqueio";
import { comPreferenciaCampanha, impedimentoCampanha } from "./contato";
import { impedimentoRoleta, INTERVALO_CAMPANHAS_MS, jogoDoLink, migracaoDoCliente } from "./reservar-contato";

async function carregarEnvio(tx: Prisma.TransactionClient, id: string, conversa: Conversa, entradaEm: Date, mensagemId: string) {
  const atual = await tx.campanhaEnvio.findUnique({ where: { id }, include: {
    campanha: { include: { jogo: jogoDoLink } },
    cliente: { select: { telefone: true, aceitaMensagens: true, excluidoEm: true, assinaturas: migracaoDoCliente, conversa: true,
      agendamentos: { where: { status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(Date.now()) } }, take: 1, select: { id: true } } } },
  } });
  if (!atual || atual.status !== "ENVIADO" || atual.clienteId !== conversa.clienteId || atual.mensagemId !== mensagemId ||
    atual.cliente.telefone !== conversa.telefone || atual.cliente.conversa?.id !== conversa.id ||
    atual.cliente.conversa.telefone !== conversa.telefone || atual.cliente.conversa.ultimaEntradaEm?.getTime() !== +entradaEm ||
    impedimentoCampanha(atual.cliente, atual.cliente.agendamentos.length > 0)) return null;
  return atual;
}

/** Uma entrada do cliente pode liberar uma única oferta da abertura que ficou por último na conversa. */
export async function continuarCampanha(conversa: Conversa, texto: string, aindaComBot: () => Promise<boolean>) {
  if (!conversa.clienteId || !conversa.ultimaEntradaEm || conversa.recusaAutomaticas || await campanhasBloqueadas()) return false;
  const entradaEm = conversa.ultimaEntradaEm;
  const ultimaSaida = await db.mensagem.findFirst({
    where: { conversaId: conversa.id, autor: { in: ["BOT", "SISTEMA", "EQUIPE"] }, erro: null },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }], select: { id: true },
  });
  if (!ultimaSaida) return false;
  const envio = await db.campanhaEnvio.findFirst({
    where: {
      clienteId: conversa.clienteId, mensagemId: ultimaSaida.id, status: "ENVIADO", respostaEm: null,
      aberturaIniciadaEm: { lte: entradaEm }, aberturaConcluidaEm: { gte: new Date(+entradaEm - INTERVALO_CAMPANHAS_MS) },
    },
    select: { id: true, campanhaId: true },
  });
  if (!envio || !await aindaComBot()) return false;
  const resposta = classificarRespostaAbertura(texto);
  const reservado = await comPreferenciaCampanha(envio.campanhaId, conversa.telefone, async tx => {
    const atual = await carregarEnvio(tx, envio.id, conversa, entradaEm, ultimaSaida.id);
    if (!atual || atual.respostaEm || await campanhasBloqueadas()) return null;
    const agora = Date.now();
    const oferta = atual.ofertaTexto;
    const enviar = resposta === "acolheu" && oferta && atual.campanha.status === "ATIVA" &&
      (!temJanela24h() || dentroJanela24h(entradaEm)) &&
      !await impedimentoRoleta(tx, atual.clienteId, agora, atual.campanha.jogo, atual.token, oferta);
    const r = await tx.campanhaEnvio.updateMany({
      where: { id: atual.id, respostaEm: null },
      data: { respostaEm: entradaEm, ...(enviar ? { continuacaoReservadaEm: new Date(agora) } : {}) },
    });
    return r.count ? { mensagem: resposta === "recusa" ? RECUSA_CONVITE : enviar ? oferta : null } : null;
  });
  if (!reservado || !await aindaComBot()) return false;
  const { mensagem } = reservado;
  if (!mensagem) return "equipe";
  return comPreferenciaCampanha(envio.campanhaId, conversa.telefone, async tx => {
    if (!await aindaComBot()) return false;
    const atual = await carregarEnvio(tx, envio.id, conversa, entradaEm, ultimaSaida.id);
    if (!atual || atual.respostaEm?.getTime() !== +entradaEm || atual.campanha.status !== "ATIVA" ||
      await campanhasBloqueadas() || (temJanela24h() && !dentroJanela24h(entradaEm))) return "equipe";
    const r = await enviarNaConversa(conversa.id, mensagem, "SISTEMA", { campanha: true, pararSeHumano: true });
    if (!r.ok || (!r.wamid && provedorWhatsApp() !== "simulador")) return "equipe";
    if (resposta === "acolheu") await tx.campanhaEnvio.update({ where: { id: envio.id }, data: { ofertaEnviadaEm: new Date(Date.now()) } });
    return "respondida";
  });
}
