export const VERSAO_CULTURA_BLACK = "1.0";

export const OBJETIVO_CULTURA = {
  titulo: "Crescer com respeito, padrão e oportunidade.",
  texto:
    "Queremos construir uma das maiores e mais respeitadas barbearias da região. Para chegar lá, precisamos ser referência para quem trabalha aqui e para cada cliente que entra pela porta. Nosso crescimento deve criar oportunidades para a empresa e para os profissionais.",
  compromisso:
    "O padrão começa na liderança e vale para todos, inclusive para o dono. A Black se compromete a explicar os padrões, oferecer condições adequadas, cumprir os acordos, ouvir dificuldades e tratar as pessoas com respeito.",
} as const;

export const MANDAMENTOS = [
  {
    numero: "01",
    titulo: "Esteja pronto para atender.",
    resumo: "Chegue preparado para receber o cliente com atenção.",
    pratica: ["Mantenha a apresentação pessoal adequada e a estação organizada.", "Confira os materiais de que precisa e avise se algo estiver faltando."],
    limite: "A preparação acontece dentro do período previsto e dos acordos aplicáveis ao seu vínculo.",
  },
  {
    numero: "02",
    titulo: "Prepare sua estação para o próximo cliente.",
    resumo: "Cada pessoa deve encontrar um espaço limpo e organizado.",
    pratica: ["Retire cabelos e resíduos da cadeira e da bancada.", "Guarde os materiais e deixe o espaço pronto para o próximo atendimento."],
    limite: "Se faltar material ou condição para fazer a limpeza, avise a liderança e não esconda o problema.",
  },
  {
    numero: "03",
    titulo: "Não troque segurança por pressa.",
    resumo: "Siga o procedimento de higiene aprovado para cada instrumento.",
    pratica: ["Use os materiais conforme o procedimento técnico vigente.", "Se houver dúvida sobre a segurança de um item, retire-o de uso e procure o responsável."],
    limite: "Agenda cheia não é motivo para pular etapas. Não improvise produto, diluição ou tempo de contato.",
  },
  {
    numero: "04",
    titulo: "Respeite todas as pessoas.",
    resumo: "Educação e respeito valem com clientes, colegas e prestadores.",
    pratica: ["Converse sem humilhar, discriminar, gritar ou constranger.", "Respeite os limites da outra pessoa, mesmo quando existe intimidade."],
    limite: "Se uma situação ultrapassar esses limites, procure a liderança com discrição e segurança.",
  },
  {
    numero: "05",
    titulo: "Dê atenção de verdade ao cliente.",
    resumo: "Escute, confirme o pedido e mantenha o foco no atendimento.",
    pratica: ["Confirme o serviço antes de começar.", "Explique o preço antes de oferecer ou realizar um adicional.", "Evite abandonar o cliente para usar o celular ou conversar."],
    limite: "Se não entendeu o pedido, pergunte antes de seguir.",
  },
  {
    numero: "06",
    titulo: "Cumpra os compromissos e avise os imprevistos.",
    resumo: "Respeite os horários e sinalize cedo quando algo mudar.",
    pratica: ["Acompanhe os horários agendados e suas responsabilidades.", "Ao perceber atraso, ausência ou dificuldade, comunique a equipe imediatamente."],
    limite: "Não deixe o cliente ou a equipe descobrir o imprevisto sozinho.",
  },
  {
    numero: "07",
    titulo: "Registre e fale a verdade.",
    resumo: "Serviços, produtos, pagamentos e tarefas precisam refletir o que aconteceu.",
    pratica: ["Registre corretamente cada atendimento e produto.", "Marque uma tarefa como feita somente depois de executá-la.", "Comunique erros para que possam ser corrigidos."],
    limite: "Não invente informações para esconder um erro; peça ajuda para corrigir o registro.",
  },
  {
    numero: "08",
    titulo: "Proteja a confiança e represente a Black com responsabilidade.",
    resumo: "Cuide das informações e da confiança de clientes e equipe.",
    pratica: ["Não exponha dados, conversas privadas ou informações internas.", "Fale oficialmente pela empresa apenas quando estiver autorizado."],
    limite: "Este cuidado não controla sua vida particular nem impede reclamações legítimas.",
  },
  {
    numero: "09",
    titulo: "Cuide do que é seu e preserve o que é de todos.",
    resumo: "Use, guarde e cuide dos recursos com responsabilidade.",
    pratica: ["Guarde o que utilizou e cumpra as responsabilidades da sua função.", "Ao encontrar um problema, resolva dentro da sua atribuição ou avise quem pode ajudar."],
    limite: "Não ignore o problema e não improvise uma tarefa insegura.",
  },
  {
    numero: "10",
    titulo: "Evolua e contribua com a equipe.",
    resumo: "Aprenda, aplique e compartilhe conhecimento.",
    pratica: ["Participe dos treinamentos acordados e aplique as orientações.", "Compartilhe o que aprendeu e reconheça o trabalho dos colegas."],
    limite: "Crescimento considera resultado, qualidade e responsabilidade, não apenas vendas.",
  },
] as const;

export const ROTINAS = [
  {
    id: "preparacao",
    titulo: "Preparação",
    quando: "Antes dos atendimentos",
    passos: ["Organize sua estação e confira os materiais necessários.", "Revise sua agenda e sinalize faltas ou impedimentos.", "Siga os procedimentos aprovados de higiene e segurança."],
    tarefa: "Organizar e limpar a bancada ao chegar",
  },
  {
    id: "entre-clientes",
    titulo: "Entre clientes",
    quando: "A cada atendimento",
    passos: ["Retire cabelos e resíduos da cadeira e da estação.", "Cuide dos instrumentos conforme o procedimento sanitário aprovado.", "Confira o registro do serviço e dos itens utilizados."],
    tarefa: "Varrer o cabelo e limpar a cadeira após cada cliente",
  },
  {
    id: "encerramento",
    titulo: "Encerramento",
    quando: "Ao terminar o expediente",
    passos: ["Deixe a bancada limpa e guarde seus materiais.", "Registre faltas ou avarias e encaminhe as pendências.", "Conclua as tarefas de fechamento atribuídas à sua função."],
    tarefa: "Deixar a bancada limpa e as máquinas carregando ao sair",
  },
] as const;
