import { dataLocal, parseData } from "@/lib/agenda/tempo";

export const METAS_CRESCIMENTO_2026 = Object.freeze({
  dataLimite: "2026-12-31", assinantesAdimplentes: 400, receitaDezembroCentavos: 7_000_000,
  margemLiquidaPontosBase: 3_500, lucroDezembroCentavos: 2_450_000, custosDezembroCentavos: 4_550_000,
} as const);

export type ContratoMeta = {
  id: string; clienteId: string; planoId: string; valorMensalLiquidoCentavos: number;
  inicio: string; fimExclusivo: string | null; situacao: "ADIMPLENTE" | "ATRASADO";
};
export type CancelamentoMeta = { contratoId: string; fimExclusivo: string };
export type CapacidadeMeta = {
  verificada: boolean; duracaoVisitaMinutos: number | null; minutosOfertaveisDezembro: number | null;
  minutosOutrasVendasDezembro: number | null; visitasPlanejadasPorAssinante: 2 | 3 | 4 | null;
};
export type CenarioCapacidadeMeta = {
  visitasPorAssinante: 2 | 3 | 4; assinantesConsiderados: number; minutosNecessarios: number | null;
  horasNecessarias: number | null; minutosUtilizaveis: number | null; viavel: boolean | null;
};
export type EntradaMetasCrescimento = {
  referencia: string | Date; fuso?: string;
  realizado: {
    inicio: string; fimExclusivo: string; receitaAssinaturasLiquidaCentavos: number;
    receitaOutrasVendasLiquidaCentavos: number; descontosEstornosJaDeduzidosCentavos: number;
    custosTotaisCentavos: number | null; custosCompletos: boolean;
  };
  assinantesAdimplentes: number; assinantesAtrasados: number;
  contratos: ContratoMeta[]; contratosCompletos: boolean; cancelamentos: CancelamentoMeta[];
  dezembro: {
    outrasVendasLiquidasCentavos: number | null; custosBaseCentavos: number | null; custosCompletos: boolean;
  };
  aquisicao: {
    contribuicaoVerificada: boolean; receitaLiquidaPorNovoDezembroCentavos: number | null;
    custosVariaveisPorNovoCentavos: number | null; custoIndicacaoTotalPorNovoCentavos: number;
    creditoIndicacaoJaDeduzidoReceitaPorNovoCentavos: number;
  };
  capacidade: CapacidadeMeta;
};
export type ResultadoMetasCrescimento = {
  metas: typeof METAS_CRESCIMENTO_2026; referenciaCivil: string; bloqueios: string[];
  receitaRealizadaLiquidaCentavos: number; lucroRealizadoCentavos: number | null;
  margemLiquidaRealizadaPontosBase: number | null;
  mrrNominalReferenciaCentavos: number; mrrAdimplenteReferenciaCentavos: number;
  assinantesAdimplentesProjetados: number; novosAdimplentesNecessarios: number;
  receitaContratosDezembroCentavos: number; receitaNovosDezembroCentavos: number | null;
  outrasVendasNecessariasDezembroCentavos: number | null; bridgeOutrasVendasCentavos: number | null;
  receitaDezembroCenarioCentavos: number | null; lucroDezembroCenarioCentavos: number | null;
  margemLiquidaDezembroPontosBase: number | null;
  contribuicaoPorNovoCentavos: number | null; cenariosCapacidade: CenarioCapacidadeMeta[];
  cacMaximoCandidatoCentavos: number | null; tetoOrcamentoCandidatoCentavos: number | null;
  orcamentoAprovado: false;
};

function inteiro(valor: number, nome: string): number {
  if (!Number.isSafeInteger(valor) || valor < 0) throw new RangeError(`${nome}: inteiro não negativo seguro obrigatório.`);
  return valor;
}
function seguro(valor: bigint): number {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero)) throw new RangeError("Resultado excede a precisão de centavos/contagens.");
  return numero;
}
function soma(...valores: number[]): number {
  return seguro(valores.reduce((total, valor) => total + BigInt(valor), BigInt(0)));
}
function proporcao(valor: number, multiplicador: number, divisor: number, arredondarAcima = false): number {
  if (divisor <= 0) throw new RangeError("Divisor deve ser positivo.");
  const numerador = BigInt(valor) * BigInt(multiplicador);
  const denominador = BigInt(divisor);
  return seguro((numerador + (arredondarAcima ? denominador - BigInt(1) : BigInt(0))) / denominador);
}
function validarData(data: string): string {
  const { ano } = parseData(data);
  if (ano < 1900 || ano > 9999) throw new RangeError("Data fora do intervalo operacional.");
  return data;
}
function diaCivil(data: string): number {
  const { ano, mes, dia } = parseData(validarData(data));
  return Date.UTC(ano, mes - 1, dia) / 86_400_000;
}
function validarContrato(contrato: ContratoMeta): void {
  if (!contrato.id.trim() || !contrato.clienteId.trim() || !contrato.planoId.trim()) throw new RangeError("Contrato, cliente e plano precisam de identificador.");
  inteiro(contrato.valorMensalLiquidoCentavos, "Valor do contrato");
  validarData(contrato.inicio);
  if (contrato.fimExclusivo !== null && validarData(contrato.fimExclusivo) <= contrato.inicio) {
    throw new RangeError("Fim do contrato deve ser posterior ao início.");
  }
  if (!["ADIMPLENTE", "ATRASADO"].includes(contrato.situacao)) throw new RangeError("Situação contratual inválida.");
}

