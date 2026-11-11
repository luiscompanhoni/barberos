import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { dataLocal, dataParaColuna, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { precificar } from "@/lib/assinaturas/agenda";
import { marcarCiclosManuaisVencidos, registrarAssinaturaPaga } from "@/lib/assinaturas/registro-manual";
import { vencimentoDoRegistro } from "@/lib/assinaturas/registro-manual-regras";
import { situacaoDoCliente } from "@/lib/assinaturas/servico";
import { ErroNegocio } from "@/lib/erros";
import { indicadoresDeAssinaturas } from "@/lib/indicadores/assinaturas-bar";
import { resolverPeriodo } from "@/lib/indicadores/periodo";
import { resumoDoMes } from "@/lib/painel";

const url = new URL(process.env.DATABASE_URL ?? "http://invalido");
if (url.hostname !== "127.0.0.1" || url.port !== "55561" || url.pathname !== "/barberos_registro_manual_20261111" ||
  process.env.PAGAMENTOS_PROVIDER !== "simulado" || process.env.WHATSAPP_ENVIOS_BLOQUEADOS !== "true") {
  throw new Error("Use apenas o banco descartável nominal e os provedores de teste.");
}
globalThis.fetch = async () => { throw new Error("Rede externa bloqueada no teste."); };

async function rejeita(p: Promise<unknown>, codigo: string) {
  await assert.rejects(p, e => e instanceof ErroNegocio && e.codigo === codigo);
}

async function main() {
  const fuso = "America/Sao_Paulo";
  const hoje = dataLocal(Date.now(), fuso);
  await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, nomeBarbearia: "Teste descartável", fuso }, update: { fuso } });
  const baseTel = `55119${Date.now().toString().slice(-7)}`;
  const recepcao = await db.usuario.create({ data: { nome: "Recepção fictícia", telefone: baseTel + "1", papel: "RECEPCAO" } });
  const sessao = { usuarioId: recepcao.id, nome: recepcao.nome, papel: recepcao.papel, sessaoVersao: recepcao.sessaoVersao, clienteId: null, barbeiroId: null };
  const cliente = await db.cliente.create({ data: { nome: "Cliente fictício", telefone: baseTel + "2" } });
  const legado = await db.cliente.create({ data: { nome: "Legado fictício", telefone: baseTel + "3" } });
  const servico = await db.servico.create({ data: { nome: "Corte fictício", duracaoMin: 40, precoCentavos: 6500 } });
  const plano = await db.plano.create({ data: { nome: `Plano fictício ${baseTel}`, precoCentavos: 11800, servicos: { create: { servicoId: servico.id } } } });
  const dados = {
    clienteId: cliente.id, planoId: plano.id, forma: "PIX" as const,
    pagoEm: somarDias(hoje, -2), proximoVencimento: somarDias(hoje, 5), precoPlanoCentavos: plano.precoCentavos,
  };
  assert.equal(vencimentoDoRegistro("2026-01-31"), "2026-02-28");
  assert.equal(vencimentoDoRegistro("2028-01-31"), "2028-02-29");
  for (const papel of ["BARBEIRO", "CLIENTE", "LIDER"] as const) await rejeita(registrarAssinaturaPaga({ ...sessao, papel }, dados), "proibido");
  await rejeita(registrarAssinaturaPaga({ ...sessao, sessaoVersao: sessao.sessaoVersao + 1 }, dados), "sessao_invalida");
  await db.usuario.update({ where: { id: recepcao.id }, data: { ativo: false } });
  await rejeita(registrarAssinaturaPaga(sessao, dados), "sessao_invalida");
  await db.usuario.update({ where: { id: recepcao.id }, data: { ativo: true } });
  await rejeita(registrarAssinaturaPaga(sessao, { ...dados, pagoEm: somarDias(hoje, 1) }), "pagamento_futuro");
  await rejeita(registrarAssinaturaPaga(sessao, { ...dados, pagoEm: somarDias(hoje, -90), proximoVencimento: somarDias(hoje, -60) }), "ciclo_manual_vencido");
  await rejeita(registrarAssinaturaPaga(sessao, { ...dados, proximoVencimento: dados.pagoEm }), "vencimento_invalido");
  await rejeita(registrarAssinaturaPaga(sessao, { ...dados, precoPlanoCentavos: 1 }), "plano_alterado");

  const antiga = await db.assinatura.create({ data: {
    clienteId: legado.id, planoId: plano.id, formaPagamento: "CARTAO", precoCentavos: 11800,
    gatewayId: `cashbarber:teste-concorrencia:${legado.id}`, status: "PENDENTE", origem: "PAINEL",
  } });
  await rejeita(registrarAssinaturaPaga(sessao, { ...dados, clienteId: legado.id }), "assinatura_existente");
  assert.equal((await db.assinatura.findUniqueOrThrow({ where: { id: antiga.id } })).status, "PENDENTE");

  const cobrancas = await db.cobranca.count();
  const movimentos = await db.movimentoCaixa.count();
  const mensagens = await db.mensagem.count();
  const resumoAntes = (await resumoDoMes()).assinaturas;
  const respostas = await Promise.all(Array.from({ length: 4 }, () => registrarAssinaturaPaga(sessao, dados)));
  assert.equal(respostas.filter(r => r.novo).length, 1);
  const id = respostas[0].id;
  assert.ok(respostas.every(r => r.id === id && r.status === "ATIVA" && r.proximoVencimento === dados.proximoVencimento));
  const registro = await db.assinatura.findUniqueOrThrow({ where: { id } });
  assert.equal(registro.gatewayId, null);
  assert.equal(registro.tokenPublico, null);
  assert.deepEqual(registro.ultimoPagamentoManualEm, dataParaColuna(dados.pagoEm));
  assert.equal(await db.auditoria.count({ where: { acao: "registrar_plano_ja_pago", entidadeId: id, usuarioId: recepcao.id } }), 1);
  assert.equal((await situacaoDoCliente(cliente.id))?.valida, true);
  const diaSeguinte = somarDias(dados.proximoVencimento, 1);
  const preco = { clienteId: cliente.id, servicoId: servico.id, barbeiroId: "ficticio", precoBase: 6500, fuso };
  assert.equal((await precificar({ ...preco, inicio: instanteLocal(dados.pagoEm, 0, fuso) - 1 })).precoCentavos, 6500);
  assert.equal((await precificar({ ...preco, inicio: instanteLocal(dados.pagoEm, 0, fuso) })).precoCentavos, 0);
  assert.equal((await precificar({ ...preco, inicio: instanteLocal(dados.proximoVencimento, 600, fuso) })).precoCentavos, 0);
  assert.equal((await precificar({ ...preco, inicio: instanteLocal(diaSeguinte, 600, fuso) })).precoCentavos, 6500);
  const resumoDepois = (await resumoDoMes()).assinaturas;
  assert.deepEqual(resumoDepois, { ...resumoAntes, ativas: resumoAntes.ativas + 1 });
  const indicadores = await indicadoresDeAssinaturas(resolverPeriodo("mes", fuso));
  assert.deepEqual(indicadores.porPlano.find(p => p.nome === plano.nome), { nome: plano.nome, ativas: 1, mrrCentavos: 0 });

  await rejeita(registrarAssinaturaPaga(sessao, { ...dados, forma: "BOLETO" }), "ciclo_manual_anterior");
  const proximo = { ...dados, pagoEm: hoje, proximoVencimento: somarDias(hoje, 10), forma: "BOLETO" as const };
  await rejeita(registrarAssinaturaPaga(sessao, proximo), "ciclo_manual_vigente");
  await db.assinatura.update({ where: { id }, data: { proximoVencimento: dataParaColuna(somarDias(hoje, -1)) } });
  assert.equal((await situacaoDoCliente(cliente.id))?.valida, false);
  assert.equal((await situacaoDoCliente(cliente.id))?.assinatura.status, "ATRASADA");
  await marcarCiclosManuaisVencidos();
  assert.equal((await db.assinatura.findUniqueOrThrow({ where: { id } })).status, "ATRASADA");
  const renovada = await registrarAssinaturaPaga(sessao, proximo);
  assert.equal(renovada.id, id);
  assert.equal((await db.assinatura.findUniqueOrThrow({ where: { id } })).formaPagamento, "BOLETO");
  assert.equal(await db.auditoria.count({ where: { acao: "registrar_plano_ja_pago", entidadeId: id } }), 2);
  await db.assinatura.update({ where: { id }, data: { status: "CANCELADA", canceladaEm: new Date() } });
  await rejeita(registrarAssinaturaPaga(sessao, proximo), "ciclo_manual_anterior");
  assert.equal(await db.assinatura.count({ where: { clienteId: cliente.id } }), 1);
  assert.equal(await db.auditoria.count({ where: { acao: "registrar_plano_ja_pago", entidadeId: id } }), 2);
  assert.equal(await db.cobranca.count(), cobrancas);
  assert.equal(await db.movimentoCaixa.count(), movimentos);
  assert.equal(await db.mensagem.count(), mensagens);
  console.log("OK registro manual: sessão revalidada, vigência, duplicidade após cancelamento, auditoria e indicadores, caixa e envios preservados.");
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
