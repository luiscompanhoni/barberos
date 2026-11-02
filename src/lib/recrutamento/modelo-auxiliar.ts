import type { z } from "zod";
import type { zFormulario } from "./formularios-regras";
export const auxiliar: z.infer<typeof zFormulario> = {
  "titulo": "Banco de talentos — Auxiliar",
  "funcao": "AUXILIAR",
  "definicao": {
    "perguntas": [
      {
        "id": "p1",
        "secao": "Experiência",
        "texto": "Quais atividades desta função você já realizou? Conte onde ou em que contexto.",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p2",
        "secao": "Aprendizado",
        "texto": "Qual atividade você ainda precisa aprender ou praticar com apoio?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p3",
        "secao": "Situação real",
        "texto": "Conte uma situação em que precisou corrigir um erro no trabalho. O que fez?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p4",
        "secao": "Equipe",
        "texto": "Você recebe duas orientações que parecem conflitantes. Como esclarece o que fazer?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p5",
        "secao": "Experiência prática",
        "texto": "Quais atividades de organização, limpeza e reposição você já realizou? Em quais precisava de ajuda?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p6",
        "secao": "Preparação",
        "texto": "Como organiza um posto de trabalho antes de o profissional iniciar o atendimento?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p7",
        "secao": "Entre atendimentos",
        "texto": "O atendimento terminou e outro cliente está chegando. O que você verifica antes de liberar o posto?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p8",
        "secao": "Materiais",
        "texto": "Como identifica que um material está acabando e como informa a reposição?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p9",
        "secao": "Orientações",
        "texto": "Você não conhece o produto ou equipamento solicitado. O que faz antes de usar?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p10",
        "secao": "Priorização",
        "texto": "Dois profissionais pedem apoio ao mesmo tempo. Como combina a ordem das tarefas?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p11",
        "secao": "Intercorrência",
        "texto": "Você percebe um equipamento danificado. Como procede?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p12",
        "secao": "Atendimento",
        "texto": "Um cliente pede que você execute um serviço técnico fora da sua função. Como responde?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p13",
        "secao": "Segurança da rotina",
        "texto": "Durante a limpeza, uma área precisa ficar temporariamente sem circulação. Como organiza e comunica?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p14",
        "secao": "Conferência",
        "texto": "Ao terminar uma tarefa, como verifica se ficou pronta e comunica as pendências?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      }
    ],
    "criterios": [
      {
        "id": "c1",
        "nome": "Procedimentos e cuidado com materiais",
        "peso": 35,
        "perguntas": [
          "p5",
          "p7",
          "p9",
          "p11",
          "p13"
        ],
        "critico": true,
        "rubrica": [
          "Não identifica limites de uso de material ou equipamento desconhecido.",
          "Reconhece a necessidade de cuidado, mas precisa de orientação para preparar ou tratar materiais.",
          "Segue instruções, pede orientação antes de usar equipamento desconhecido e separa material inadequado.",
          "Além da rotina, identifica riscos, comunica intercorrências e encaminha o problema sem improvisar procedimento."
        ]
      },
      {
        "id": "c2",
        "nome": "Organização e reposição",
        "peso": 30,
        "perguntas": [
          "p6",
          "p8",
          "p14"
        ],
        "critico": false,
        "rubrica": [
          "Não define como preparar o posto ou identificar falta de materiais.",
          "Executa parte da organização, mas depende de apoio para conferir e repor.",
          "Prepara, organiza e confere o posto, identifica necessidade de reposição e comunica pendências.",
          "Antecipa falta de recursos e organiza prioridades para liberar o posto com conferência completa."
        ]
      },
      {
        "id": "c3",
        "nome": "Comunicação e apoio",
        "peso": 20,
        "perguntas": [
          "p4",
          "p10",
          "p12"
        ],
        "critico": false,
        "rubrica": [
          "Não esclarece pedidos ou assume serviço técnico fora da função.",
          "Entende parte do pedido, mas precisa de apoio para priorizar ou encaminhar.",
          "Confirma solicitações, combina prioridades e encaminha pedidos técnicos ao profissional responsável.",
          "Coordena pedidos simultâneos, comunica limites e acompanha o encaminhamento sem deixar a equipe sem retorno."
        ]
      },
      {
        "id": "c4",
        "nome": "Conferência e equipe",
        "peso": 15,
        "perguntas": [
          "p7",
          "p14"
        ],
        "critico": false,
        "rubrica": [
          "Não informa como verifica a tarefa ou comunica uma pendência.",
          "Confere parcialmente, mas precisa de orientação para identificar o que falta.",
          "Verifica a conclusão, comunica pendências e mantém a equipe informada sobre a liberação do posto.",
          "Identifica falhas de preparação, corrige o que está no seu escopo e comunica claramente o que exige apoio."
        ]
      }
    ]
  }
};
