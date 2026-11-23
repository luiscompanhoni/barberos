import { confirmarLembreteConvite } from "@/lib/convites/confirmar";
import { enderecoDoConvite } from "@/lib/convites/link";
import { continuarCampanha } from "@/lib/campanhas/continuacao";
import { registrarEntradaJornadaRoleta } from "@/lib/jogos/jornada-roleta";
import { NOTA_UPSELL, tratarRespostaRoleta } from "./resposta-roleta";
import { urlSite } from "@/lib/dominios";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";
import { contextoDaJornada } from "@/lib/convites/resposta";
import { AVISO_TROCA_APP, continuacaoConviteApp, respostaAoConvite } from "./convite-app-textos";
import { naFila, temTurnoNaFila } from "@/lib/whatsapp/fila-conversa";
import { contemConviteEntrevista, comandoReservadoEntrevista, processarBotEntrevista, registroSeguroEntrevista } from "./entrevistas";
import { estadoPiloto } from "@/lib/whatsapp/piloto";
import { atendimentoAposPiloto, permitePiloto, recursoPiloto } from "@/lib/whatsapp/piloto-regras";
import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import { configuracao } from "@/lib/agenda/carregar";
import { encaminharEntradaBloqueada, enviarNaConversa, registrarEntrada } from "@/lib/whatsapp/conversas";
import { dentroJanela24h, provedorWhatsApp } from "@/lib/whatsapp/canal";
import { entradaCloudSuperada, instanteDaEntradaCloud } from "@/lib/whatsapp/horario-entrada";
import { indicarDigitacaoEvolution } from "@/lib/whatsapp/evolution";
import { telefoneCanonico } from "@/lib/whatsapp/webhook";
import { situacaoDoCliente } from "@/lib/assinaturas/servico";
import { ofertaDezembroEmHomologacao } from "@/lib/oferta-dezembro/config";
import { APRESENTACAO_REATIVACAO, pediuParar } from "@/lib/automacoes/regras";
import { executarTurno, type Modelo } from "./agente";
import { dividirEmBolhas, tempoDigitando } from "./bolhas";
import { esperarBolha, historicoEntregue, ultimaAtividade } from "./resposta-entregue";
import { contextoDaMensagem, promptSistema } from "./prompt";
import { historicoSemImagens, prepararMidia, type ImagemBot } from "./multimodal";
import type { MidiaRecebida } from "@/lib/whatsapp/midia-tipos";
import { atualizarPreferencia, travarPreferencia } from "@/lib/whatsapp/preferencia";
import { destinatarioTesteEquipe, destinoTesteIndividual, testeEquipeAtivo, testeIndividualConfigurado } from "@/lib/whatsapp/teste-equipe";
import { OPERACOES_PRIVADAS } from "./ferramentas-operacao";

/** Sessao com o modelo reinicia depois desse tempo sem mensagens (ou se ficar longa demais). */
const SESSAO_INATIVA_MS = 3 * 3_600_000;
const SESSAO_MAX_MENSAGENS = 60;
const FERRAMENTAS_TESTE_REATIVACAO = new Set([
  "minha_preferencia_de_atendimento", "listar_servicos", "meus_agendamentos", "listar_planos",
  "minha_assinatura", "link_pagamento_assinatura", "consultar_produto", "minhas_comandas_abertas", "chamar_atendente",
]);

// Entradas e turnos têm FIFO próprio: uma pausa nunca atrasa o registro de PARAR.
const g = globalThis as unknown as { entradaBotAtual?: Map<string, AbortController> };
const entradasAtuais = (g.entradaBotAtual ??= new Map());

export type Entrada = { telefone: string; waId?: string; nomePerfil?: string | null; texto: string | null; wamid?: string; midia?: MidiaRecebida; timestampCloud?: number };
type ConversaRegistrada = NonNullable<Awaited<ReturnType<typeof registrarEntrada>>>;

