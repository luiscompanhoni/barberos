import type { z } from "zod";
import type { zFormulario } from "./formularios-regras";
export const recepcao: z.infer<typeof zFormulario> = {
  "titulo": "Banco de talentos — Recepção",
  "funcao": "RECEPCAO",
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
        "secao": "Agenda",
        "texto": "Quais sistemas de agenda já utilizou e quais tarefas fazia neles? Se não utilizou, informe.",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p6",
        "secao": "Conferência",
        "texto": "Quais informações confirma antes de finalizar um agendamento?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p7",
        "secao": "Conflito",
        "texto": "Duas pessoas aparecem para o mesmo horário e profissional. O que você confere e como encaminha?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p8",
        "secao": "Comunicação",
        "texto": "Escreva uma mensagem curta para avisar um cliente de um atraso de 15 minutos e oferecer atendimento humano.",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p9",
        "secao": "Condições",
        "texto": "Um cliente pede um desconto que você não tem autorização para oferecer. Como responde?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p10",
        "secao": "Priorização",
        "texto": "Há um cliente chegando, uma ligação e uma mensagem pendente. Como organiza o atendimento?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p11",
        "secao": "Remarcação",
        "texto": "O cliente pede para trocar de horário. Quais passos você segue antes de confirmar?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p12",
        "secao": "Divergência",
        "texto": "O sistema mostra um valor diferente do informado ao cliente. Como verifica a situação?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p13",
        "secao": "Privacidade",
        "texto": "Alguém pede o telefone de outro cliente. Como atende esse pedido?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p14",
        "secao": "Passagem de turno",
        "texto": "Quais pendências você registra para quem assume a recepção depois de você?",
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
        "nome": "Agenda e conferência",
        "peso": 30,
        "perguntas": [
          "p5",
          "p6",
          "p7",
          "p11"
        ],
        "critico": false,
        "rubrica": [
          "Confirma horário sem conferir serviço, profissional ou disponibilidade.",
          "Consulta a agenda, mas precisa de apoio para concluir ou corrigir um conflito.",
          "Confere dados, disponibilidade e confirmação antes de agendar ou remarcar; encaminha conflitos.",
          "Além da rotina, identifica inconsistências e organiza alternativas sem confirmar um horário indisponível."
        ]
      },
      {
        "id": "c2",
        "nome": "Comunicação e atendimento",
        "peso": 30,
        "perguntas": [
          "p8",
          "p9",
          "p10"
        ],
        "critico": false,
        "rubrica": [
          "Não esclarece a demanda ou promete condições sem autorização.",
          "Recebe a demanda, mas precisa de apoio para mensagem clara e encaminhamento.",
          "Comunica atraso com clareza, confirma a necessidade e encaminha descontos sem inventar autorização.",
          "Adapta a comunicação e organiza demandas simultâneas mantendo o cliente informado sobre o próximo passo."
        ]
      },
      {
        "id": "c3",
        "nome": "Registros e privacidade",
        "peso": 25,
        "perguntas": [
          "p12",
          "p13"
        ],
        "critico": false,
        "rubrica": [
          "Não identifica divergência de registro ou compartilha dado de cliente sem verificação.",
          "Percebe divergências, mas precisa de orientação para conferir ou limitar o compartilhamento.",
          "Confere registros, verifica divergências com o responsável e preserva dados de clientes.",
          "Identifica origem provável da divergência, registra o encaminhamento e previne repetição sem expor dados."
        ]
      },
      {
        "id": "c4",
        "nome": "Organização e equipe",
        "peso": 15,
        "perguntas": [
          "p4",
          "p10",
          "p14"
        ],
        "critico": false,
        "rubrica": [
          "Não define ordem de atendimento nem registra pendências na passagem de turno.",
          "Organiza parte das tarefas com apoio, mas deixa pendências sem responsável.",
          "Prioriza atendimento e registra pendências com responsável e próximo passo para a equipe.",
          "Reavalia prioridades diante de interrupções e coordena o encaminhamento sem perder pendências."
        ]
      }
    ]
  }
};
