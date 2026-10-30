/**
 * Matriz de permissoes por acao (regras puras, testadas em tests/permissoes.test.ts).
 *
 * O dono pode tudo, sempre. Para gerente, recepcao e barbeiro cada acao sensivel tem um padrao e o dono liga ou
 * desliga na tela de Configuracoes. O que nao esta aqui e fixo por papel (lib/auth/sessao.ts: GESTAO, BALCAO).
 */
import type { Papel } from "@prisma/client";

export type PapelConfiguravel = "GERENTE" | "LIDER" | "RECEPCAO" | "BARBEIRO";

export const PERMISSOES = [
  {
    chave: "estorno", rotulo: "Aprovar e fazer estornos",
    detalhe: "Aprovar ou recusar pedidos de estorno, estornar direto e desfazer pagamento já recebido. Sem isso, a pessoa só pede o estorno.",
    papeis: ["GERENTE", "RECEPCAO"], padrao: [],
  },
  {
    chave: "desconto", rotulo: "Dar desconto na comanda",
    detalhe: "Lançar ou mudar o desconto de uma comanda aberta.",
    papeis: ["GERENTE", "LIDER", "RECEPCAO", "BARBEIRO"], padrao: ["GERENTE", "RECEPCAO"],
  },
  {
    chave: "saldo", rotulo: "Usar o saldo do cliente",
    detalhe: "Usar cashback, indicação e créditos do cliente como desconto na comanda.",
    papeis: ["GERENTE", "LIDER", "RECEPCAO", "BARBEIRO"], padrao: ["GERENTE", "LIDER", "RECEPCAO", "BARBEIRO"],
  },
  {
    chave: "assinatura", rotulo: "Cancelar assinaturas",
    detalhe: "Cancelar o plano de um cliente e mudar as ofertas de retenção.",
    papeis: ["GERENTE", "RECEPCAO"], padrao: [],
  },
  {
    chave: "caixa", rotulo: "Mexer no caixa",
    detalhe: "Abrir e fechar o caixa, sangria e suprimento.",
    papeis: ["GERENTE", "RECEPCAO"], padrao: ["GERENTE", "RECEPCAO"],
  },
  {
    chave: "comissao", rotulo: "Alterar comissões",
    detalhe: "Regras de comissão, Receita de Assinaturas e comissão diferenciada.",
    papeis: ["GERENTE", "RECEPCAO"], padrao: [],
  },
  {
    chave: "folha", rotulo: "Folha e salários",
    detalhe: "Ver salários e comissões a pagar, lançar vales e bônus, fechar e pagar a folha.",
    papeis: ["GERENTE", "RECEPCAO"], padrao: [],
  },
  {
    chave: "excluir", rotulo: "Excluir e desfazer lançamentos",
    detalhe: "Cancelar comanda já fechada, excluir conta a pagar e estornar despesa paga.",
    papeis: ["GERENTE", "RECEPCAO"], padrao: [],
  },
  {
    chave: "resultado", rotulo: "Ver faturamento e resultado",
    detalhe: "Resumo do mês do financeiro, indicadores, horários de pico e resultado dos jogos.",
    papeis: ["GERENTE", "RECEPCAO"], padrao: ["GERENTE"],
  },
  {
    // Separado de "resultado": a equipe so ve despesas e lucro quando o dono liberar.
    chave: "lucro", rotulo: "Ver despesas e lucro",
    detalhe: "Resumo do mês e Resultado (Celcash e Stone) no financeiro, e o resultado no painel: despesas, taxas, retiradas e lucro.",
    papeis: ["GERENTE", "LIDER", "RECEPCAO"], padrao: [],
  },
  {
    chave: "reunioes", rotulo: "Acessar reuniões",
    detalhe: "Reuniões diárias e semanais, apresentações e planos de ação da equipe.",
    papeis: ["GERENTE", "LIDER"], padrao: ["GERENTE", "LIDER"],
  },
  {
    chave: "comissoes_equipe", rotulo: "Ver comissões da equipe",
    detalhe: "Comissões e projeções individuais nas reuniões, sem acesso à folha inteira.",
    papeis: ["GERENTE", "LIDER"], padrao: [],
  },
  {
    chave: "avaliar_equipe", rotulo: "Avaliar desempenho da equipe",
    detalhe: "Registrar avaliações da liderança e acompanhar presença e qualidade.",
    papeis: ["GERENTE", "LIDER"], padrao: ["GERENTE", "LIDER"],
  },
  {
    chave: "duracao", rotulo: "Ajustar duração dos atendimentos",
    detalhe: "Alterar a duração de uma reserva, respeitando o mínimo do serviço e a agenda permitida.",
    papeis: ["GERENTE", "LIDER", "RECEPCAO", "BARBEIRO"], padrao: ["GERENTE", "LIDER", "RECEPCAO", "BARBEIRO"],
  },
  {
    chave: "bloquear_agenda", rotulo: "Bloquear e reabrir horários",
    detalhe: "Barbeiros podem bloquear somente a própria agenda; liderança e recepção, as agendas sob sua gestão.",
    papeis: ["GERENTE", "LIDER", "RECEPCAO", "BARBEIRO"], padrao: ["GERENTE", "LIDER", "BARBEIRO"],
  },
] as const satisfies readonly { chave: string; rotulo: string; detalhe: string; papeis: readonly PapelConfiguravel[]; padrao: readonly PapelConfiguravel[] }[];