/** Mensagem que chegou (webhook ou simulador) -> registra, responde com o bot se for o caso. */
export function receberMensagem(e: Entrada, opts: { modelo?: Modelo } = {}) {
  const aguardavaTurno = temTurnoNaFila(e.telefone);
  const optOut = !!e.texto && pediuParar(e.texto);
  const registro = naFila(`entrada:${e.telefone}`, async () => {
    const texto = e.texto ?? "[mensagem que não e texto: áudio, foto, figurinha ou documento]";
    const conversa = await registrarEntrada({ ...e, texto: registroSeguroEntrevista(texto), optOut });
    if (!conversa) return null; // Duplicata não interrompe a resposta original.
    if (!optOut && e.timestampCloud !== undefined && entradaCloudSuperada(e.timestampCloud, conversa.ultimaEntradaEm)) return null;
    entradasAtuais.get(e.telefone)?.abort();
    const controle = new AbortController();
    entradasAtuais.set(e.telefone, controle);
    return { conversa, controle };
  });
  return naFila(e.telefone, async () => {
    const entrada = await registro;
    if (!entrada) return;
    try {
      // O turno anterior pode ter atualizado sessão ou transferido para a equipe.
      const conversa = aguardavaTurno ? await db.conversa.findUniqueOrThrow({ where: { id: entrada.conversa.id } }) : entrada.conversa;
      await processar(e, opts, conversa, optOut, entrada.controle.signal);
    } finally {
      if (entradasAtuais.get(e.telefone) === entrada.controle) entradasAtuais.delete(e.telefone);
    }
  });
}

