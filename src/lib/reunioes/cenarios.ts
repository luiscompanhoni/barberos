import type { Cenario, ProjecaoServico } from "./tipos";

/** Monta uma combinacao viavel sem ocupar duas vezes a mesma janela. Nao reserva horarios. */
export function combinarCenarios(servicos: ProjecaoServico[], pedidos: Record<string, number>, granularidadeMin: number, intervaloMin: number) {
  const passo = Math.max(1, granularidadeMin) * 60000, folga = Math.max(0, intervaloMin) * 60000;
  const alocados: { servicoId: string; inicio: number; fim: number }[] = [];
  const quantidades: Record<string, number> = {};
  const total: Cenario = { quantidade: 0, receitaCentavos: 0, comissaoCentavos: 0, margemCentavos: 0, minutos: 0 };
  const alternativas = [...servicos].sort((a, b) => b.duracaoMin - a.duracaoMin || a.servicoId.localeCompare(b.servicoId));
  let solicitados = 0;
  for (const s of alternativas) {
    const pedida = Number.isFinite(pedidos[s.servicoId]) ? Math.max(0, Math.floor(pedidos[s.servicoId])) : 0;
    const limite = Math.min(pedida, s.quantidadeMaxima, 1440);
    solicitados += pedida;
    for (let n = 0; n < limite; n++) {
      let inicio: number | null = null;
      for (const j of s.janelas ?? []) {
        let candidato = Math.ceil(Date.parse(j.inicio) / passo) * passo;
        const fimJanela = Date.parse(j.fim), duracao = s.duracaoMin * 60000;
        while (candidato + duracao <= fimJanela) {
          const conflito = alocados.find((a) => candidato < a.fim + folga && candidato + duracao + folga > a.inicio);
          if (!conflito) { inicio = candidato; break; }
          candidato = Math.ceil((conflito.fim + folga) / passo) * passo;
        }
        if (inicio !== null) break;
      }
      if (inicio === null) break;
      alocados.push({ servicoId: s.servicoId, inicio, fim: inicio + s.duracaoMin * 60000 });
      quantidades[s.servicoId] = (quantidades[s.servicoId] ?? 0) + 1;
      total.quantidade++; total.receitaCentavos += s.precoCentavos; total.minutos += s.duracaoMin;
      total.comissaoCentavos = total.comissaoCentavos === null || s.comissaoCentavos === null ? null : total.comissaoCentavos + s.comissaoCentavos;
      total.margemCentavos = total.margemCentavos === null || s.comissaoCentavos === null || s.custoCentavos === null ? null : total.margemCentavos + s.precoCentavos - s.comissaoCentavos - s.custoCentavos;
    }
  }
  return { total, quantidades, solicitados, naoAlocados: Math.max(0, solicitados - total.quantidade),
    horarios: alocados.map((a) => ({ ...a, inicio: new Date(a.inicio).toISOString(), fim: new Date(a.fim).toISOString() })) };
}
