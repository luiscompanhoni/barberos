import { SEGMENTOS, type Segmento } from "./regras";

const MODELOS: Record<Segmento, { nome: string; objetivo: string; texto: string }> = {
  quente: { nome: "Manter o corte em dia", objetivo: "Facilitar a próxima visita de quem veio nos últimos 30 dias.", texto: "Quer já deixar o próximo corte na agenda? Você pode conferir os horários aqui" },
  morno: { nome: "Volta à rotina na Black", objetivo: "Retomar o contato com quem veio de 31 a 90 dias atrás.", texto: "Se estiver pensando em voltar a cortar com a gente, dá pra conferir a agenda por aqui. Se preferir ajuda pra escolher, é só responder" },
  frio: { nome: "Convite para voltar à Black", objetivo: "Reabrir a conversa com quem veio de 91 a 365 dias atrás.", texto: "Faz um tempo desde a tua última visita registrada. Se quiser voltar, estamos por aqui. Veja a agenda ou responda se quiser uma mão pra marcar" },
  muitoFrio: { nome: "Reencontro com a Black", objetivo: "Apresentar o agendamento a quem está há mais de um ano sem visita registrada.", texto: "Se fizer sentido voltar à Black, você pode conhecer nosso jeito de agendar pelo celular. Se tiver dúvida, pode responder por aqui" },
  ate30: { nome: "Próximo horário", objetivo: "Oferecer o agendamento direto aos clientes recentes.", texto: "Obrigado pela visita! Quando quiser marcar de novo, escolhe o serviço e confere os horários por aqui" },
  d31a60: { nome: "Hora de acertar o corte", objetivo: "Convidar quem está entre 31 e 60 dias desde a última visita.", texto: "Se já estiver na hora de acertar o corte ou a barba, dá uma olhada nos horários pelo app" },
  d61a90: { nome: "Escolha seu barbeiro", objetivo: "Ajudar quem está entre 61 e 90 dias a escolher um profissional e um horário.", texto: "Quer cortar com a gente de novo? Na agenda você consegue escolher o profissional e ver os horários dele" },
  d91a180: { nome: "Ajuda para voltar", objetivo: "Facilitar o retorno de quem está entre 91 e 180 dias sem vir.", texto: "Se quiser voltar a cuidar do corte ou da barba, posso ajudar a achar um horário. Você também pode consultar a agenda aqui" },
  mais180: { nome: "Agenda da Black no celular", objetivo: "Reapresentar o agendamento para quem tem mais de 180 dias sem visita registrada.", texto: "Que tal conhecer a agenda da Black no celular? Se quiser voltar, você escolhe o serviço e vê os horários por aqui" },
  d181a365: { nome: "Seu próximo atendimento na Black", objetivo: "Convidar quem veio há mais de seis meses e até um ano.", texto: "Se estiver pensando em mudar o visual ou retomar teu corte de sempre, vem conversar com a gente. Se já quiser marcar, a agenda está aqui" },
  mais365: { nome: "Um novo horário na Black", objetivo: "Oferecer um caminho simples de retorno após mais de um ano sem visita registrada.", texto: "Quer voltar a conhecer o atendimento da Black? A gente pode tirar tuas dúvidas por aqui. Se preferir, consulte a agenda" },
  assinante: { nome: "Como acessar seu plano", objetivo: "Ajudar quem tem plano ativo ou atrasado a usar o app e encontrar a agenda.", texto: "Já conhece o app da Black? Por lá você encontra a área de planos e a agenda. Se precisar de ajuda com o acesso ou com teu plano, pode responder" },
  exAssinante: { nome: "Conheça os planos da Black", objetivo: "Abrir uma conversa opcional sobre os planos atuais com ex-assinantes.", texto: "Se estiver pensando em voltar a fazer parte dos planos da Black, a equipe pode te explicar as opções de hoje. Se preferir só marcar um atendimento, a agenda está aqui" },
  perdido: { nome: "Convite de reativação", objetivo: "Reabrir contato com quem tem mais de 90 dias sem visita registrada.", texto: "Quer uma ajuda pra voltar a marcar na Black? Se quiser, responde com o melhor período pra você, ou consulta a agenda quando puder" },
  novo: { nome: "Bem-vindo à Black", objetivo: "Dar boas-vindas a quem tem a primeira visita registrada nos últimos 30 dias.", texto: "Valeu pela visita! Se tiver algum comentário sobre o atendimento, a gente quer ouvir. Quando quiser marcar a próxima, confira a agenda" },
  nunca: { nome: "Primeiro atendimento na Black", objetivo: "Orientar cadastros sem visita concluída no histórico conhecido.", texto: "Se quiser conhecer a Black, dá pra ver os serviços e escolher um horário pelo celular. Se estiver em dúvida sobre o que marcar, pode responder" },
};

export const idModeloSegmento = (segmento: Segmento) => `campanha-segmento-${segmento}`;
export const MODELOS_SEGMENTOS = SEGMENTOS.map(({ chave, rotulo }) => {
  const { nome, objetivo, texto } = MODELOS[chave];
  return {
    id: idModeloSegmento(chave), chave, rotulo, objetivo, nome,
    mensagem: `Oi, {nome}! Aqui é da {barbearia}. ${texto}: {link}`,
    limiteDiario: 10, taxaRespostaBps: 2000,
  };
});