async function processar(e: Entrada, opts: { modelo?: Modelo }, conversa: ConversaRegistrada, optOut: boolean, sinal: AbortSignal) {
  const inicioTurno = new Date();
  const texto = e.texto ?? "[mensagem que não e texto: áudio, foto, figurinha ou documento]";
  const testeEquipe = await destinatarioTesteEquipe(conversa.telefone);
  const testeIndividual = testeEquipe && testeIndividualConfigurado();
  const encaminhar = async (nota = "A equipe da Black pode continuar o atendimento por aqui.") => {
    if (!optOut && !sinal.aborted && conversa.estado === "BOT") await encaminharEntradaBloqueada(conversa.id, nota);
  };
  if (e.timestampCloud !== undefined) {
    const enviadaEm = instanteDaEntradaCloud(e.timestampCloud);
    if (!dentroJanela24h(enviadaEm) || enviadaEm?.getTime() !== conversa.ultimaEntradaEm?.getTime()) return encaminhar();
  }
  const quarentena = quarentenaRestauracao();
  const roleta = !testeEquipe && !sinal.aborted && !quarentena && e.midia?.tipo !== "audio"
    ? await registrarEntradaJornadaRoleta(conversa, e.texto, optOut) : null;
  if ((quarentena || testeEquipeAtivo() || process.env.WHATSAPP_ENVIOS_BLOQUEADOS === "true") && !testeEquipe) {
    return encaminhar(roleta?.tipo === "UPSELL" ? NOTA_UPSELL : undefined);
  }
  const estadoAtual = () => db.conversa.findUnique({ where: { id: conversa.id }, select: { estado: true, ultimaEntradaEm: true, recusaAutomaticas: true } });
  const aindaComBot = async () => {
    if (sinal.aborted || (testeIndividual && !destinoTesteIndividual())) return false;
    const atual = await estadoAtual();
    return !sinal.aborted && atual?.estado === "BOT" && atual.ultimaEntradaEm?.getTime() === conversa.ultimaEntradaEm?.getTime() && !(atual.recusaAutomaticas && !conversa.recusaAutomaticas);
  };
  const piloto = await estadoPiloto();
  const modoAtendimento = atendimentoAposPiloto(piloto);
  if (!testeEquipe && (piloto || recursoPiloto())) {
    if (piloto?.ativo) {
      if (optOut) return;
      if (!permitePiloto(piloto, conversa.telefone, "ENTREVISTA_PILOTO") || conversa.estado === "HUMANO") return encaminhar();
      const r = await processarBotEntrevista({ conversaId: conversa.id, telefone: conversa.telefone }, texto);
      if (r.resposta) await enviarNaConversa(conversa.id, r.resposta, "BOT", { entrevistaPiloto: true });
      return; // Não existe fallback para modelo ou ferramentas operacionais no piloto.
    }
    if (!modoAtendimento) return encaminhar();
  }
  const entrevistaAtiva = !testeEquipe && !modoAtendimento && process.env.RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO === "true";
  const cfgEntrevista = entrevistaAtiva ? await configuracao() : null;
  if (cfgEntrevista && !cfgEntrevista.botAtivo) return encaminhar();
  // Uma sessão de entrevista existente não cai no modelo geral se o canal for desligado.
  if (conversa.estado !== "HUMANO" && !entrevistaAtiva && !contemConviteEntrevista(texto) && !comandoReservadoEntrevista(texto)) {
    if (await db.entrevistaRecrutamento.findUnique({ where: { conversaId: conversa.id }, select: { id: true } })) return;
  }
  if (e.texto && conversa.estado !== "HUMANO" && (contemConviteEntrevista(e.texto) || comandoReservadoEntrevista(e.texto) || entrevistaAtiva)) {
    if (modoAtendimento || testeEquipe) return;
    const entrevista = await processarBotEntrevista({ conversaId: conversa.id, telefone: conversa.telefone }, e.texto);
    if (entrevista.tratado) {
      if (entrevista.resposta && entrevistaAtiva) await enviarNaConversa(conversa.id, entrevista.resposta, "BOT");
      return;
    }
  }
  const cfg = cfgEntrevista ?? await configuracao();
  if (!cfg.botAtivo && !testeIndividual) return encaminhar();
  if (conversa.estado === "HUMANO") return;
  if (await tratarRespostaRoleta(conversa, roleta, e.midia ? null : e.texto, aindaComBot, encaminhar)) return;
  if (!testeEquipe && !optOut && e.texto && !e.midia && !sinal.aborted) {
    const campanha = await continuarCampanha(conversa, e.texto, aindaComBot);
    if (campanha === "equipe") return encaminhar("Conferir a resposta à campanha e continuar o atendimento.");
    if (campanha) return;
  }
  if (!testeEquipe && process.env.WHATSAPP_ATENDIMENTO_IA_PAGA !== "true" && process.env.WHATSAPP_ATENDIMENTO_APOS_PILOTO !== "true") return encaminhar();

  // "PARAR": desliga as mensagens automaticas na hora, sem passar pelo modelo.
  if (optOut) {
    await enviarNaConversa(conversa.id, "Pronto! Não vou mais mandar lembretes nem novidades. Se precisar marcar, é só chamar aqui. 🙂", "BOT", { respostaAtendimento: true });
    return;
  }

  if (conversa.conviteApp === "ENCERRADO" && conversa.clienteId && !e.midia && !sinal.aborted && await confirmarLembreteConvite(conversa.id, conversa.clienteId, texto, cfg.fuso)) return;
  const respondeuConvite = conversa.conviteApp === "AGUARDANDO" && !conversa.recusaAutomaticas && !sinal.aborted &&
    (await db.conversa.updateMany({
      where: { id: conversa.id, conviteApp: "AGUARDANDO", estado: "BOT", recusaAutomaticas: false, ultimaEntradaEm: conversa.ultimaEntradaEm },
      data: { conviteApp: "ENCERRADO" },
    })).count === 1;
  const jornada = (respondeuConvite || conversa.conviteApp === "ENCERRADO") ? await db.jornadaConviteApp.findUnique({ where: { conversaId: conversa.id } }) : null;
  const endereco = jornada ? enderecoDoConvite(jornada.token) : undefined;
  const contextoConvite = await contextoDaJornada(jornada, conversa.ultimaEntradaEm, texto, sinal);
  if (jornada && respondeuConvite) await db.jornadaConviteApp.update({ where: { conversaId: conversa.id }, data: { respostaEm: new Date(), proximaEm: null } });
  const bolhasDiretas = respondeuConvite && !e.midia ? respostaAoConvite(texto, endereco) : null;
  const respostaDireta = bolhasDiretas?.join("\n\n");
  // A autorização de IA é independente do estado do piloto e do bot geral.
  if (!respostaDireta && !testeEquipe && process.env.WHATSAPP_ATENDIMENTO_IA_PAGA !== "true") {
    await passarParaEquipe(conversa.id, "Atendimento encaminhado para a equipe; IA paga desativada.");
    await enviarNaConversa(conversa.id, respondeuConvite ? "A equipe da Black vai continuar contigo por aqui." : `Opa! A equipe da Black vai te ajudar por aqui. Se quiser marcar, dá pra acessar ${urlSite()}/c/agendar. 🙂`, "BOT", { respostaAtendimento: true });
    return;
  }

  let textoCliente = e.texto ?? "";
  let imagem: ImagemBot | undefined;
  if (e.midia) {
    try {
      const midia = await prepararMidia(e.midia, e.waId ?? e.telefone);
      textoCliente = [textoCliente, midia.texto].filter(Boolean).join("\n");
      imagem = midia.imagem;
      if (e.wamid && e.midia.tipo === "audio") await db.mensagem.updateMany({
        where: { conversaId: conversa.id, wamid: e.wamid, autor: "CLIENTE" },
        data: { texto: registroSeguroEntrevista(textoCliente) },
      });
    } catch {
      if (!await aindaComBot()) return;
      await passarParaEquipe(conversa.id, "Mídia não interpretada com segurança. Conferir o original no WhatsApp; não repetir ações ou cobranças.");
      await enviarNaConversa(conversa.id, "Não consegui interpretar esse arquivo com segurança. Pedi para a equipe conferir por aqui.", "BOT", { respostaAtendimento: true });
      return;
    }
  }
  if (!textoCliente) {
    await passarParaEquipe(conversa.id, "Arquivo sem conteúdo disponível no sistema. Conferir no WhatsApp original.");
    await enviarNaConversa(conversa.id, "Recebi um arquivo, mas não consegui abrir por aqui. A equipe vai conferir.", "BOT", { respostaAtendimento: true });
    return;
  }
  if (e.midia?.tipo === "audio" && pediuParar(textoCliente)) {
    await db.$transaction(async (tx) => {
      await travarPreferencia(tx, conversa.telefone);
      await atualizarPreferencia(tx, conversa.telefone, false);
    });
    await enviarNaConversa(conversa.id, "Pronto, desativei os lembretes e novidades para você.", "BOT", { respostaAtendimento: true });
    return;
  }
  if ((await estadoAtual())?.estado !== "BOT") return;
  if (e.midia?.tipo === "audio" && !testeEquipe && !sinal.aborted && await tratarRespostaRoleta(conversa,
    await registrarEntradaJornadaRoleta(conversa, textoCliente, false), textoCliente, aindaComBot, encaminhar)) return;

  const agora = Date.now();
  const sessaoValida =
    conversa.sessao &&
    conversa.sessaoInicioEm &&
    (!testeIndividual || +conversa.sessaoInicioEm >= Date.parse(process.env.WHATSAPP_ATENDIMENTO_TESTE_ATE ?? "") - 2 * 3_600_000) &&
    conversa.ultimaEntradaEm &&
    Array.isArray(conversa.sessao) &&
    conversa.sessao.length < SESSAO_MAX_MENSAGENS &&
    agora - (await ultimaAtividade(conversa.id)) < SESSAO_INATIVA_MS;
  const historico = sessaoValida ? (conversa.sessao as unknown as Anthropic.Beta.BetaMessageParam[]) : [];
  const cliente = await db.cliente.findUnique({ where: { telefone: conversa.telefone }, select: { id: true, nome: true } });
  const sit = cliente && !testeIndividual && !respostaDireta ? await situacaoDoCliente(cliente.id) : null;
  const plano = sit?.assinatura.ofertaDezembro ? (ofertaDezembroEmHomologacao() ? "Dezembro Grátis (contrato de homologação; consulte as datas no app)" : "precisa ser conferido pela equipe") : sit
    ? `${sit.assinatura.plano.nome} (${sit.assinatura.status === "PENDENTE" ? "aguardando o primeiro pagamento" : sit.valida ? (sit.assinatura.status === "ATRASADA" ? "ativo, com mensalidade atrasada" : "ativo e em dia") : "suspenso por mensalidade atrasada"}${sit.assinatura.plano.descontoExtrasPct ? `; ${sit.assinatura.plano.descontoExtrasPct}% de desconto em avulsos e serviços fora do plano` : ""})`
    : null;
  let resultado;
  try {
    const sistema = promptSistema(testeIndividual ? { ...cfg, agendaExternaAtiva: true } : cfg);
    resultado = respostaDireta ? {
      resposta: respostaDireta, ferramentas: [], recusado: false, passouParaHumano: false,
      historico: [...historico, { role: "user" as const, content: textoCliente }, { role: "assistant" as const, content: respostaDireta }],
    } : await executarTurno({
      sistema: testeIndividual
        ? sistema + "\nNo teste individual, resolva dúvidas com as ferramentas de consulta disponíveis. Pedidos de reserva, alteração de plano ou emissão de cobrança ficam com a equipe."
        : sistema,
      historico,
      contexto: contextoDaMensagem({
        agora, fuso: cfg.fuso, inicioDeSessao: historico.length === 0,
        janelaDias: cfg.janelaAgendamentoDias, cliente: cliente?.nome.trim() ? cliente : null, nomePerfil: conversa.nomePerfil,
        plano: testeIndividual ? undefined : plano,
        respondeuConviteApp: respondeuConvite,
        ...contextoConvite,
        avisos: await avisosRecentes(conversa.id, agora),
      }),
      texto: registroSeguroEntrevista(textoCliente),
      imagem,
      somenteConsulta: !!e.midia && e.midia.tipo !== "audio" && !e.texto?.trim(),
      ferramentasPermitidas: testeIndividual ? FERRAMENTAS_TESTE_REATIVACAO : undefined,
      podeContinuar: aindaComBot,
      ctx: { conversaId: conversa.id, telefone: conversa.telefone, nomePerfil: conversa.nomePerfil, textoEntrada: e.texto, entradaId: e.wamid },
      modelo: opts.modelo,
    });
  } catch (err) {
    console.error("[bot] falha ao chamar o modelo:", err instanceof Error ? err.name : "Erro");
    if (!await aindaComBot()) return;
    await passarParaEquipe(conversa.id, "Bot indisponível. Conferir o pedido e o histórico antes de executar qualquer ação.");
    await enviarNaConversa(conversa.id, "Opa! Tive um problema aqui. Já chamei alguém da equipe para te responder. 🙏", "BOT", { respostaAtendimento: true });
    return;
  }

  const modeloIndicouApp = respondeuConvite && !resultado.passouParaHumano && resultado.resposta.trim() === "[CONVITE_APP]";
  const bolhasConvite = modeloIndicouApp ? continuacaoConviteApp(endereco) : bolhasDiretas;
  if (modeloIndicouApp && bolhasConvite) {
    resultado.historico = historicoEntregue(resultado.historico, resultado.resposta, []);
    resultado.resposta = bolhasConvite.join("\n\n");
  }
  const turnoPrivado = resultado.ferramentas.some(nome => OPERACOES_PRIVADAS.has(nome));
  const sessaoDoTurno = (enviadas: string[]) => (turnoPrivado ? [] : historicoEntregue(resultado.historico, resultado.resposta, enviadas)) as unknown as Prisma.InputJsonValue;
  if (resultado.interrompido || sinal.aborted || (!resultado.passouParaHumano && !await aindaComBot())) {
    // Guarda inclusive resultados já executados, sem reabrir estado ou preferências.
    await db.conversa.update({ where: { id: conversa.id }, data: {
      sessao: sessaoDoTurno([]),
      sessaoInicioEm: historico.length ? conversa.sessaoInicioEm : new Date(),
    } });
    return;
  }

  if (resultado.recusado) {
    await passarParaEquipe(conversa.id, "O modelo recusou responder essa mensagem.");
    await db.conversa.update({ where: { id: conversa.id }, data: { sessao: (turnoPrivado ? [] : historicoSemImagens(resultado.historico)) as unknown as Prisma.InputJsonValue } });
    await enviarNaConversa(conversa.id, "Vou pedir para alguém da equipe te responder, tudo bem? 🙂", "BOT", { respostaAtendimento: true });
    return;
  }

  await db.conversa.update({
    where: { id: conversa.id },
    data: {
      sessao: sessaoDoTurno([]),
      sessaoInicioEm: historico.length ? conversa.sessaoInicioEm : new Date(),
      ...(resultado.passouParaHumano ? { estado: "HUMANO" } : {}),
    },
  });
  const podeEnviar = async () => {
    if (sinal.aborted) return false;
    const atual = await db.conversa.findUnique({ where: { id: conversa.id }, select: { estado: true, recusaAutomaticas: true, ultimaEntradaEm: true } });
    if (!atual || atual.estado !== (resultado.passouParaHumano ? "HUMANO" : "BOT")) return false;
    if (atual.ultimaEntradaEm?.getTime() !== conversa.ultimaEntradaEm?.getTime() || (atual.recusaAutomaticas && !conversa.recusaAutomaticas)) return false;
    const equipeAgora = await destinatarioTesteEquipe(conversa.telefone);
    if ((testeEquipeAtivo() || process.env.WHATSAPP_ENVIOS_BLOQUEADOS === "true") && !equipeAgora) return false;
    if (!equipeAgora && process.env.WHATSAPP_ATENDIMENTO_IA_PAGA !== "true" &&
        !(respostaDireta && process.env.WHATSAPP_ATENDIMENTO_APOS_PILOTO === "true")) return false;
    const pilotoAgora = await estadoPiloto();
    if (!equipeAgora && (pilotoAgora || recursoPiloto()) && !atendimentoAposPiloto(pilotoAgora)) return false;
    if (!testeIndividual && !(await configuracao()).botAtivo) return false;
    if (resultado.passouParaHumano) {
      const equipe = await db.mensagem.findMany({ where: { conversaId: conversa.id, autor: "EQUIPE", criadoEm: { gte: inicioTurno } }, take: 1, select: { id: true } });
      if (equipe.length) return false;
    }
    return !sinal.aborted;
  };
  const bolhas = bolhasConvite ?? dividirEmBolhas(resultado.resposta);
  const enviadas: string[] = [];
  const destino = conversa.waId && telefoneCanonico(conversa.waId) === conversa.telefone ? conversa.waId : conversa.telefone;
  for (const bolha of bolhas) {
    if (!await podeEnviar()) return;
    // A espera fica local e cancelável; o provedor não recebe uma entrega atrasada irrevogável.
    const provedor = provedorWhatsApp();
    const atraso = tempoDigitando(bolha);
    if (provedor === "evolution") void indicarDigitacaoEvolution(destino, atraso, sinal).catch(() => {});
    if (provedor !== "simulador" && !await esperarBolha(atraso, sinal)) return;
    if (!await podeEnviar()) return;
    const envio = await enviarNaConversa(conversa.id, bolha, "BOT", { digitandoMs: 0, respostaAtendimento: true, ...(bolhasConvite ? { pararSeHumano: true } : {}) });
    if (!envio.ok || (bolhasConvite && provedor !== "simulador" && !envio.wamid)) return;
    if (respondeuConvite && jornada && bolha === endereco) await db.jornadaConviteApp.updateMany({ where: { conversaId: conversa.id, parouEm: null }, data: {
      linkId: envio.mensagemId, proximaEm: new Date(Date.now() + 86_400_000),
    } });
    enviadas.push(bolha);
    await db.conversa.update({ where: { id: conversa.id }, data: { sessao: sessaoDoTurno(enviadas) } });
  }
}

