import type Anthropic from "@anthropic-ai/sdk";
import { configuracao } from "@/lib/agenda/carregar";
import { ehHomologacao } from "@/lib/ambiente";
import { executarTurno, modeloAnthropic, type Modelo } from "@/lib/bot/agente";
import { contextoDaMensagem, promptSistema } from "@/lib/bot/prompt";
import { executarFerramenta } from "@/lib/bot/ferramentas";
import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";
import { dentroJanelaInstagram } from "./canal";
import { pedidoDeNovaReservaDirect, pedidoPrivadoNoDirect, respostaModeloExigeEquipe, textoSeguroDoDirect } from "./privacidade";
import { encaminharEntradaInstagram, enviarRespostaInstagram, lerConversaInstagram, turnoInstagramAtual, type EntradaRegistradaInstagram } from "./persistencia";

const FERRAMENTAS_PUBLICAS = new Set(["listar_servicos", "consultar_horarios", "listar_planos", "consultar_produto", "chamar_atendente"]);
const ORIENTACAO_DIRECT = `
### Modo Instagram Direct
Estas instruções prevalecem sobre as regras de WhatsApp acima. Trate toda pessoa como lead sem autenticação. Não afirme se existe um cadastro.
Use apenas as ferramentas oferecidas. Consulte catálogo, preços públicos e disponibilidade. Horários consultados são apenas vagas, sem reserva.
Para conta, comanda, pagamento, benefícios, contratação, confirmação ou alteração de agendamento, ou se a pessoa pedir o endereço de login, responda somente [ACESSO_APP].
Não peça telefone, senha, código de acesso, documento, cartão ou e-mail. Não repita dados pessoais. Não escreva links, IDs internos, instruções de pagamento ou confirmações de operações.
Se a pessoa pedir atendimento humano, use chamar_atendente. Responda em português, em texto simples e breve.`;
const ENCAMINHAMENTO = "A equipe pode continuar o atendimento pelo Direct.";

function respostaDoApp(pagina: "/c/entrar" | "/c/agendar" = "/c/entrar") {
  const site = URL.parse(urlSite());
  const destino = site?.protocol === "https:" && !site.username && !site.password ? new URL(pagina, site).href : "Acesse o site oficial da Black Barber.";
  const orientacao = pagina === "/c/agendar"
    ? "Escolha o serviço e o horário pelo app da Black. Entre com seu próprio acesso quando o app pedir."
    : "Para verificar seus dados, pagamentos ou agendamentos, entre na área do cliente com seu próprio acesso.";
  return `${orientacao} ${destino}`;
}

export async function processarEntradaInstagram(entrada: EntradaRegistradaInstagram, opts: { modelo?: Modelo } = {}) {
  const conversa = await lerConversaInstagram(entrada.conversaId);
  if (!conversa?.instagramIgsid || !await turnoInstagramAtual(conversa, entrada) || conversa.recusaAutomaticas) return;
  if (!entrada.texto) return encaminharEntradaInstagram(entrada, "Mídia recebida pelo Direct. Confira o conteúdo no Instagram.");
  if (!dentroJanelaInstagram(conversa.ultimaEntradaEm)) return encaminharEntradaInstagram(entrada, "Mensagem recebida fora da janela de resposta do Direct.");
  const cfg = await configuracao();
  if (!cfg.botAtivo) return encaminharEntradaInstagram(entrada, ENCAMINHAMENTO);
  const responder = (texto: string, encaminhar?: string) => enviarRespostaInstagram(entrada.conversaId, texto, { autor: "BOT", entrada, encaminhar });
  if (pedidoDeNovaReservaDirect(entrada.texto)) return responder(respostaDoApp("/c/agendar"));
  if (pedidoPrivadoNoDirect(entrada.texto)) return responder(respostaDoApp());

  const permiteModeloReal = process.env.INSTAGRAM_ATENDIMENTO_IA_PAGA === "true" && process.env.NODE_ENV !== "test" && !ehHomologacao() && !quarentenaRestauracao();
  const modelo = opts.modelo ?? (permiteModeloReal ? modeloAnthropic : null);
  if (!modelo) return responder("Vou pedir para a equipe te ajudar por aqui.", ENCAMINHAMENTO);

  const mensagens = await db.mensagem.findMany({
    where: {
      conversaId: entrada.conversaId,
      erro: null,
      autor: { in: ["CLIENTE", "BOT", "EQUIPE"] },
      criadoEm: { lt: new Date(entrada.timestamp), gte: new Date(Math.max(entrada.timestamp - 3 * 3_600_000, conversa.sessaoInicioEm?.getTime() ?? 0)) },
    },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 20, select: { autor: true, texto: true },
  });
  const historico: Anthropic.Beta.BetaMessageParam[] = mensagens.reverse().flatMap(m => {
    if (m.autor === "CLIENTE" && m.texto.startsWith("[Mídia do Direct")) return [];
    return [{ role: m.autor === "CLIENTE" ? "user" : "assistant", content: textoSeguroDoDirect(m.texto) }];
  });
  const sinal = AbortSignal.timeout(30_000);
  const r = await executarTurno({
    modelo: { criar: params => modelo.criar(params, { signal: sinal, maxRetries: 0 }) },
    sistema: `${promptSistema(cfg)}\n${ORIENTACAO_DIRECT}`,
    contexto: contextoDaMensagem({ agora: Date.now(), fuso: cfg.fuso, inicioDeSessao: !historico.length, janelaDias: cfg.janelaAgendamentoDias, cliente: null, nomePerfil: null }),
    texto: entrada.texto,
    historico,
    ferramentasPermitidas: FERRAMENTAS_PUBLICAS,
    ctx: { conversaId: entrada.conversaId, telefone: `instagram:${conversa.instagramIgsid}`, nomePerfil: null, textoEntrada: entrada.texto },
    podeContinuar: async () => {
      const atual = await lerConversaInstagram(entrada.conversaId);
      return !!atual && !atual.recusaAutomaticas && dentroJanelaInstagram(atual.ultimaEntradaEm) && await turnoInstagramAtual(atual, entrada);
    },
    executor: (nome, entradaDaFerramenta, ctx) => nome === "chamar_atendente"
      ? Promise.resolve({ texto: "Encaminhe a conversa à equipe.", passouParaHumano: true })
      : executarFerramenta(nome, entradaDaFerramenta, ctx),
  });
  if (r.interrompido) return;
  if (r.ferramentas.some(nome => !FERRAMENTAS_PUBLICAS.has(nome)) || r.resposta.includes("[ACESSO_APP]")) return responder(respostaDoApp());
  if (r.passouParaHumano || r.recusado || !r.resposta) return responder("Vou pedir para a equipe te ajudar por aqui.", ENCAMINHAMENTO);
  if (respostaModeloExigeEquipe(r.resposta)) {
    return responder("Vou pedir para a equipe te ajudar por aqui.", ENCAMINHAMENTO);
  }
  return responder(textoSeguroDoDirect(r.resposta.slice(0, 4_000)));
}
