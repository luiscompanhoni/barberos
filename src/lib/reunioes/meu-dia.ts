import { configuracao, limitesDoDia } from "@/lib/agenda/carregar";
import { encaixesDoDia } from "@/lib/agenda/encaixes";
import { dataLocal } from "@/lib/agenda/tempo";
import { permissoesDoUsuario } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { oportunidadesDoDia } from "@/lib/recompras/servico";
import { adicionaisDoCalculo } from "@/lib/rh/adicionais";
import { regrasExtras } from "@/lib/rh/pote";
import { adicionalNoDia, calcularComissao, escolherRegra } from "@/lib/rh/regras";
import { meuDiaSchema } from "./schemas";
import { acoesDoBarbeiro } from "./acoes";
import type { ProjecaoServico } from "./tipos";

export async function carregarMeuDia(s: Sessao, entrada: unknown) {
  const q = meuDiaSchema.parse(entrada);
  const [cfg, permissoes] = await Promise.all([configuracao(), permissoesDoUsuario(s)]);
  const gestao = ["DONO", "GERENTE", "LIDER"].includes(s.papel) && permissoes.reunioes;
  const profissionais = await db.barbeiro.findMany({ where: { ativo: true, ...(gestao ? {} : { id: s.barbeiroId ?? "sem-vinculo" }) }, select: { id: true, nome: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }] });
  const id = q.barbeiroId ?? s.barbeiroId ?? profissionais[0]?.id;
  if (!id || (!gestao && id !== s.barbeiroId)) throw new ErroNegocio("Seu acesso permite somente o próprio resumo. Vincule um barbeiro ao cadastro.", 403);
  const barbeiro = profissionais.find((b) => b.id === id);
  if (!barbeiro) throw naoEncontrado("Barbeiro ativo");
  const data = q.data ?? dataLocal(Date.now(), cfg.fuso), dia = limitesDoDia(data, cfg.fuso);
  const [ags, regras, extras, adicionais, encaixes, custos, acoes, recompras] = await Promise.all([
    db.agendamento.findMany({ where: { barbeiroId: id, inicio: { gte: new Date(dia.inicio), lt: new Date(dia.fim) }, status: { notIn: ["CANCELADO", "FALTOU"] } }, orderBy: { inicio: "asc" },
      select: { id: true, clienteId: true, inicio: true, fim: true, status: true, assinaturaId: true, precoCentavos: true, servicoId: true, cliente: { select: { nome: true } }, servico: { select: { nome: true, precoCentavos: true } } } }),
    db.comissaoServico.findMany(), regrasExtras(), adicionaisDoCalculo(), encaixesDoDia({ data, barbeiroId: id }, s),
    db.servico.findMany({ select: { id: true, custoCentavos: true } }),
    id === s.barbeiroId || (permissoes.lucro && permissoes.comissoes_equipe) ? acoesDoBarbeiro(id, data) : Promise.resolve([]), oportunidadesDoDia(id, data),
  ]);
  const adicional = adicionalNoDia(adicionais, id, "AVULSO", data);
  const podeVerComissao = id === s.barbeiroId || permissoes.comissoes_equipe;
  let semRegra = 0, planoPendente = false;
  const atendimentos = ags.map((a) => {
    const regra = escolherRegra(regras, a.servicoId, id);
    if (!regra && !(a.assinaturaId && extras.assinaturas.ativo)) semRegra++;
    const pote = !!a.assinaturaId && extras.assinaturas.ativo;
    if (pote) planoPendente = true;
    const com = !regra || pote ? null : calcularComissao(regra, { modalidade: a.assinaturaId ? "PLANO" : "AVULSO", preco: a.precoCentavos, precoTabela: a.servico.precoCentavos }, a.assinaturaId ? adicionalNoDia(adicionais, id, "ASSINATURA", data) : adicional).comissao;
    return { id: a.id, inicio: a.inicio.toISOString(), fim: a.fim.toISOString(), status: a.status, cliente: a.cliente.nome, servico: a.servico.nome,
      assinante: !!a.assinaturaId, receitaCentavos: a.assinaturaId ? 0 : a.precoCentavos, comissaoCentavos: podeVerComissao ? com : null };
  });
  const servicos: ProjecaoServico[] = (encaixes.profissionais.find((p) => p.barbeiroId === id)?.servicos ?? []).map((sv) => {
    const regra = escolherRegra(regras, sv.servicoId, id);
    return { servicoId: sv.servicoId, nome: sv.nome, precoCentavos: sv.precoCentavos, duracaoMin: sv.duracaoMin,
      custoCentavos: permissoes.lucro ? custos.find((c) => c.id === sv.servicoId)?.custoCentavos ?? null : null,
      comissaoCentavos: podeVerComissao && regra ? calcularComissao(regra, { modalidade: "AVULSO", preco: sv.precoCentavos, precoTabela: sv.precoCentavos }, adicional).comissao : null,
      quantidadeMaxima: sv.quantidade, janelas: sv.janelas.map((j) => ({ inicio: j.inicio, fim: j.fim })) };
  });
  const avulsos = atendimentos.filter((a) => !a.assinante), assinantes = atendimentos.filter((a) => a.assinante);
  const clientes = new Set(ags.map((a) => a.clienteId)), clientesPlanos = new Set(ags.filter((a) => a.assinaturaId).map((a) => a.clienteId));
  const somarComissao = (lista: typeof atendimentos) => podeVerComissao && lista.every((a) => a.comissaoCentavos !== null) ? lista.reduce((s, a) => s + (a.comissaoCentavos ?? 0), 0) : null;
  return { data, fuso: cfg.fuso, barbeiro, profissionais, podeVerComissao, atendimentos, servicos, acoes,
    agendaHref: `${gestao ? "/recepcao" : "/minha-agenda"}?${new URLSearchParams({ data, barbeiroId: id, encaixes: "1" })}`,
    granularidadeMin: cfg.granularidadeMin, intervaloMin: cfg.intervaloEntreClientes,
    resumo: { clientes: clientes.size, servicos: atendimentos.length, assinantes: clientesPlanos.size, avulsos: clientes.size - clientesPlanos.size,
      receitaPrevistaCentavos: avulsos.reduce((t, a) => t + a.receitaCentavos, 0), comissaoAvulsaCentavos: somarComissao(avulsos),
      comissaoPlanoCentavos: planoPendente ? null : somarComissao(assinantes), planoPendente, semRegra },
    prioridades: [
      `${atendimentos.filter((a) => a.status === "MARCADO").length} serviço(s) aguardam confirmação; conferir necessidades dos ${clientes.size} cliente(s) do dia.`,
      recompras.length ? `${recompras.length} oportunidade(s) de recompra: ${[...new Set(recompras.map((r) => r.servicoNome))].join(", ")}. ${recompras.filter((r) => r.podeEncaixar).length} com tempo disponível após a visita.` : "Nenhuma recompra elegível com as regras atuais; conferir preferências dos clientes.",
      servicos.length ? `${servicos.length} alternativa(s) de serviço cabem em janelas livres. Escolher as ofertas e registrar as vendas; não somar espaços compartilhados.` : "Sem encaixes disponíveis para os serviços atuais. Preservar a pontualidade da agenda.",
    ],
  };
}
export type MeuDiaResposta = Awaited<ReturnType<typeof carregarMeuDia>>;
