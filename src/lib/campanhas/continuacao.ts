import type { Conversa } from "@prisma/client";
import { classificarRespostaAbertura, RECUSA_CONVITE } from "@/lib/bot/convite-app-textos";
import { db } from "@/lib/db";
import { dentroJanela24h, provedorWhatsApp, temJanela24h } from "@/lib/whatsapp/canal";
import { enviarNaConversa } from "@/lib/whatsapp/conversas";
import { campanhasBloqueadas } from "./bloqueio";
import { impedimentoCampanha } from "./contato";
import { impedimentoRoleta, INTERVALO_CAMPANHAS_MS, jogoDoLink, migracaoDoCliente } from "./reservar-contato";

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
  const reservado = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campanha:${envio.campanhaId}`}))`;
    const atual = await tx.campanhaEnvio.findUnique({
      where: { id: envio.id },
      include: {
        campanha: { include: { jogo: jogoDoLink } },
        cliente: { select: { telefone: true, aceitaMensagens: true, excluidoEm: true, assinaturas: migracaoDoCliente, conversa: true,
          agendamentos: { where: { status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(Date.now()) } }, take: 1, select: { id: true } } } },
      },
    });
    if (!atual || atual.respostaEm || atual.cliente.telefone !== conversa.telefone || atual.cliente.conversa?.id !== conversa.id ||
      atual.cliente.conversa.ultimaEntradaEm?.getTime() !== +entradaEm || impedimentoCampanha(atual.cliente, atual.cliente.agendamentos.length > 0)) return null;
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
  if (!reservado.mensagem || await campanhasBloqueadas()) return "equipe";
  if (resposta === "acolheu" && !await db.campanha.findFirst({ where: { id: envio.campanhaId, status: "ATIVA" }, select: { id: true } })) return "equipe";
  const r = await enviarNaConversa(conversa.id, reservado.mensagem, "SISTEMA", { campanha: true, pararSeHumano: true });
  if (!r.ok || (!r.wamid && provedorWhatsApp() !== "simulador")) return "equipe";
  if (resposta === "acolheu") await db.campanhaEnvio.update({ where: { id: envio.id }, data: { ofertaEnviadaEm: new Date(Date.now()) } });
  return "respondida";
}