/** Projeção por competência civil em dezembro (31 dias), nunca cobrança ou liquidação. */
export function projetarReceitaContratoDezembro(contrato: ContratoMeta): number {
  validarContrato(contrato);
  if (contrato.situacao !== "ADIMPLENTE") return 0;
  const inicio = contrato.inicio > "2026-12-01" ? contrato.inicio : "2026-12-01";
  const fim = contrato.fimExclusivo && contrato.fimExclusivo < "2027-01-01" ? contrato.fimExclusivo : "2027-01-01";
  const dias = Math.max(0, diaCivil(fim) - diaCivil(inicio));
  return proporcao(contrato.valorMensalLiquidoCentavos, dias, 31);
}

/** Horas reais ofertáveis já excluem pausas/bloqueios; reserva adicional de 15%. */
export function cenariosCapacidade(capacidade: CapacidadeMeta, assinantes = 400): CenarioCapacidadeMeta[] {
  inteiro(assinantes, "Assinantes da capacidade");
  const { duracaoVisitaMinutos: duracao, minutosOfertaveisDezembro: minutos, minutosOutrasVendasDezembro: outros } = capacidade;
  for (const valor of [duracao, minutos, outros]) if (valor !== null) inteiro(valor, "Minutos de capacidade");
  if (duracao === 0) throw new RangeError("Duração deve ser positiva.");
  if (capacidade.visitasPlanejadasPorAssinante !== null && ![2, 3, 4].includes(capacidade.visitasPlanejadasPorAssinante)) {
    throw new RangeError("Escolha um cenário de 2, 3 ou 4 visitas.");
  }
  const utilizaveis = capacidade.verificada && minutos !== null ? proporcao(minutos, 85, 100) : null;
  return ([2, 3, 4] as const).map((visitas) => {
    const necessario = duracao === null || outros === null ? null : soma(proporcao(duracao, proporcao(assinantes, visitas, 1), 1), outros);
    return { visitasPorAssinante: visitas, assinantesConsiderados: assinantes, minutosNecessarios: necessario, horasNecessarias: necessario === null ? null : necessario / 60,
      minutosUtilizaveis: utilizaveis, viavel: utilizaveis === null || necessario === null ? null : necessario <= utilizaveis };
  });
}

