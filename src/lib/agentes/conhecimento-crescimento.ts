import { METAS_CRESCIMENTO_2026 } from "@/lib/crescimento/metas";

/** Decisões de planejamento de Ygor. Não são métricas realizadas nem autorização de mídia. */
export const CONHECIMENTO_CRESCIMENTO_BLACK = {
  id: "crescimento-black-2026-11-08", dataDecisao: "2026-11-08", estado: "IMPLEMENTACAO_PREPARADA",
  metas: METAS_CRESCIMENTO_2026,
  evidencias: "Consultar os dados atuais e a página /crescimento. Meta de margem não comprova lucro. Assinatura nominal, adimplência, receita e caixa são diferentes.",
  migracao: { alvo: "2026-11-20", admiteExcecoes: true, quadro: "/migracao-assinaturas", calendario: "/calendario-conteudo", aplicativo: "PWA instalável pelo navegador; lojas não confirmadas", pagamentos: "Celcoin/Celcash legado; Pagar.me novas cobranças; Stone maquininhas" },
  indicacaoPlanejada: { indicadorCentavos: 2000, indicadoCentavos: 1000, validadeDias: 30, gatilho: "Primeiro pagamento confirmado de assinatura elegível", elegibilidade: "Primeira assinatura ou pelo menos 90 dias sem plano; uma concessão por indicado; migração não gera indicação", uso: "Crédito na Black, incluindo mensalidade futura quando habilitado e comprovado; sem saque", ativacao: "Não anunciar ativa sem consultar configuração e teto do lote. Benefícios antigos preservados." },
  piloto: { pessoas: 20, custoRealMaximoCentavos: 20000, grupos: "5 quentes, 5 mornos, 5 frios e 5 muito frios", condicao: "Brinde depende de custo, estoque e agenda verificados; promoção aleatória exige enquadramento conferido" },
  trafego: "Usar o agente trafego existente. Preparar público local, criativo, destino e orçamento pela projeção. Limite de mensagens não é verba de anúncios. Não ativar anúncios nem aumentar gasto sem versão e teto aprovados. Receita atribuída pela Meta não prova receita conciliada ou incremento causal.",
  capacidade: "Conferir agenda Cash Barber e BarberOS, duração e escala por profissional. Meta de 400 não muda planos ilimitados. Projetar 2/3/4 visitas com 15% de folga; capacidade agregada não garante encaixe por horário.",
  comunicacao: "Identificação Black, primeiro nome confirmado e benefício real. Não usar dívida falsa, prêmio impossível, cancelamento coletivo não configurado ou cashback sem ativação/validade confirmadas. Parar ao concluir, recusar ou assumir equipe; evitar campanhas simultâneas.",
} as const;
