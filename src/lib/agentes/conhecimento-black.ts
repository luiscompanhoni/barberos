/** Base aprovada na conversa em 02/11/2026. Atualizações exigem revisão humana.
 * Não inclui candidatos, métricas sintéticas ou permissões de execução externa. */
export const CONHECIMENTO_BLACK = {
  "id": "recrutamento-black-v1",
  "versao": 1,
  "estado": "APROVADO_PELO_USUARIO",
  "aprovacao": {
    "data": "2026-11-02",
    "origem": "Conversa: aprovação do modelo v4 — perfeito, vamos dar andamento"
  },
  "escopo": "Operação da Black Barber. Comercialização do BarberOS fica para outra fase.",
  "campanha": {
    "objetivo": "Banco contínuo de talentos; não garante vaga, entrevista ou contratação imediata.",
    "funcoes": [
      "Barbeiro",
      "Recepção",
      "Auxiliar"
    ],
    "enderecoDeclarado": "Rua 15 de Abril, 50, Centro, Rio do Sul, SC",
    "alcanceDesejadoKm": 20,
    "alcanceConfigurado": false,
    "tom": "Neutro, profissional e receptivo",
    "diferenciaisDeclarados": [
      "Estrutura completa",
      "Equipe auxiliar",
      "Alto fluxo de clientes"
    ],
    "comparativoMaiorEstruturaComprovado": false,
    "remuneracao": {
      "funcao": "Barbeiro",
      "referenciaReais": 3500,
      "negociavel": true,
      "garantido": false,
      "periodicidade": "PENDENTE",
      "usarEmAnuncio": false
    }
  },
  "avaliacao": {
    "notasVisiveisAoCandidato": false,
    "fontesSeparadas": [
      "Declaração no formulário",
      "Observação na entrevista",
      "Demonstração prática"
    ],
    "decisao": "Humana; sem rejeição ou contratação automática.",
    "dadosAntigos": "Preservar; sem aplicar novos critérios retroativamente.",
    "pesos": "Editáveis, somando 100%, vinculados à versão aprovada de cada formulário."
  },
  "entrevistas": {
    "modalidade": "Presencial",
    "dia": "Segunda-feira",
    "inicio": "14:00",
    "fim": "16:00",
    "duracaoMaximaMin": 45,
    "fuso": "America/Sao_Paulo",
    "janelasPropostas": [
      "14:00–14:45",
      "14:45–15:30"
    ],
    "agendaIntegrada": false
  },
  "limites": [
    "Não publicar, enviar mensagens, ativar anúncios ou gerar gastos.",
    "Não usar métricas fictícias como resultados reais.",
    "Não analisar candidatos por aparência, seguidores ou atributos sensíveis.",
    "Não incluir dados pessoais de candidatos nesta base compartilhada.",
    "Revalidar condições comerciais e disponibilidade com o dono antes de cada uso externo."
  ],
  "aprendizados": [],
  "melhoria": "Novas observações exigem evidências, fonte e revisão humana antes de nova versão. Não há retreinamento automático do modelo."
} as const;