/** Calculador sem I/O. Valores projetados são cenários, nunca receita reconhecida ou aprovação de gasto. */
export function calcularMetasCrescimento(entrada: EntradaMetasCrescimento): ResultadoMetasCrescimento {
  const fuso = entrada.fuso ?? "America/Sao_Paulo";
  dataLocal(0, fuso); // Valida o fuso também quando a referência já é uma data civil.
  if (entrada.referencia instanceof Date && !Number.isFinite(+entrada.referencia)) throw new RangeError("Referência inválida.");
  const referenciaCivil = validarData(typeof entrada.referencia === "string" ? entrada.referencia : dataLocal(entrada.referencia, fuso));
  const bloqueios: string[] = [];
  const { realizado, dezembro, aquisicao, capacidade } = entrada;
  if (validarData(realizado.fimExclusivo) <= validarData(realizado.inicio)) throw new RangeError("Período realizado vazio/invertido.");
  if (realizado.fimExclusivo > referenciaCivil) bloqueios.push("REALIZADO_CONTEM_DIAS_NAO_ENCERRADOS");
  inteiro(entrada.assinantesAdimplentes, "Adimplentes"); inteiro(entrada.assinantesAtrasados, "Atrasados");
  const monetarios = [realizado.receitaAssinaturasLiquidaCentavos, realizado.receitaOutrasVendasLiquidaCentavos,
    realizado.descontosEstornosJaDeduzidosCentavos, realizado.custosTotaisCentavos, dezembro.outrasVendasLiquidasCentavos,
    dezembro.custosBaseCentavos, aquisicao.receitaLiquidaPorNovoDezembroCentavos, aquisicao.custosVariaveisPorNovoCentavos,
    aquisicao.custoIndicacaoTotalPorNovoCentavos, aquisicao.creditoIndicacaoJaDeduzidoReceitaPorNovoCentavos];
  for (const valor of monetarios) if (valor !== null) inteiro(valor, "Centavos");
  if (aquisicao.creditoIndicacaoJaDeduzidoReceitaPorNovoCentavos > aquisicao.custoIndicacaoTotalPorNovoCentavos) {
    throw new RangeError("Crédito já deduzido excede o custo total de indicação.");
  }
  const ids = new Set<string>();
  for (const contrato of entrada.contratos) {
    validarContrato(contrato);
    if (ids.has(contrato.id)) throw new RangeError("Contrato duplicado.");
    ids.add(contrato.id);
  }
  const cancelamentos = new Map<string, string>();
  for (const cancelamento of entrada.cancelamentos) {
    if (!ids.has(cancelamento.contratoId) || cancelamentos.has(cancelamento.contratoId)) throw new RangeError("Cancelamento sem contrato ou duplicado.");
    cancelamentos.set(cancelamento.contratoId, validarData(cancelamento.fimExclusivo));
  }
  const contratos = entrada.contratos.map((contrato) => {
    const fim = cancelamentos.get(contrato.id);
    const ajustado = fim && (!contrato.fimExclusivo || fim < contrato.fimExclusivo) ? { ...contrato, fimExclusivo: fim } : contrato;
    validarContrato(ajustado);
    return ajustado;
  });
  const porCliente = new Map<string, ContratoMeta[]>();
  for (const contrato of contratos) porCliente.set(contrato.clienteId, [...(porCliente.get(contrato.clienteId) ?? []), contrato]);
  for (const lista of porCliente.values()) {
    lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
    if (lista.some((contrato, indice) => indice > 0 && (!lista[indice - 1].fimExclusivo || lista[indice - 1].fimExclusivo! > contrato.inicio))) {
      bloqueios.push("CONTRATOS_SOBREPOSTOS_POR_CLIENTE");
      break;
    }
  }
  const ativoEm = (contrato: ContratoMeta, data: string) => contrato.inicio <= data && (!contrato.fimExclusivo || contrato.fimExclusivo > data);
  const atuais = contratos.filter((contrato) => ativoEm(contrato, referenciaCivil));
  const atuaisAdimplentes = atuais.filter((contrato) => contrato.situacao === "ADIMPLENTE");
  const quantidadeClientes = (lista: ContratoMeta[]) => new Set(lista.map((contrato) => contrato.clienteId)).size;
  if (!entrada.contratosCompletos) bloqueios.push("CONTRATOS_INCOMPLETOS");
  if (quantidadeClientes(atuaisAdimplentes) !== entrada.assinantesAdimplentes || quantidadeClientes(atuais) - quantidadeClientes(atuaisAdimplentes) !== entrada.assinantesAtrasados) {
    bloqueios.push("CONTAGENS_DIVERGEM_DOS_CONTRATOS");
  }
  if (referenciaCivil > METAS_CRESCIMENTO_2026.dataLimite) bloqueios.push("PRAZO_ENCERRADO");
  const receitaRealizada = soma(realizado.receitaAssinaturasLiquidaCentavos, realizado.receitaOutrasVendasLiquidaCentavos);
  const lucroRealizado = realizado.custosCompletos && realizado.custosTotaisCentavos !== null ? receitaRealizada - realizado.custosTotaisCentavos : null;
  const margemRealizada = lucroRealizado === null || receitaRealizada === 0 ? null : proporcao(lucroRealizado, 10_000, receitaRealizada);
  if (lucroRealizado === null) bloqueios.push("CUSTOS_REALIZADOS_INCOMPLETOS");
  if (receitaRealizada === 0) bloqueios.push("RECEITA_REALIZADA_ZERO");
  const adimplentesFinais = contratos.filter((contrato) => contrato.situacao === "ADIMPLENTE" && ativoEm(contrato, "2026-12-31"));
  const adimplentesProjetados = quantidadeClientes(adimplentesFinais);
  const novos = Math.max(0, 400 - adimplentesProjetados);
  const receitaContratos = soma(...contratos.map(projetarReceitaContratoDezembro));
  const receitaNova = aquisicao.receitaLiquidaPorNovoDezembroCentavos;
  const variaveis = aquisicao.custosVariaveisPorNovoCentavos;
  const custoIndicacaoAdicional = aquisicao.custoIndicacaoTotalPorNovoCentavos - aquisicao.creditoIndicacaoJaDeduzidoReceitaPorNovoCentavos;
  const contribuicao = receitaNova === null || variaveis === null ? null : receitaNova - soma(variaveis, custoIndicacaoAdicional);
  const receitaNovos = novos === 0 ? 0 : receitaNova === null ? null : proporcao(receitaNova, novos, 1);
  const outrasNecessarias = receitaNovos === null ? null : Math.max(0, 7_000_000 - soma(receitaContratos, receitaNovos));
  const bridge = outrasNecessarias === null || dezembro.outrasVendasLiquidasCentavos === null ? null : Math.max(0, outrasNecessarias - dezembro.outrasVendasLiquidasCentavos);
  const receitaCenario = receitaNovos === null || dezembro.outrasVendasLiquidasCentavos === null ? null : soma(receitaContratos, receitaNovos, dezembro.outrasVendasLiquidasCentavos);
  const custosNovos = novos === 0 ? 0 : variaveis === null ? null : proporcao(soma(variaveis, custoIndicacaoAdicional), novos, 1);
  const custosCenario = !dezembro.custosCompletos || dezembro.custosBaseCentavos === null || custosNovos === null ? null : soma(dezembro.custosBaseCentavos, custosNovos);
  const lucroCenario = custosCenario === null || receitaCenario === null ? null : receitaCenario - custosCenario;
  const margemCenario = lucroCenario === null || !receitaCenario ? null : proporcao(lucroCenario, 10_000, receitaCenario);
  const cenarios = cenariosCapacidade(capacidade, Math.max(400, adimplentesProjetados));
  const escolhido = cenarios.find((cenario) => cenario.visitasPorAssinante === capacidade.visitasPlanejadasPorAssinante);
  if (!escolhido || escolhido.viavel === null) bloqueios.push("CAPACIDADE_NAO_VERIFICADA");
  else if (!escolhido.viavel) bloqueios.push("CAPACIDADE_INSUFICIENTE");
  if (!dezembro.custosCompletos || dezembro.custosBaseCentavos === null) bloqueios.push("CUSTOS_DEZEMBRO_INCOMPLETOS");
  if (bridge === null) bloqueios.push("RECEITA_DEZEMBRO_INCOMPLETA");
  else if (bridge > 0) bloqueios.push("OUTRAS_VENDAS_AINDA_NECESSARIAS");
  if (novos > 0 && (!aquisicao.contribuicaoVerificada || contribuicao === null || contribuicao <= 0)) bloqueios.push("CONTRIBUICAO_AQUISICAO_NAO_VERIFICADA_OU_INSUFICIENTE");
  const limiteCustos = receitaCenario === null ? null : Math.min(4_550_000, proporcao(receitaCenario, 65, 100));
  if (custosCenario !== null && limiteCustos !== null && custosCenario > limiteCustos) bloqueios.push("CUSTOS_EXCEDEM_META");
  const limiteUnitario = contribuicao === null || receitaNova === null ? null : Math.max(0, contribuicao - proporcao(receitaNova, 35, 100, true));
  if (novos > 0 && limiteUnitario === 0) bloqueios.push("SEM_FOLGA_PARA_CAC");
  const teto = bloqueios.length || custosCenario === null || limiteCustos === null ? null : novos === 0 ? 0 :
    limiteUnitario === null ? null : Math.min(proporcao(limiteUnitario, novos, 1), Math.max(0, limiteCustos - custosCenario));
  return {
    metas: METAS_CRESCIMENTO_2026, referenciaCivil, bloqueios,
    receitaRealizadaLiquidaCentavos: receitaRealizada, lucroRealizadoCentavos: lucroRealizado, margemLiquidaRealizadaPontosBase: margemRealizada,
    mrrNominalReferenciaCentavos: soma(...atuais.map((contrato) => contrato.valorMensalLiquidoCentavos)),
    mrrAdimplenteReferenciaCentavos: soma(...atuaisAdimplentes.map((contrato) => contrato.valorMensalLiquidoCentavos)),
    assinantesAdimplentesProjetados: adimplentesProjetados, novosAdimplentesNecessarios: novos,
    receitaContratosDezembroCentavos: receitaContratos, receitaNovosDezembroCentavos: receitaNovos,
    outrasVendasNecessariasDezembroCentavos: outrasNecessarias, bridgeOutrasVendasCentavos: bridge,
    receitaDezembroCenarioCentavos: receitaCenario, lucroDezembroCenarioCentavos: lucroCenario, margemLiquidaDezembroPontosBase: margemCenario,
    contribuicaoPorNovoCentavos: contribuicao, cenariosCapacidade: cenarios,
    cacMaximoCandidatoCentavos: teto === null || novos === 0 ? teto : Math.floor(teto / novos),
    tetoOrcamentoCandidatoCentavos: teto, orcamentoAprovado: false,
  };
}