/** Mensagens automaticas (SISTEMA) desde a fala anterior do cliente: o lembrete que ele esta respondendo. */
async function avisosRecentes(conversaId: string, agora: number) {
  const recentes = await db.mensagem.findMany({
    where: { conversaId, criadoEm: { gt: new Date(agora - 48 * 3_600_000) } },
    orderBy: { criadoEm: "desc" },
    take: 15,
    select: { autor: true, texto: true, erro: true },
  });
  const avisos: string[] = [];
  let passouAtual = false;
  for (const m of recentes) {
    if (!passouAtual) {
      passouAtual = m.autor === "CLIENTE"; // a primeira mensagem do cliente e a que chegou agora
      continue;
    }
    if (m.autor === "CLIENTE") break;
    if (!m.erro && (m.autor === "SISTEMA" || (m.autor === "BOT" && (m.texto.startsWith(APRESENTACAO_REATIVACAO) || m.texto === AVISO_TROCA_APP)))) {
      avisos.push(registroSeguroEntrevista(m.texto));
    }
  }
  return avisos.slice(0, 3).reverse();
}

async function passarParaEquipe(conversaId: string, motivo: string) {
  await db.conversa.update({ where: { id: conversaId }, data: { estado: "HUMANO" } });
  await db.mensagem.create({ data: { conversaId, autor: "NOTA", texto: motivo } });
  publicar({ tipo: "conversa", conversaId });
}
