// Teste de integracao das campanhas (segmentos, lotes, limite diario, quem pula, resultado) contra o banco de
// DESENVOLVIMENTO, com o WhatsApp em modo simulador. Usa datas em 2031 e so os clientes que cria.
// Rodar: npm run teste:campanhas
process.env.WHATSAPP_PROVIDER = "simulador";

import type { Sessao } from "@/lib/auth/sessao";
import { receberMensagem } from "@/lib/bot/processar";
import { rodarAutomacoes } from "@/lib/automacoes/rotina";
import { capacidadeDaAgenda } from "@/lib/campanhas/capacidade";
import { funilCampanha } from "@/lib/campanhas/funil";
import { landingDaCampanha, marcarAppAberto, registrarClique } from "@/lib/campanhas/link";
import { revisaoDaCampanha } from "@/lib/campanhas/lote-autorizado";
import { criarCampanha, liberarLote, listarCampanhas, mudarStatus, processarCampanhas } from "@/lib/campanhas/servico";
import { db } from "@/lib/db";
import { jogarPelaCampanha } from "@/lib/jogos/motor";
import { configurarPiloto, estadoPiloto } from "@/lib/whatsapp/piloto";
import { enviarTexto } from "@/lib/whatsapp/canal";
import { registrarStatus } from "@/lib/whatsapp/status";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string }; } };
const D = 86_400_000;
const agora = Date.UTC(2031, 2, 5, 15, 0); // quarta 05/03/2031 12:00 em Brasilia
const TELS = ["5511966660001", "5511966660002", "5511966660003", "5511966660004", "5511966660005"];
const TAG = "[teste campanhas]";
const JOGO = "teste-campanhas-roleta";

async function limpar() {
  const cs = await db.cliente.findMany({ where: { telefone: { in: TELS } }, select: { id: true } });
  const ids = cs.map((c) => c.id);
  await db.campanha.deleteMany({ where: { nome: { startsWith: TAG } } });
  const comandas = (await db.comanda.findMany({ where: { clienteId: { in: ids } }, select: { id: true } })).map((c) => c.id);
  await db.pagamentoComanda.deleteMany({ where: { comandaId: { in: comandas } } });
  await db.itemComanda.deleteMany({ where: { comandaId: { in: comandas } } });
  await db.comanda.deleteMany({ where: { id: { in: comandas } } });
  await db.premioGanho.deleteMany({ where: { clienteId: { in: ids } } });
  await db.jogada.deleteMany({ where: { clienteId: { in: ids } } });
  await db.beneficio.deleteMany({ where: { clienteId: { in: ids } } });
  await db.agendamento.deleteMany({ where: { clienteId: { in: ids } } });
  await db.assinatura.deleteMany({ where: { clienteId: { in: ids } } });
  const conversas = await db.conversa.findMany({ where: { telefone: { in: TELS } }, select: { id: true } });
  await db.mensagem.deleteMany({ where: { conversaId: { in: conversas.map((c) => c.id) } } });
  await db.conversa.deleteMany({ where: { telefone: { in: TELS } } });
  await db.cliente.deleteMany({ where: { id: { in: ids } } });
  await db.usuario.deleteMany({ where: { telefone: { in: TELS } } });
  await db.jogo.deleteMany({ where: { id: JOGO } });
}

// O canal simulado conclui no relógio de 2031 deste teste.
async function noInstante<T>(instante: number, executar: () => Promise<T>) {
  const relogio = Date.now;
  let proximo = instante + 1000;
  Date.now = () => proximo++;
  try { return await executar(); } finally { Date.now = relogio; }
}

