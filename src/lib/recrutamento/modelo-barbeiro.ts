import type { z } from "zod";
import type { zFormulario } from "./formularios-regras";
export const barbeiro: z.infer<typeof zFormulario> = {
  "titulo": "Banco de talentos — Barbeiro",
  "funcao": "BARBEIRO",
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
        "secao": "Técnica",
        "texto": "Qual é sua experiência com corte com máquina?",
        "instrucao": "Informe o que você já realizou. A execução poderá ser conferida em entrevista ou prática.",
        "tipo": "UNICA",
        "obrigatoria": true,
        "opcoes": [
          "Ainda não realizei",
          "Pratiquei em curso ou treinamento",
          "Realizo com ajuda",
          "Realizo sozinho na rotina"
        ],
        "condicao": null
      },
      {
        "id": "p5_1",
        "secao": "Técnica",
        "texto": "Qual é sua experiência com corte com tesoura?",
        "instrucao": "Informe o que você já realizou. A execução poderá ser conferida em entrevista ou prática.",
        "tipo": "UNICA",
        "obrigatoria": true,
        "opcoes": [
          "Ainda não realizei",
          "Pratiquei em curso ou treinamento",
          "Realizo com ajuda",
          "Realizo sozinho na rotina"
        ],
        "condicao": null
      },
      {
        "id": "p5_2",
        "secao": "Técnica",
        "texto": "Qual é sua experiência com degradê?",
        "instrucao": "Informe o que você já realizou. A execução poderá ser conferida em entrevista ou prática.",
        "tipo": "UNICA",
        "obrigatoria": true,
        "opcoes": [
          "Ainda não realizei",
          "Pratiquei em curso ou treinamento",
          "Realizo com ajuda",
          "Realizo sozinho na rotina"
        ],
        "condicao": null
      },
      {
        "id": "p5_3",
        "secao": "Técnica",
        "texto": "Qual é sua experiência com barba?",
        "instrucao": "Informe o que você já realizou. A execução poderá ser conferida em entrevista ou prática.",
        "tipo": "UNICA",
        "obrigatoria": true,
        "opcoes": [
          "Ainda não realizei",
          "Pratiquei em curso ou treinamento",
          "Realizo com ajuda",
          "Realizo sozinho na rotina"
        ],
        "condicao": null
      },
      {
        "id": "p5_4",
        "secao": "Técnica",
        "texto": "Qual é sua experiência com acabamento?",
        "instrucao": "Informe o que você já realizou. A execução poderá ser conferida em entrevista ou prática.",
        "tipo": "UNICA",
        "obrigatoria": true,
        "opcoes": [
          "Ainda não realizei",
          "Pratiquei em curso ou treinamento",
          "Realizo com ajuda",
          "Realizo sozinho na rotina"
        ],
        "condicao": null
      },
      {
        "id": "p6",
        "secao": "Consulta",
        "texto": "Que perguntas você faz antes de começar um corte para entender o resultado esperado?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p7",
        "secao": "Execução",
        "texto": "Descreva as etapas de um degradê que você costuma executar. Como confere o resultado?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p8",
        "secao": "Adaptação",
        "texto": "O cliente mostra uma referência que não funciona bem para o cabelo dele. Como conduz a conversa?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p9",
        "secao": "Correção",
        "texto": "O cliente diz que o resultado ficou diferente do pedido. O que você faz primeiro e como encaminha?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p10",
        "secao": "Higiene",
        "texto": "Como prepara os materiais antes do atendimento e o que faz com eles ao terminar?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p11",
        "secao": "Limites técnicos",
        "texto": "Você recebe um pedido de serviço que ainda não domina. Como procede?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p12",
        "secao": "Agenda",
        "texto": "Seu atendimento vai atrasar. Quem você avisa e quais informações repassa?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p13",
        "secao": "Registro",
        "texto": "Como confirma e registra os serviços que foram realizados?",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": true,
        "opcoes": [],
        "condicao": null
      },
      {
        "id": "p14",
        "secao": "Evidência",
        "texto": "Se tiver, compartilhe trabalhos de sua autoria e explique o que realizou. Portfólio é opcional.",
        "instrucao": "Não inclua dados pessoais de clientes ou colegas.",
        "tipo": "LONGO",
        "obrigatoria": false,
        "opcoes": [],
        "condicao": null
      }
    ],
    "criterios": [
      {
        "id": "c1",
        "nome": "Execução técnica",
        "peso": 35,
        "perguntas": [
          "p5",
          "p7",
          "p8",
          "p11",
          "p5_1",
          "p5_2",
          "p5_3",
          "p5_4"
        ],
        "critico": false,
        "rubrica": [
          "Não explica uma sequência de execução nem os limites dos serviços que conhece.",
          "Descreve etapas parciais e precisa de orientação para sequência, transições ou acabamento.",
          "Explica preparação, sequência e conferência dos serviços que declara executar com autonomia.",
          "Além da sequência, identifica variações do cabelo, correções possíveis e quando precisa de apoio."
        ]
      },
      {
        "id": "c2",
        "nome": "Higiene e procedimentos",
        "peso": 25,
        "perguntas": [
          "p10",
          "p11"
        ],
        "critico": true,
        "rubrica": [
          "Não identifica preparação e tratamento dos materiais entre atendimentos.",
          "Reconhece parte da rotina, mas precisa de orientação para completar as etapas.",
          "Explica preparação, tratamento dos materiais e organização entre atendimentos conforme a rotina.",
          "Além da rotina, identifica material inadequado, limitações e encaminhamento de intercorrências."
        ]
      },
      {
        "id": "c3",
        "nome": "Atendimento",
        "peso": 20,
        "perguntas": [
          "p6",
          "p8",
          "p9"
        ],
        "critico": false,
        "rubrica": [
          "Não esclarece o pedido do cliente nem encaminha uma divergência no resultado.",
          "Confirma parte do pedido, mas precisa de apoio para explicar limites ou tratar reclamações.",
          "Confirma expectativa, explica possibilidades e conduz uma divergência com encaminhamento adequado.",
          "Adapta a comunicação, confirma entendimento e previne novas divergências sem prometer resultado inviável."
        ]
      },
      {
        "id": "c4",
        "nome": "Organização e equipe",
        "peso": 20,
        "perguntas": [
          "p4",
          "p12",
          "p13"
        ],
        "critico": false,
        "rubrica": [
          "Não informa como acompanha agenda ou comunica pendências à equipe.",
          "Reconhece a necessidade de comunicar, mas deixa informações essenciais pendentes.",
          "Acompanha agenda, comunica atrasos, registra o serviço e esclarece orientações conflitantes.",
          "Prioriza demandas, antecipa impacto de atrasos e organiza passagem de pendências com clareza."
        ]
      }
    ]
  }
};
