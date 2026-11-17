import { setTimeout as esperar } from "node:timers/promises";
import { aberturaReativacao } from "@/lib/automacoes/regras";
import { db } from "@/lib/db";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";
import { enviarNaConversa } from "@/lib/whatsapp/conversas";
import { estadoEvolution, indicarDigitacaoEvolution } from "@/lib/whatsapp/evolution";
import { destinatarioTesteEquipe, destinoTesteIndividual } from "@/lib/whatsapp/teste-equipe";
import { telefoneCanonico } from "@/lib/whatsapp/webhook";

async function enviarAbertura() {
  const telefone = destinoTesteIndividual();
  if (!telefone || process.env.WHATSAPP_ENVIOS_BLOQUEADOS !== "true" ||
      process.env.WHATSAPP_ATENDIMENTO_IA_PAGA !== "false" || process.env.WHATSAPP_ATENDIMENTO_APOS_PILOTO !== "false" ||
      process.env.PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS !== "true" || provedorWhatsApp() !== "evolution" ||
      !await destinatarioTesteEquipe(telefone) || await estadoEvolution() !== "conectado") {
    throw new Error("Controles do teste individual ou conexão indisponíveis.");
  }
  const usuario = await db.usuario.findFirstOrThrow({ where: { telefone, papel: "DONO", ativo: true }, select: { nome: true } });
  const conversa = await db.conversa.findUniqueOrThrow({ where: { telefone }, select: {
    id: true, waId: true, estado: true, recusaAutomaticas: true,
    cliente: { select: { aceitaMensagens: true, excluidoEm: true } },
  } });
  if (conversa.estado !== "BOT" || conversa.recusaAutomaticas || conversa.cliente?.aceitaMensagens === false ||
      conversa.cliente?.excluidoEm || (conversa.waId && telefoneCanonico(conversa.waId) !== telefone)) {
    throw new Error("A conversa não está disponível para o teste.");
  }
  const marcador = `Abertura reservada para o teste individual do Leonel até ${process.env.WHATSAPP_ATENDIMENTO_TESTE_ATE}.`;
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${conversa.id}, 0))`;
    if (await tx.mensagem.findFirst({ where: { conversaId: conversa.id, autor: "NOTA", texto: marcador }, select: { id: true } })) {
      throw new Error("Já existe uma tentativa neste teste. Confira o histórico antes de repetir.");
    }
    await tx.mensagem.create({ data: { conversaId: conversa.id, autor: "NOTA", texto: marcador } });
  });

  const mensagens = aberturaReativacao(usuario.nome);
  for (const [indice, texto] of mensagens.entries()) {
    const digitacao = indice > 0
      ? indicarDigitacaoEvolution(conversa.waId ?? telefone, 2000, AbortSignal.timeout(5000)).then(() => true, () => false)
      : undefined;
    if (digitacao) await esperar(2000);
    const envio = await enviarNaConversa(conversa.id, texto, "BOT", { respostaAtendimento: true, aberturaTeste: true });
    const registro = await db.mensagem.findUnique({ where: { id: envio.mensagemId }, select: { wamid: true } });
    if (!envio.ok || !registro?.wamid) throw new Error(`O WhatsApp não confirmou o balão ${indice + 1}. Confira antes de repetir.`);
    console.log(`BALAO_${indice + 1}_ACEITO`);
    if (digitacao) console.log(await digitacao ? "DIGITACAO_ACEITA" : "DIGITACAO_NAO_CONFIRMADA");
  }
}

enviarAbertura().catch(erro => {
  console.error(erro instanceof Error && !("clientVersion" in erro) ? erro.message : "Falha ao conferir a abertura do teste.");
  process.exitCode = 1;
}).finally(() => db.$disconnect());