export type Permissao = (typeof PERMISSOES)[number]["chave"];
export type Permissoes = Record<Permissao, boolean>;
export type LinhaPermissao = { papel: Papel; permissao: string; permitido: boolean };

export const CHAVES = PERMISSOES.map((p) => p.chave) as Permissao[];
export const PAPEIS_CONFIGURAVEIS: PapelConfiguravel[] = ["GERENTE", "LIDER", "RECEPCAO", "BARBEIRO"];

const def = (p: Permissao) => PERMISSOES.find((x) => x.chave === p)!;

/** O dono pode marcar essa acao para esse papel? (ex.: barbeiro so desconto e saldo) */
export function configuravel(papel: Papel, p: Permissao) {
  return (def(p).papeis as readonly Papel[]).includes(papel);
}

/** O que cada papel pode: dono tudo, cliente nada; os outros pelo padrao, trocado pelo que o dono salvou. */
export function permissoesDoPapel(papel: Papel, linhas: LinhaPermissao[]): Permissoes {
  return Object.fromEntries(CHAVES.map((k) => {
    if (papel === "DONO") return [k, true];
    if (!configuravel(papel, k)) return [k, false];
    const salvo = linhas.find((l) => l.papel === papel && l.permissao === k);
    return [k, salvo ? salvo.permitido : (def(k).padrao as readonly Papel[]).includes(papel)];
  })) as Permissoes;
}

/** Linhas a gravar: so o que difere do padrao (voltar ao padrao apaga a linha). */
export function linhasParaSalvar(matriz: Partial<Record<PapelConfiguravel, Partial<Permissoes>>>) {
  const gravar: LinhaPermissao[] = [];
  const apagar: { papel: PapelConfiguravel; permissao: Permissao }[] = [];
  for (const papel of PAPEIS_CONFIGURAVEIS) {
    for (const k of CHAVES) {
      const v = matriz[papel]?.[k];
      if (v === undefined || !configuravel(papel, k)) continue;
      if (v === (def(k).padrao as readonly Papel[]).includes(papel)) apagar.push({ papel, permissao: k });
      else gravar.push({ papel, permissao: k, permitido: v });
    }
  }
  return { gravar, apagar };
}

export const rotuloPermissao = (p: Permissao) => def(p).rotulo;

/** Exceções individuais só valem para ações configuráveis da função atual. */
export function aplicarPermissoesIndividuais(papel: Papel, base: Permissoes, linhas: { permissao: string; permitido: boolean }[]): Permissoes {
  const resultado = { ...base };
  if (papel === "DONO" || papel === "CLIENTE") return resultado;
  for (const k of CHAVES) {
    if (!configuravel(papel, k)) continue;
    const linha = linhas.find((l) => l.permissao === k);
    if (linha) resultado[k] = linha.permitido;
  }
  return resultado;
}