async function main() {
  await limpar();
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, barbeiroId: null, clienteId: null };
  const barbeiro = await db.barbeiro.findFirstOrThrow({ where: { ativo: true } });
  const servico = await db.servico.findFirstOrThrow({ where: { ativo: true } });
  const plano = await db.plano.findFirstOrThrow();
  // Fixture própria: a roleta padrão pode existir sem prêmios após outras migrações/testes.
  // O teste do funil não depende de chances ou estoque configurados fora dele.
  await db.jogo.create({ data: {
    id: JOGO, tipo: "ROLETA", nome: "Roleta de teste das campanhas", ativo: false,
    premios: { create: [
      { rotulo: "R$ 5 de teste", tipo: "CREDITO", valorCentavos: 500, chanceBps: 9999, cor: "#C9A24A" },
      { rotulo: "Outra jogada", tipo: "NADA", chanceBps: 1, cor: "#aaaabb" },
    ] },
  } });
  try {
    const cliente = (tel: string, nome: string, aceitaMensagens = true) => db.cliente.create({ data: { telefone: tel, nome, aceitaMensagens } });
    const visita = (clienteId: string, quando: number, status: "CONCLUIDO" | "MARCADO" = "CONCLUIDO") => db.agendamento.create({
      data: { clienteId, barbeiroId: barbeiro.id, servicoId: servico.id, inicio: new Date(quando), fim: new Date(quando + 30 * 60_000), status, origem: "PAINEL", precoCentavos: 5000 },
    });
    const a = await cliente(TELS[0], `Ana Recente ${TAG}`);
    await visita(a.id, agora - 10 * D);
    const b = await cliente(TELS[1], `Bruno Quarenta ${TAG}`);
    await visita(b.id, agora - 45 * D);
    await db.assinatura.create({ data: { clienteId: b.id, planoId: plano.id, status: "ATIVA", formaPagamento: "PIX", precoCentavos: 9900, origem: "PAINEL" } });
    const c = await cliente(TELS[2], `Caio Sumido ${TAG}`);
    await visita(c.id, agora - 100 * D);
    const d = await cliente(TELS[3], `Davi Marcado ${TAG}`);
    await visita(d.id, agora - 20 * D);
    await visita(d.id, agora + 2 * D, "MARCADO");
    const e = await cliente(TELS[4], `Eva Parou ${TAG}`, false);
    await visita(e.id, agora - 5 * D);
    const todos = [a.id, b.id, c.id, d.id, e.id];
    const naFila = async (campanhaId: string) => (await db.campanhaEnvio.findMany({ where: { campanhaId } })).map((x) => x.clienteId).sort();

    // ================= LOTE: SO QUEM PODE RECEBER, NOS SEGMENTOS
    const base = { mensagem: "Oi, {nome}! A {barbearia} abriu horários: {link}", limiteDiario: 1, taxaRespostaBps: 2000 };
    const c60 = await criarCampanha(s, { ...base, nome: `${TAG} últimos 60 dias`, segmentos: ["ate30", "d31a60"] });
    const l1 = await liberarLote(s, c60.id, 1, agora, { clienteIds: todos });
    ok(l1.lote === 1 && l1.quantidade === 1 && (await naFila(c60.id))[0] === a.id, "lote 1 de 1: o mais recente primeiro (Ana, 10 dias)");
    const l2 = await liberarLote(s, c60.id, 50, agora, { clienteIds: todos });
    ok(l2.lote === 2 && l2.quantidade === 1 && (await naFila(c60.id)).join() === [a.id, b.id].sort().join(), "lote 2: só o Bruno (fora: 100 dias, quem tem horário marcado e quem pediu PARAR)");
    ok((await falha(() => liberarLote(s, c60.id, 10, agora, { clienteIds: todos })))?.codigo === "sem_elegiveis", "ninguém mais para chamar: avisa");

    const cAss = await criarCampanha(s, { ...base, nome: `${TAG} assinantes`, segmentos: ["assinante"] });
    await liberarLote(s, cAss.id, 50, agora, { clienteIds: todos });
    ok((await naFila(cAss.id)).join() === b.id, "segmento assinante: só quem tem assinatura ativa");
    const cPerd = await criarCampanha(s, { ...base, nome: `${TAG} perdidos`, segmentos: ["perdido"] });
    ok((await falha(() => liberarLote(s, cPerd.id, 50, agora, { clienteIds: todos })))?.message.includes("roleta ativa") === true, "campanha fria sem roleta não entra na fila");
    await db.jogo.update({ where: { id: JOGO }, data: { ativo: true } });
    await db.campanha.update({ where: { id: cPerd.id }, data: { jogoId: JOGO } });
    await liberarLote(s, cPerd.id, 50, agora, { clienteIds: todos });
    ok((await naFila(cPerd.id)).join() === c.id, "segmento perdido: mais de 90 dias sem vir");
    await mudarStatus(s, cAss.id, "encerrar");
    await mudarStatus(s, cPerd.id, "encerrar");
    ok((await db.campanhaEnvio.count({ where: { campanhaId: { in: [cAss.id, cPerd.id] }, status: "PULADO" } })) === 2, "encerrar: quem estava na fila não recebe");

    // ================= ENVIO COM LIMITE DIARIO
    ok((await noInstante(agora, () => processarCampanhas(agora, { clienteIds: todos }))) === 1, "limite 1/dia: sai uma mensagem");
    ok((await processarCampanhas(agora + 60_000, { clienteIds: todos })) === 0, "no mesmo dia não sai mais nenhuma");
    const conversaA = await db.conversa.findFirst({ where: { telefone: TELS[0] }, include: { mensagens: { orderBy: [{ criadoEm: "asc" }, { id: "asc" }] } } });
    ok(conversaA?.mensagens.map(m => m.texto).join("|") === "Fala, Ana!|Aqui é o Leonel da Black.", "abertura em dois balões, sem oferta nem link");

    await db.cliente.update({ where: { id: b.id }, data: { aceitaMensagens: false } });
    ok((await processarCampanhas(agora + D, { clienteIds: todos })) === 0, "no dia seguinte: quem pediu PARAR depois do lote é pulado");
    ok((await db.campanhaEnvio.findFirst({ where: { campanhaId: c60.id, clienteId: b.id } }))?.status === "PULADO", "fica como PULADO, com o motivo");

    // ================= PAUSA E RESULTADO
    await mudarStatus(s, c60.id, "pausar");
    ok((await falha(() => liberarLote(s, c60.id, 1, agora, { clienteIds: todos })))?.message.includes("Retome") === true, "pausada não libera lote");
    await mudarStatus(s, c60.id, "retomar");
    await db.agendamento.create({
      data: { clienteId: a.id, barbeiroId: barbeiro.id, servicoId: servico.id, inicio: new Date(agora + 3 * D), fim: new Date(agora + 3 * D + 30 * 60_000), status: "MARCADO", origem: "SITE", precoCentavos: 5000, criadoEm: new Date(agora + 2 * 3_600_000) },
    });
    const r = (await listarCampanhas(agora)).find((x) => x.id === c60.id)!;
    ok(r.enviados === 1 && r.marcaram === 1 && r.pulados === 1 && r.fila === 0 && r.enviadosHoje === 1, "resultado: 1 enviado, 1 marcou depois, 1 pulado");

    // ================= DUAS RODADAS AO MESMO TEMPO NAO MANDAM DUAS VEZES
    await db.cliente.update({ where: { id: b.id }, data: { aceitaMensagens: true } });
    const cDup = await criarCampanha(s, { ...base, limiteDiario: 50, nome: `${TAG} duplo`, segmentos: ["d31a60"] });
    await liberarLote(s, cDup.id, 10, agora, { clienteIds: todos });
    const [x, y] = await noInstante(agora + 2 * D, () => Promise.all([processarCampanhas(agora + 2 * D, { clienteIds: todos }), processarCampanhas(agora + 2 * D, { clienteIds: todos })]));
    const conversaB = await db.conversa.findFirst({ where: { telefone: TELS[1] }, include: { mensagens: true } });
    ok(x + y === 1 && conversaB?.mensagens.length === 2, "duas rodadas juntas: o Bruno recebe somente uma abertura de dois balões");

    // ================= FUNIL DA CAMPANHA DA ROLETA
    // 5 dias depois: o horario da Ana (agora + 3 dias) ja passou e ela volta a poder receber.
    const depois = agora + 5 * D;
    await db.jogo.update({ where: { id: JOGO }, data: { ativo: true } });
    ok((await falha(() => criarCampanha(s, { ...base, nome: `${TAG} roleta sem link`, segmentos: ["ate30"], mensagem: "Oi {nome}, gire a roleta!", jogoId: JOGO })))?.message.includes("{link}") === true, "campanha da roleta sem {link} é recusada");
    const cRol = await criarCampanha(s, { ...base, limiteDiario: 50, nome: `${TAG} roleta`, segmentos: ["ate30", "d31a60"], mensagem: "Oi, {nome}! Gire: {link}. Para sair, basta responder SAIR.", jogoId: JOGO });
    await liberarLote(s, cRol.id, 10, depois, { clienteIds: [a.id, b.id] });
    const fila = await db.campanhaEnvio.findMany({ where: { campanhaId: cRol.id } });
    ok(fila.length === 2 && fila.every((e) => e.token && e.token.length >= 16) && new Set(fila.map((e) => e.token)).size === 2, "cada mensagem tem o seu link (token)");
    const tokenA = fila.find((e) => e.clienteId === a.id)!.token!, tokenB = fila.find((e) => e.clienteId === b.id)!.token!;
    ok((await landingDaCampanha(tokenA)) === null, "link de mensagem que ainda não saiu não abre");
    ok((await noInstante(depois, () => processarCampanhas(depois, { clienteIds: [a.id, b.id] }))) === 2, "roleta: as 2 mensagens saem");
    const confirmados = await db.campanhaEnvio.findMany({ where: { campanhaId: cRol.id }, select: { enviadoEm: true } });
    ok(confirmados.length === 2 && confirmados.every(e => +e.enviadoEm! > depois) &&
      new Set(confirmados.map(e => +e.enviadoEm!)).size === 2, "cada contato guarda o instante de sucesso após a reserva do lote");
    const envA = await db.campanhaEnvio.findFirstOrThrow({ where: { token: tokenA }, include: { mensagem: true } });
    ok(envA.mensagem?.texto === "Aqui é o Leonel da Black." && !envA.ofertaEnviadaEm, "primeiro contato sem o link da roleta");
    await db.campanha.update({ where: { id: cRol.id }, data: { mensagem: "Novo texto depois da abertura: {link}" } });
    const resposta = depois + 60_000;
    for (const [i, telefone] of TELS.slice(0, 2).entries()) {
      await noInstante(resposta, () => receberMensagem({ telefone, texto: "Pode mandar!", wamid: `simulacao-campanha-teste-${i}` }));
    }
    const confirmada = await db.campanhaEnvio.findUniqueOrThrow({ where: { id: envA.id } });
    const oferta = await db.mensagem.findFirst({ where: { conversaId: envA.mensagem?.conversaId, texto: { contains: `/c/r/${tokenA}` } } });
    ok(!!confirmada.respostaEm && !!confirmada.ofertaEnviadaEm && !!oferta?.texto.startsWith("Oi, Ana! Gire:") &&
      oferta.texto === confirmada.ofertaTexto && oferta.texto.includes("responder SAIR"), "aceite envia a oferta original da roleta, com link individual e saída");
    await noInstante(resposta + 1000, () => receberMensagem({ telefone: TELS[0], texto: "Pode mandar!", wamid: "simulacao-campanha-teste-0" }));
    ok(await db.mensagem.count({ where: { conversaId: envA.mensagem?.conversaId, texto: { contains: `/c/r/${tokenA}` } } }) === 1,
      "webhook repetido não duplica a oferta");

    // WhatsApp confirma entregue e lida (o simulador nao manda id: o teste coloca um)
    await db.mensagem.update({ where: { id: envA.mensagemId! }, data: { wamid: `wamid.teste.${tokenA}` } });
    await registrarStatus([{ wamid: `wamid.teste.${tokenA}`, status: "LIDA", quando: depois + 60_000, erro: null }]);
    const msgA = await db.mensagem.findUniqueOrThrow({ where: { id: envA.mensagemId! } });
    ok(!!msgA.entregueEm && !!msgA.lidaEm, "lida também conta como entregue");

    // Pagina do link, clique e giro de presente
    const land = await landingDaCampanha(tokenA);
    ok(land?.nome === "Ana" && !!land.jogo && !land.jogo.jogada && land.jogo.fatias.length > 0, "página do link: nome, roleta e prêmios, ainda sem jogada");
    await registrarClique(tokenA);
    const g1 = await jogarPelaCampanha(tokenA);
    const g2 = await jogarPelaCampanha(tokenA);
    ok(!g1.jaJogou && g2.jaJogou && g2.jogada.id === g1.jogada.id && (await db.jogada.count({ where: { clienteId: a.id, origem: "CAMPANHA" } })) === 1, "uma jogada por link: abrir de novo mostra o mesmo prêmio");
    await jogarPelaCampanha(tokenB);
    ok(!!(await db.campanhaEnvio.findFirstOrThrow({ where: { token: tokenB } })).clicouEm, "girar sem a visita registrada também conta o clique");
    ok((await falha(() => jogarPelaCampanha("token-que-nao-existe-123")))?.codigo === "nao_encontrado", "link inventado não gira");

    // Abriu o app, criou conta, agendou, veio e resgatou
    await marcarAppAberto(a.id, depois + 3_600_000);
    const usuarioA = await db.usuario.create({ data: { telefone: TELS[0], nome: "Ana", papel: "CLIENTE", criadoEm: new Date(depois + 3_600_000) } });
    await db.cliente.update({ where: { id: a.id }, data: { usuarioId: usuarioA.id } });
    const agA = await db.agendamento.create({
      data: { clienteId: a.id, barbeiroId: barbeiro.id, servicoId: servico.id, inicio: new Date(depois + 2 * D), fim: new Date(depois + 2 * D + 30 * 60_000), status: "CONCLUIDO", origem: "SITE", precoCentavos: 5000, criadoEm: new Date(depois + 2 * 3_600_000) },
    });
    await db.comanda.create({
      data: { clienteId: a.id, status: "FECHADA", fechadaEm: new Date(depois + 2 * D), itens: { create: [{ descricao: "Corte", precoUnitCentavos: 5000, agendamentoId: agA.id }] }, pagamentos: { create: [{ forma: "PIX", valorCentavos: 5000, status: "PAGO", pagoEm: new Date(depois + 2 * D) }] } },
    });
    const giroA = await db.jogada.findFirstOrThrow({ where: { clienteId: a.id, origem: "CAMPANHA" }, include: { premios: true } });
    const premioA = giroA.premios[0];
    if (premioA?.tipo === "CREDITO" && premioA.beneficioId) await db.beneficio.update({ where: { id: premioA.beneficioId }, data: { status: "USADO", usadoEm: new Date(depois + 2 * D) } });
    if (premioA && premioA.tipo !== "CREDITO") await db.premioGanho.update({ where: { id: premioA.id }, data: { status: "UTILIZADO", utilizadoEm: new Date(depois + 2 * D) } });

    const funil = await funilCampanha(cRol.id);
    const etapa = Object.fromEntries(funil.etapas.map((e) => [e.chave, e.qtd]));
    ok(etapa.enviadas === 2 && etapa.entregues === 1 && etapa.lidas === 1 && etapa.clicaram === 2 && etapa.giraram === 2, `funil: 2 enviadas → 1 entregue/lida → 2 abriram → 2 giraram (${JSON.stringify(etapa)})`);
    ok(etapa.app === 1 && etapa.conta === 1 && etapa.agendaram === 1 && etapa.compareceram === 1, "funil: 1 abriu o app, tem conta, agendou e veio");
    ok(etapa.resgataram === (premioA ? 1 : 0), `funil: resgate do prêmio (${premioA?.tipo ?? "nada"})`);
    ok(funil.faturadoCentavos === 5000 && funil.comandas === 1 && funil.ticketMedioCentavos === 5000, "funil: R$ 50 faturados na comanda do atendimento");

    // ================= CAPACIDADE (estrutura)
    const cap = await capacidadeDaAgenda();
    const [h3, h7, h14] = cap.horizontes;
    ok(h3.dias === 3 && h7.dias === 7 && h14.dias === 14 && h3.vagas <= h7.vagas && h7.vagas <= h14.vagas, "capacidade: 3 ≤ 7 ≤ 14 dias");
    ok(h7.porBarbeiro.reduce((t, b) => t + b.vagas, 0) === h7.vagas, "capacidade: total = soma dos barbeiros");

    // Com os envios gerais bloqueados, a confirmação do dono aprova só os clientes da lista.
    const horaLote = depois + 4 * D;
    const outra = await criarCampanha(s, { ...base, nome: `${TAG} outra campanha`, segmentos: ["ate30"] });
    await liberarLote(s, outra.id, 1, horaLote, { clienteIds: [d.id] });
    const restrita = await criarCampanha(s, { ...base, limiteDiario: 2, nome: `${TAG} lista conferida`, segmentos: ["ate30", "d31a60"] });
    await mudarStatus(s, restrita.id, "pausar");
    process.env.AMBIENTE = "homologacao";
    process.env.WHATSAPP_ENVIOS_BLOQUEADOS = "true";
    process.env.WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO = "true";
    process.env.WHATSAPP_LOTE_CAMPANHA_AUTORIZADO = JSON.stringify({
      campanhaId: restrita.id, clienteIds: [a.id, b.id], revisao: revisaoDaCampanha(restrita),
    });
    const verificaLote = async (n: number) => (await db.campanhaEnvio.count({ where: { campanhaId: restrita.id } })) === n;
    ok((await listarCampanhas(horaLote)).find(x => x.id === restrita.id)?.loteAutorizado === 2, "só o lote conferido aparece disponível no painel");
    ok(Object.values(await noInstante(horaLote, () => rodarAutomacoes(horaLote))).every(n => n === 0) && await verificaLote(0), "ativar a autorização não cria fila nem executa as outras rotinas");
    await db.campanha.update({ where: { id: restrita.id }, data: { status: "ATIVA" } });
    const filaAnterior = await db.campanhaEnvio.create({ data: { campanhaId: restrita.id, clienteId: a.id, lote: 1, token: "lote-teste-anterior" } });
    ok((await noInstante(horaLote, () => rodarAutomacoes(horaLote))).campanha === 0, "fila anterior da própria campanha aguarda a confirmação do lote");
    await db.campanhaEnvio.delete({ where: { id: filaAnterior.id } });
    await mudarStatus(s, restrita.id, "pausar");
    ok((await falha(() => liberarLote(s, outra.id, 1, horaLote)))?.codigo === "campanhas_bloqueadas", "outra campanha continua bloqueada");
    ok(!!await falha(() => liberarLote(s, restrita.id, 1, horaLote)), "painel precisa confirmar a quantidade conferida");
    await db.cliente.update({ where: { id: a.id }, data: { aceitaMensagens: false } });
    ok(!!await falha(() => liberarLote(s, restrita.id, 2, horaLote)) && await verificaLote(0), "perda de elegibilidade não substitui o cliente aprovado");
    await db.cliente.update({ where: { id: a.id }, data: { aceitaMensagens: true } });
    const piloto = await configurarPiloto(s.usuarioId, (await estadoPiloto())?.versao ?? 0, TELS[4]);
    try {
      ok((await falha(() => liberarLote(s, restrita.id, 2, horaLote)))?.codigo === "campanhas_bloqueadas", "piloto em andamento bloqueia a autorização");
    } finally {
      await configurarPiloto(s.usuarioId, piloto?.versao ?? 0, null);
    }
    const resultados = await Promise.allSettled([liberarLote(s, restrita.id, 2, horaLote), liberarLote(s, restrita.id, 2, horaLote)]);
    ok(resultados.filter(r => r.status === "fulfilled").length === 1 &&
      (await naFila(restrita.id)).join() === [a.id, b.id].sort().join(), "dois cliques criam um lote com os nomes aprovados");
    ok((await rodarAutomacoes(horaLote - 5 * 3_600_000)).campanha === 0, "lote autorizado espera o horário comercial");
    ok((await noInstante(horaLote, () => rodarAutomacoes(horaLote))).campanha === 2 &&
      await db.campanhaEnvio.count({ where: { campanhaId: restrita.id, status: "ENVIADO", mensagemId: { not: null } } }) === 2 &&
      await db.campanhaEnvio.count({ where: { campanhaId: outra.id, status: "FILA" } }) === 1, "simulador processa só o lote autorizado e preserva a outra fila");
    await noInstante(horaLote + 60_000, () => receberMensagem({ telefone: TELS[1], texto: "Oi Leonel" }));
    const bloqueada = await db.conversa.findUniqueOrThrow({ where: { telefone: TELS[1] }, include: { mensagens: { where: { autor: "NOTA" } } } });
    ok(bloqueada.estado === "HUMANO" && bloqueada.mensagens.length === 1 &&
      await db.campanhaEnvio.count({ where: { campanhaId: restrita.id, ofertaEnviadaEm: { not: null } } }) === 0, "resposta ao lote autorizado entra na fila humana sob bloqueio e não libera oferta");

    // A liberação manual convive com o bot, sem reabrir as demais rotinas.
    await mudarStatus(s, outra.id, "pausar");
    const manual = await criarCampanha(s, { ...base, nome: `${TAG} liberação manual`, segmentos: ["d31a60"] });
    await mudarStatus(s, manual.id, "pausar");
    delete process.env.WHATSAPP_LOTE_CAMPANHA_AUTORIZADO;
    process.env.WHATSAPP_ENVIOS_BLOQUEADOS = "false";
    process.env.WHATSAPP_ATENDIMENTO_APOS_PILOTO = "true";
    ok((await falha(() => mudarStatus(s, manual.id, "retomar")))?.codigo === "campanhas_bloqueadas", "atendimento liberado ainda isola campanhas");
    process.env.WHATSAPP_CAMPANHAS_MANUAIS_ATIVAS = "true";
    const segunda = horaLote + 3 * D;
    ok((await rodarAutomacoes(segunda, { clienteIds: todos })).campanha === 0 && (await naFila(manual.id)).length === 0, "desbloquear o painel não retoma campanhas nem cria fila");
    await mudarStatus(s, manual.id, "retomar");
    ok((await rodarAutomacoes(segunda, { clienteIds: todos })).campanha === 0, "retomar sozinho não dispara mensagens");
    await liberarLote(s, manual.id, 1, segunda, { clienteIds: [d.id] });
    await mudarStatus(s, manual.id, "pausar");
    ok((await rodarAutomacoes(segunda, { clienteIds: todos })).campanha === 0, "pausa de novo preserva o lote sem enviar");
    await mudarStatus(s, manual.id, "retomar");
    const rodada = await noInstante(segunda, () => rodarAutomacoes(segunda, { clienteIds: todos }));
    ok(rodada.campanha === 1 && Object.entries(rodada).every(([tipo, n]) => tipo === "campanha" || n === 0) &&
      await db.campanhaEnvio.count({ where: { campanhaId: manual.id, status: "ENVIADO", mensagemId: { not: null } } }) === 1 &&
      await db.campanhaEnvio.count({ where: { campanhaId: outra.id, status: "FILA" } }) === 1, "só o lote manual ativo é processado");
    ok(!!await falha(() => enviarTexto(TELS[4], "aviso avulso")), "desbloquear campanhas não libera avisos genéricos");
  } finally {
    await limpar();
  }
  console.log(process.exitCode ? "\nAlgum teste FALHOU." : "\nTodos os testes passaram.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
