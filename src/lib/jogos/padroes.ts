/**
 * Jogos que todo BarberOS tem (criados desligados na primeira vez; o dono liga e ajusta no painel).
 * As chances de cada jogo somam 100% (10000).
 */
import type { Raridade, TipoJogo, TipoPremio } from "@prisma/client";

type PremioPadrao = { rotulo: string; tipo: TipoPremio; valorCentavos?: number; percentual?: number; chanceBps: number; raridade: Raridade; cor: string; icone: string; custoCentavos?: number };
type JogoPadrao = {
  id: string; tipo: TipoJogo; nome: string; descricao: string; ordem: number; premiosPorJogada: number; raridade: Raridade;
  jogadasPorAtendimento?: number; valorMinimoAtendimentoCentavos?: number; jogadasPorIndicacao?: number;
  jogadasAniversario?: number; jogadasRenovacaoPlano?: number; premios: PremioPadrao[];
};

const OURO = "#C9A24A";
const GRAFITE = "#2A2A2E";
const PRETO = "#141416";
const BRONZE = "#8A6A3B";
const CHAMPANHE = "#E6D3A3";

export const JOGOS_PADRAO: JogoPadrao[] = [
  {
    id: "caixa-black", tipo: "CAIXA", nome: "Caixa Black", descricao: "Créditos, brindes e descontos para o seu próximo corte.", ordem: 1, premiosPorJogada: 1, raridade: "RARO",
    jogadasPorAtendimento: 1,
    premios: [
      { rotulo: "R$ 5", tipo: "CREDITO", valorCentavos: 500, chanceBps: 4000, raridade: "COMUM", cor: GRAFITE, icone: "dinheiro" },
      { rotulo: "R$ 10", tipo: "CREDITO", valorCentavos: 1000, chanceBps: 2000, raridade: "RARO", cor: BRONZE, icone: "dinheiro" },
      { rotulo: "Bebida grátis", tipo: "BRINDE", chanceBps: 2500, raridade: "COMUM", cor: PRETO, icone: "bebida", custoCentavos: 400 },
      { rotulo: "10% off", tipo: "DESCONTO", percentual: 10, chanceBps: 1500, raridade: "RARO", cor: OURO, icone: "desconto" },
    ],
  },
  {
    id: "caixa-gold", tipo: "CAIXA", nome: "Caixa Gold", descricao: "Prêmios maiores, para atendimentos a partir de R$ 80 e indicações.", ordem: 2, premiosPorJogada: 2, raridade: "EPICO",
    jogadasPorAtendimento: 1, valorMinimoAtendimentoCentavos: 8000, jogadasPorIndicacao: 1,
    premios: [
      { rotulo: "R$ 10", tipo: "CREDITO", valorCentavos: 1000, chanceBps: 3000, raridade: "COMUM", cor: GRAFITE, icone: "dinheiro" },
      { rotulo: "R$ 15", tipo: "CREDITO", valorCentavos: 1500, chanceBps: 2000, raridade: "RARO", cor: BRONZE, icone: "dinheiro" },
      { rotulo: "Pomada", tipo: "BRINDE", chanceBps: 1500, raridade: "EPICO", cor: OURO, icone: "pomada", custoCentavos: 1500 },
      { rotulo: "15% off", tipo: "DESCONTO", percentual: 15, chanceBps: 2000, raridade: "RARO", cor: CHAMPANHE, icone: "desconto" },
      { rotulo: "Bebida grátis", tipo: "BRINDE", chanceBps: 1500, raridade: "COMUM", cor: PRETO, icone: "bebida", custoCentavos: 400 },
    ],
  },
  {
    id: "caixa-legend", tipo: "CAIXA", nome: "Caixa Legend", descricao: "A mais rara: no seu aniversário e a cada renovação do plano.", ordem: 3, premiosPorJogada: 3, raridade: "LENDARIO",
    jogadasAniversario: 1, jogadasRenovacaoPlano: 1,
    premios: [
      { rotulo: "R$ 15", tipo: "CREDITO", valorCentavos: 1500, chanceBps: 2500, raridade: "RARO", cor: GRAFITE, icone: "dinheiro" },
      { rotulo: "R$ 25", tipo: "CREDITO", valorCentavos: 2500, chanceBps: 1500, raridade: "EPICO", cor: BRONZE, icone: "dinheiro" },
      { rotulo: "Pomada", tipo: "BRINDE", chanceBps: 2000, raridade: "EPICO", cor: OURO, icone: "pomada", custoCentavos: 1500 },
      { rotulo: "20% off", tipo: "DESCONTO", percentual: 20, chanceBps: 2500, raridade: "RARO", cor: CHAMPANHE, icone: "desconto" },
      { rotulo: "Bebida grátis", tipo: "BRINDE", chanceBps: 1500, raridade: "COMUM", cor: PRETO, icone: "bebida", custoCentavos: 400 },
    ],
  },
  {
    id: "raspadinha", tipo: "RASPADINHA", nome: "Raspadinha Black", descricao: "Raspe e combine 3 iguais.", ordem: 4, premiosPorJogada: 1, raridade: "COMUM",
    jogadasPorAtendimento: 1, jogadasPorIndicacao: 1,
    premios: [
      { rotulo: "R$ 5", tipo: "CREDITO", valorCentavos: 500, chanceBps: 1500, raridade: "COMUM", cor: GRAFITE, icone: "dinheiro" },
      { rotulo: "R$ 10", tipo: "CREDITO", valorCentavos: 1000, chanceBps: 800, raridade: "RARO", cor: BRONZE, icone: "dinheiro" },
      { rotulo: "Bebida grátis", tipo: "BRINDE", chanceBps: 1000, raridade: "COMUM", cor: PRETO, icone: "bebida", custoCentavos: 400 },
      { rotulo: "10% off", tipo: "DESCONTO", percentual: 10, chanceBps: 700, raridade: "RARO", cor: OURO, icone: "desconto" },
      { rotulo: "Não foi dessa vez", tipo: "NADA", chanceBps: 6000, raridade: "COMUM", cor: PRETO, icone: "nada" },
    ],
  },
];

