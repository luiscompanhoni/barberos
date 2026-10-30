import { db } from "@/lib/db";
import { pode } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/sessao";
import { adicionaisDoCalculo } from "@/lib/rh/adicionais";
import { adicionalNoDia, calcularComissao, escolherRegra } from "@/lib/rh/regras";
import { carregarDia, configuracao, limitesDoDia } from "./carregar";
import { ocupacaoCadeira } from "./cadeiras";
import { janelasParaEncaixe } from "./encaixes-regras";

/** Ofertas alternativas por serviço; não somar capacidades de serviços diferentes. */
export async function encaixesDoDia(p: { data: string; barbeiroId?: string; servicoId?: string }, ator: Sessao) {
  const cfg = await configuracao();
  const [barbeiros, regras, adicionais, verComissoes] = await Promise.all([
    db.barbeiro.findMany({ where: { ativo: true, ...(p.barbeiroId ? { id: p.barbeiroId } : {}) },
      include: { servicos: { where: { servico: { ativo: true }, ...(p.servicoId ? { servicoId: p.servicoId } : {}) }, include: { servico: true } } }, orderBy: { nome: "asc" } }),
    db.comissaoServico.findMany(), adicionaisDoCalculo(), pode(ator, "comissoes_equipe"),
  ]);
  const mapa = await carregarDia(p.data, barbeiros.map(b => b.id), { fuso: cfg.fuso });
  const profissionais = await Promise.all(barbeiros.map(async b => {
    const dia = mapa.get(b.id)!;
    const ocupados = await ocupacaoCadeira(b.cadeiraId, limitesDoDia(p.data, cfg.fuso));
    const servicos = b.servicos.map(bs => {
      const duracaoMin = bs.duracaoMin ?? bs.servico.duracaoMin;
      const precoCentavos = bs.precoCentavos ?? bs.servico.precoCentavos;
      const janelas = janelasParaEncaixe({ janelas: dia.janelas, bloqueios: dia.bloqueios,
        agendamentos: [...dia.agendamentos, ...ocupados.map(a => ({ inicio: +a.inicio, fim: +a.fim }))],
        duracaoMin, granularidadeMin: cfg.granularidadeMin, intervaloMin: cfg.intervaloEntreClientes, agora: Date.now() });
      const regra = escolherRegra(regras, bs.servicoId, b.id);
      const extra = adicionalNoDia(adicionais, b.id, "AVULSO", p.data);
      const comissaoCentavos = regra && (verComissoes || ator.barbeiroId === b.id)
        ? calcularComissao(regra, { modalidade: "AVULSO", preco: precoCentavos, precoTabela: precoCentavos }, extra).comissao : null;
      return { servicoId: bs.servicoId, nome: bs.servico.nome, duracaoMin, precoCentavos, comissaoCentavos,
        quantidade: janelas.reduce((t, j) => t + j.quantidade, 0),
        janelas: janelas.map(j => ({ inicio: new Date(j.inicio).toISOString(), fim: new Date(j.fim).toISOString(), quantidade: j.quantidade })) };
    }).filter(s => s.quantidade > 0);
    return { barbeiroId: b.id, nome: b.nome, servicos };
  }));
  return { fuso: cfg.fuso, profissionais };
}
