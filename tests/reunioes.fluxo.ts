import assert from "node:assert/strict";
import { db } from "@/lib/db";
import type { Sessao } from "@/lib/auth/sessao";
import { dadosDoPeriodo } from "@/lib/reunioes/dados";
import { criarReuniao, editarReuniao, lerReuniao } from "@/lib/reunioes/servico";
import { carregarMeuDia } from "@/lib/reunioes/meu-dia";
import { acoesDoBarbeiro } from "@/lib/reunioes/acoes";
import { instanteLocal } from "@/lib/agenda/tempo";

let verificacoes = 0;
function ok(condicao: unknown, texto: string) { assert(condicao, texto); verificacoes++; }
const fuso = "America/Sao_Paulo", data = "2026-10-20";
const hora = (min: number) => new Date(instanteLocal(data, min, fuso));
async function main() {
  const u = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(u.hostname) && u.pathname.startsWith("/barberos_test_reunioes"), "Use um banco local isolado barberos_test_reunioes...");
  assert.equal(await db.usuario.count(), 0, "O banco isolado deve começar vazio.");
  await db.configuracao.create({ data: { id: 1, fuso } });
  const dono = await db.usuario.create({ data: { nome: "Dono teste", telefone: "5511999990001", papel: "DONO" } });
  const lider = await db.usuario.create({ data: { nome: "Líder teste", telefone: "5511999990002", papel: "LIDER" } });
  const cadeira = await db.cadeira.create({ data: { nome: "Cadeira teste" } });
  const barbeiro = await db.barbeiro.create({ data: { nome: "Barbeiro teste", cadeira: { connect: { id: cadeira.id } }, usuario: { create: { nome: "Barbeiro teste", telefone: "5511999990003", papel: "BARBEIRO" } } } });
  const outro = await db.barbeiro.create({ data: { nome: "Outro teste", usuario: { create: { nome: "Outro teste", telefone: "5511999990004", papel: "BARBEIRO" } } } });
  const cliente = await db.cliente.create({ data: { nome: "Cliente confidencial", telefone: "5511999990005" } });
  const corte = await db.servico.create({ data: { nome: "Corte teste", duracaoMin: 30, precoCentavos: 6500, custoCentavos: 700 } });
  await db.barbeiroServico.create({ data: { barbeiroId: barbeiro.id, servicoId: corte.id } });
  await db.expedientePadrao.create({ data: { barbeiroId: barbeiro.id, diaSemana: 2, inicioMin: 540, fimMin: 1080 } });
  await db.comissaoServico.create({ data: { servicoId: corte.id, avulsoTipo: "PERCENTUAL", avulsoValor: 4000, planoTipo: "FIXO", planoValor: 1500 } });
  const a = await db.agendamento.create({ data: { barbeiroId: barbeiro.id, cadeiraId: cadeira.id, clienteId: cliente.id, servicoId: corte.id, inicio: hora(600), fim: hora(630), status: "CONCLUIDO", origem: "RECEPCAO", precoCentavos: 6500 } });
  const c = await db.comanda.create({ data: { clienteId: cliente.id, status: "FECHADA", fechadaEm: hora(640), descontoCentavos: 500,
    itens: { create: { agendamentoId: a.id, barbeiroId: barbeiro.id, descricao: "Corte", quantidade: 1, precoUnitCentavos: 6500 } }, pagamentos: { create: { forma: "PIX", status: "PAGO", valorCentavos: 6000, pagoEm: hora(640) } } } });
  const sessao = (usuarioId: string, papel: Sessao["papel"], barbeiroId: string | null = null): Sessao => ({ usuarioId, papel, nome: "Teste", barbeiroId, clienteId: null });
  const sd = sessao(dono.id, "DONO"), sl = sessao(lider.id, "LIDER"), sb = sessao(barbeiro.usuarioId, "BARBEIRO", barbeiro.id);
  const p = await dadosDoPeriodo(data, data);
  ok(p.atual.faturamentoCentavos === 6000, "agenda e comanda não duplicam receita; desconto aplicado");
  ok(p.atual.comissaoCentavos === 2400, "comissão percentual sobre valor efetivamente cobrado");
  ok(p.atual.margemCentavos === 2900, "margem desconta custo e comissão cadastrados");
  ok(p.cadeiras[0].vendasCentavos === 6000 && p.servicos[0].atendimentos === 1, "cadeira e serviço reconciliam com total");
  const reuniao = await criarReuniao(sd, { titulo: "Semanal de teste", tipo: "SEMANAL", inicio: data, fim: data });
  ok(!JSON.stringify(reuniao.snapshot).includes(cliente.nome), "snapshot da reunião não guarda identificação do cliente");
  const apos = await editarReuniao(sd, reuniao.id, { titulo: reuniao.titulo, versao: reuniao.versao, conteudo: "Salário reservado", acoes: [
    { id: "minha", texto: "Conferir recompra", barbeiroId: barbeiro.id, responsavel: barbeiro.nome, prazo: "2026-10-28", concluida: false },
    { id: "outra", texto: "Ação de outro", barbeiroId: outro.id, responsavel: outro.nome, prazo: "2026-10-28", concluida: false },
  ] });
  ok(apos.snapshot.atual.faturamentoCentavos === 6000 && apos.versao === 2, "editar conteúdo preserva retrato e incrementa versão");
  await assert.rejects(() => editarReuniao(sd, reuniao.id, { titulo: reuniao.titulo, versao: 1, conteudo: "", acoes: [] }), /Outra pessoa/); verificacoes++;
  const equipe = await lerReuniao(sd, reuniao.id, true);
  ok(equipe.snapshot.financeiro === null && equipe.snapshot.atual.comissaoCentavos === null && equipe.conteudo === "" && equipe.acoes.length === 0, "apresentação equipe não transmite finanças nem notas livres");
  const limitado = await lerReuniao(sl, reuniao.id);
  ok(limitado.snapshot.financeiro === null && limitado.snapshot.barbeiros[0].margemCentavos === null && limitado.conteudo === "", "líder sem privilégios não lê lucro, margem ou notas reservadas");
  await assert.rejects(() => lerReuniao(sb, reuniao.id), /não permite/); verificacoes++;
  const minhas = await acoesDoBarbeiro(barbeiro.id, data);
  ok(minhas.length === 1 && minhas[0].id === "minha", "plano individual contém só ações explicitamente atribuídas");
  await assert.rejects(() => carregarMeuDia(sb, { data, barbeiroId: outro.id }), /próprio resumo/); verificacoes++;
  const meu = await carregarMeuDia(sb, { data });
  ok(meu.resumo.receitaPrevistaCentavos === 6500 && meu.resumo.comissaoAvulsaCentavos === 2600, "projeção identifica base da agenda e comissão própria");
  await db.pagamentoComanda.updateMany({ where: { comandaId: c.id }, data: { estornadoCentavos: 1000, estornadoEm: hora(650) } });
  const devolvido = await dadosDoPeriodo(data, data);
  ok(devolvido.atual.faturamentoCentavos === 5000 && devolvido.atual.comissaoCentavos === 2000, "estorno parcial reduz venda e comissão");
  ok((await lerReuniao(sd, reuniao.id)).snapshot.atual.faturamentoCentavos === 6000, "estorno posterior não altera retrato histórico");
  await db.servico.update({ where: { id: corte.id }, data: { custoCentavos: null } });
  ok((await dadosDoPeriodo(data, data)).atual.margemCentavos === null, "custo ausente não vira lucro inventado");
  await db.servico.update({ where: { id: corte.id }, data: { custoCentavos: 700 } });
  const plano = await db.plano.create({ data: { nome: "Plano teste", precoCentavos: 15000, servicos: { create: { servicoId: corte.id } } } });
  const assinatura = await db.assinatura.create({ data: { clienteId: cliente.id, planoId: plano.id, status: "ATIVA", formaPagamento: "PIX", precoCentavos: 15000, origem: "PAINEL", cicloInicio: hora(0) } });
  await db.cobranca.create({ data: { assinaturaId: assinatura.id, gatewayId: "teste-reunioes", status: "PAGA", valorCentavos: 15000, vencimento: new Date(`${data}T00:00:00Z`), pagaEm: hora(500) } });
  await db.poteConfig.create({ data: { id: "pote", ativo: true, percentualBps: 4000 } });
  await db.poteFicha.create({ data: { servicoId: corte.id, fichas: 1 } });
  await db.agendamento.create({ data: { barbeiroId: barbeiro.id, cadeiraId: cadeira.id, clienteId: cliente.id, servicoId: corte.id, inicio: hora(660), fim: hora(690), status: "CONCLUIDO", origem: "RECEPCAO", precoCentavos: 0, assinaturaId: assinatura.id } });
  const misto = await dadosDoPeriodo(data, data);
  ok(misto.atual.faturamentoCentavos === 20000 && misto.atual.atendimentos === 2, "mensalidade entra uma vez sem precificar corte de plano como avulso");
  ok(misto.barbeiros[0].receitaAssinaturasCentavos === 15000 && misto.atual.comissaoCentavos === 8000, "receita atribuída do pote e comissão respeitam regra existente");
  const diaria = await criarReuniao(sd, { titulo: "Diária de teste", tipo: "DIARIA", inicio: data, fim: data });
  ok(diaria.snapshot.diaria.find((d) => d.barbeiroId === barbeiro.id)?.receitaPrevistaCentavos === 6500, "reunião diária salva previsão da agenda separada do realizado");
  ok(!JSON.stringify(diaria.snapshot).includes(cliente.nome), "slides diários preservam identidade do cliente");
  const diariaEquipe = await lerReuniao(sd, diaria.id, true);
  ok(diariaEquipe.snapshot.diaria.every((d) => d.comissaoAvulsaCentavos === null), "slides diários da equipe ocultam comissões de terceiros");
  await db.reuniao.update({ where: { id: reuniao.id }, data: { criadoPorId: lider.id } });
  ok((await lerReuniao(sl, reuniao.id)).conteudo === "", "autoria não recupera conteúdo financeiro depois de revogar privilégios");
  const incompleto = await db.agendamento.create({ data: { barbeiroId: barbeiro.id, cadeiraId: cadeira.id, clienteId: cliente.id, servicoId: corte.id, inicio: hora(720), fim: hora(750), status: "MARCADO", origem: "RECEPCAO", precoCentavos: 6500 } });
  await db.comanda.create({ data: { status: "FECHADA", fechadaEm: hora(760), itens: { create: { agendamentoId: incompleto.id, descricao: "Corte não finalizado", precoUnitCentavos: 6500 } } } });
  ok((await dadosDoPeriodo(data, data)).atual.margemCentavos === null, "comanda fechada com serviço não concluído não fabrica margem sem custos/comissão");
  console.log(`Reuniões: ${verificacoes} verificações passaram em banco isolado.`);
}
main().catch((e: Error) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
