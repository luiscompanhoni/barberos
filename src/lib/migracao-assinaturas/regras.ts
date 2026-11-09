import { dataLocal } from "@/lib/agenda/tempo";
import { ErroNegocio } from "@/lib/erros";
import { ESTADOS_MIGRACAO, type ConferenciaMigracao, type EstadoMigracao } from "./schemas";

export const META_MIGRACAO = "2026-11-20";
const PROGRESSO = ESTADOS_MIGRACAO.slice(0, 7);
const EXCECOES: EstadoMigracao[] = ["AJUDA", "ADIADO", "NAO_CONTATAR"];
export const ehOrigemLegada = (id: string | null) => !!id && /^(?:cashbarber:|celsub_)/.test(id);

type Contexto = {
  de: string; para: EstadoMigracao; statusAssinatura: string; gatewayAtual: string | null;
  destinoGatewayId: string | null; proximoVencimento: string | null;
  adiadoAte: string | null; hoje: string; contatoImpedido: boolean;
  conferencia: ConferenciaMigracao;
};

/** Uma declaração gerencial registra a conferência; não cria prova de API nem altera a cobrança. */
export function validarTransicaoMigracao(p: Contexto) {
  if (!(ESTADOS_MIGRACAO as readonly string[]).includes(p.de)) throw new ErroNegocio("Estado desconhecido: encaminhe à revisão.");
  if (p.de === "CONCLUIDO") throw new ErroNegocio("Uma migração concluída não pode ser reaberta por este fluxo.", 409, "migracao_concluida");
  if (p.para === "ADIADO" && (!p.adiadoAte || p.adiadoAte <= p.hoje)) throw new ErroNegocio("Informe uma data futura para o acompanhamento.");
  if (p.para !== "ADIADO" && p.adiadoAte) throw new ErroNegocio("O adiamento pertence somente ao estado Adiado.");
  if (EXCECOES.includes(p.para)) return;
  if (p.statusAssinatura === "CANCELADA") throw new ErroNegocio("Contrato cancelado é histórico: não pode ser reativado pela migração.");
  if (p.contatoImpedido && ["PRONTO", "CONVIDADO", "INICIOU"].includes(p.para)) throw new ErroNegocio("O contato está impedido ou com atendimento humano. Encaminhe à ajuda.");
  const de = PROGRESSO.indexOf(p.de as EstadoMigracao), para = PROGRESSO.indexOf(p.para);
  if (para < 0 || (de >= 0 && para < de) || (de >= 0 && para > de + 1)) throw new ErroNegocio("Avance uma etapa de cada vez, preservando a conferência anterior.");
  // Saídas de exceções retornam à conferência, sem saltar diretamente para concluído.
  if (EXCECOES.includes(p.de as EstadoMigracao) && p.para !== "A_CONFERIR") throw new ErroNegocio("Retome pela etapa A conferir.");
  if (para >= 1 && (!p.conferencia.contratoConciliado || !p.conferencia.rotaVerificada || !p.proximoVencimento)) throw new ErroNegocio("Confira contrato, ciclo, vencimento e rota segura antes do convite.");
  if (para >= 4 && (!p.destinoGatewayId || !p.conferencia.vinculoNovoConfirmado || !p.conferencia.consentimentoConfirmado)) throw new ErroNegocio("Faltam vínculo novo e consentimento conferidos.");
  if (para >= 5 && !p.conferencia.legadoInterrompido) throw new ErroNegocio("A interrupção da próxima recorrência antiga ainda não foi conferida.");
  if (para === 6 && (!p.conferencia.proximaCobrancaUnica || p.gatewayAtual !== p.destinoGatewayId)) throw new ErroNegocio("Confira uma única próxima cobrança e o vínculo efetivo da assinatura ao destino.");
}

type Cadencia = {
  agora: Date; estado: EstadoMigracao; aceitaMensagens: boolean; humano: boolean; excluido: boolean;
  recusaAutomaticas: boolean; contatosMigracao: Date[]; ultimoContatoGlobalEm: Date | null;
};

/** Somente planejamento: quem chamar deve fornecer o histórico global comprovado. Não despacha mensagens. */
export function proximoPassoMigracao(p: Cadencia) {
  const nenhum = (motivo: string) => ({ acao: "NENHUMA" as const, motivo });
  if (!p.aceitaMensagens || p.recusaAutomaticas || p.excluido || p.humano || ["CONCLUIDO", "NAO_CONTATAR", "ADIADO", "AJUDA"].includes(p.estado)) return nenhum("Contato suspenso ou processo encerrado.");
  if (!Number.isFinite(+p.agora) || p.contatosMigracao.some(d => !Number.isFinite(+d) || +d > +p.agora) || (p.ultimoContatoGlobalEm && (!Number.isFinite(+p.ultimoContatoGlobalEm) || +p.ultimoContatoGlobalEm > +p.agora))) return nenhum("Histórico de contato inconsistente.");
  const hoje = dataLocal(+p.agora, "America/Sao_Paulo");
  if (hoje > META_MIGRACAO) return { acao: "REVISAO_HUMANA" as const, motivo: "Meta vencida: conferir exceção individual." };
  if (p.contatosMigracao.length >= 4) return nenhum("Limite de quatro contatos atingido.");
  const contatos = [...p.contatosMigracao].sort((a, b) => +a - +b);
  const ultimo = Math.max(contatos.at(-1)?.getTime() ?? 0, p.ultimoContatoGlobalEm?.getTime() ?? 0);
  const dia = 86_400_000;
  if (ultimo && +p.agora - ultimo < 2 * dia) return nenhum("Aguarde pelo menos 48 horas entre contatos.");
  if (!contatos.length) return p.estado === "PRONTO" ? { acao: "CONVITE" as const, motivo: "D0, sujeito à conferência do canal e permissão." } : nenhum("A rota ainda não está pronta para convite.");
  const dias = (+p.agora - +contatos[0]) / dia;
  if (contatos.length === 1 && dias >= 2) return { acao: "LEMBRETE" as const, motivo: "D+2, ajudar no passo pendente." };
  if (contatos.length === 2 && dias >= 5) return { acao: "OFERECER_AJUDA" as const, motivo: "D+5, oferecer equipe ou ligação humana." };
  if (contatos.length === 3 && hoje === "2026-11-19") return { acao: "VESPERA" as const, motivo: "Meta real de 20/11, sem cancelamento coletivo." };
  return nenhum("Aguardando o próximo ponto da cadência; não comprimir os contatos.");
}