/** Roleta nova (instalacao sem a roleta antiga): fatias na paleta da marca. */
export const ROLETA_PADRAO: JogoPadrao = {
  id: "roleta", tipo: "ROLETA", nome: "Roleta Black", descricao: "Gire e ganhe prêmios na Black.", ordem: 0, premiosPorJogada: 1, raridade: "COMUM",
  jogadasPorAtendimento: 1,
  premios: [
    { rotulo: "R$ 5", tipo: "CREDITO", valorCentavos: 500, chanceBps: 1600, raridade: "COMUM", cor: GRAFITE, icone: "dinheiro" },
    { rotulo: "R$ 2", tipo: "CREDITO", valorCentavos: 200, chanceBps: 2000, raridade: "COMUM", cor: OURO, icone: "dinheiro" },
    { rotulo: "Tente de novo", tipo: "NADA", chanceBps: 1600, raridade: "COMUM", cor: PRETO, icone: "nada" },
    { rotulo: "R$ 10", tipo: "CREDITO", valorCentavos: 1000, chanceBps: 800, raridade: "RARO", cor: BRONZE, icone: "dinheiro" },
    { rotulo: "Bebida grátis", tipo: "BRINDE", chanceBps: 650, raridade: "RARO", cor: CHAMPANHE, icone: "bebida", custoCentavos: 400 },
    { rotulo: "R$ 15", tipo: "CREDITO", valorCentavos: 1500, chanceBps: 400, raridade: "EPICO", cor: GRAFITE, icone: "dinheiro" },
    { rotulo: "Corte grátis", tipo: "BRINDE", chanceBps: 80, raridade: "LENDARIO", cor: OURO, icone: "tesoura" },
    { rotulo: "R$ 3", tipo: "CREDITO", valorCentavos: 300, chanceBps: 1600, raridade: "COMUM", cor: PRETO, icone: "dinheiro" },
    { rotulo: "Tente de novo", tipo: "NADA", chanceBps: 1110, raridade: "COMUM", cor: BRONZE, icone: "nada" },
    { rotulo: "R$ 25", tipo: "CREDITO", valorCentavos: 2500, chanceBps: 160, raridade: "LENDARIO", cor: CHAMPANHE, icone: "dinheiro" },
  ],
};

export const TODOS_PADRAO = [ROLETA_PADRAO, ...JOGOS_PADRAO];
