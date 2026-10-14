// Teste de integracao da roleta contra o banco de DESENVOLVIMENTO. Guarda e devolve a configuracao
// e os premios atuais; cria e apaga os proprios dados. Rodar: npm run teste:roleta
process.env.WHATSAPP_PROVIDER = "simulador";

import type { Sessao } from "@/lib/auth/sessao";
import { saldoDoCliente } from "@/lib/crescimento/saldo";
import { db } from "@/lib/db";
import { configRoleta, entregarBrinde, estadoDoCliente, girar, painelRoleta, resultadoRoleta, salvarRoleta } from "@/lib/roleta/servico";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string }; } };
const TEL = "5511933337003";
async function apagarCliente(id: string) {
  await db.roletaGiro.deleteMany({ where: { clienteId: id } });
  await db.beneficio.deleteMany({ where: { clienteId: id } });
  await db.comanda.deleteMany({ where: { clienteId: id } });
  await db.agendamento.deleteMany({ where: { clienteId: id } });
  await db.cliente.delete({ where: { id } });
}

async function main() {
  await configRoleta();
  const cfgAntes = await db.roletaConfig.findUniqueOrThrow({ where: { id: 1 } });
  const premiosAntes = await db.roletaPremio.findMany();
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, barbeiroId: null, clienteId: null };
  const velho = await db.cliente.findUnique({ where: { telefone: TEL } });
  if (velho) await apagarCliente(velho.id);
  const cliente = await db.cliente.create({ data: { telefone: TEL, nome: "Teste Roleta" } });
  const barbeiro = await db.barbeiro.findFirstOrThrow({ where: { ativo: true } });
  const servico = await db.servico.findFirstOrThrow({ where: { ativo: true } });
  const antes = await resultadoRoleta("mes");
  try {
    // So 2 premios: R$ 5 (sempre sai) e brinde com peso 0 -> controlado
    await salvarRoleta(s, { ativa: false, girosPorAtendimento: 2, giroGratisDias: 0, bonusAssinantePct: 10, validadeDias: 30 }, [
      { rotulo: "R$ 5", tipo: "CREDITO", valorCentavos: 500, peso: 1, cor: "#8BC34A", ativo: true, limiteMensal: null },
      { rotulo: "Brinde", tipo: "BRINDE", valorCentavos: 0, peso: 0, cor: "#1E88E5", ativo: true, limiteMensal: null },
    ]);
    ok((await falha(() => girar(cliente.id)))?.codigo === "desligada", "roleta desligada não gira");
    await salvarRoleta(s, { ativa: true, girosPorAtendimento: 2, giroGratisDias: 0, bonusAssinantePct: 10, validadeDias: 30 },
      (await painelRoleta()).premios.filter((p) => p.ativo).map((p) => ({ id: p.id, rotulo: p.rotulo, tipo: p.tipo, valorCentavos: p.valorCentavos, peso: p.peso, cor: p.cor, ativo: true, limiteMensal: p.limiteMensal })));
    ok((await falha(() => girar(cliente.id)))?.codigo === "sem_giros", "sem atendimento concluído não tem giro");

    // Horario longe de qualquer agenda real (so conta ser CONCLUIDO depois de ligar a roleta).
    const inicio = new Date("2031-06-02T13:00:00Z");
    await db.agendamento.create({ data: { barbeiroId: barbeiro.id, clienteId: cliente.id, servicoId: servico.id, inicio, fim: new Date(+inicio + 1_800_000), precoCentavos: 5000, origem: "SITE", status: "CONCLUIDO" } });
    ok((await estadoDoCliente(cliente.id)).giros === 2, "1 atendimento concluído = 2 giros (configurado)");

    // Dois toques ao mesmo tempo + um terceiro: so 2 passam
    const r = await Promise.allSettled([girar(cliente.id), girar(cliente.id), girar(cliente.id)]);
    ok(r.filter((x) => x.status === "fulfilled").length === 2, "giros simultâneos não passam do que o cliente tem");
    ok((await saldoDoCliente(cliente.id)) === 1000, "prêmio em dinheiro cai no saldo (2 x R$ 5)");
    ok((await db.beneficio.findFirstOrThrow({ where: { clienteId: cliente.id } })).motivo === "ROLETA", "crédito aparece no extrato como Roleta");

    // Brinde com limite mensal 1: sai uma vez e depois so o dinheiro
    const pr = (await painelRoleta()).premios.filter((p) => p.ativo);
    await salvarRoleta(s, { ativa: true, girosPorAtendimento: 2, giroGratisDias: 0, bonusAssinantePct: 10, validadeDias: 30 },
      pr.map((p) => ({ id: p.id, rotulo: p.rotulo, tipo: p.tipo, valorCentavos: p.valorCentavos, peso: p.tipo === "BRINDE" ? 1000 : 1, cor: p.cor, ativo: true, limiteMensal: p.tipo === "BRINDE" ? 1 : null, custoCentavos: p.tipo === "BRINDE" ? 400 : 0 })));
    ok((await painelRoleta()).premios.find((p) => p.tipo === "BRINDE")?.custoCentavos === 400, "brinde guarda o custo interno (R$ 4)");
    await db.agendamento.create({ data: { barbeiroId: barbeiro.id, clienteId: cliente.id, servicoId: servico.id, inicio: new Date(+inicio + 3_600_000), fim: new Date(+inicio + 5_400_000), precoCentavos: 5000, origem: "SITE", status: "CONCLUIDO" } });
    const saiuAntes = await db.roletaGiro.count({ where: { tipo: "BRINDE", premio: { rotulo: "Brinde" } } });
    const g1 = await girar(cliente.id);
    const g2 = await girar(cliente.id);
    if (saiuAntes === 0) ok(g1.tipo === "BRINDE" && g2.tipo === "CREDITO", "brinde com limite de 1 por mês sai uma vez só");
    const est = await estadoDoCliente(cliente.id);
    ok(est.aRetirar.length === (saiuAntes === 0 ? 1 : 0), "brinde fica a retirar no balcão");
    if (est.aRetirar[0]) {
      await entregarBrinde(s, est.aRetirar[0].id);
      ok((await estadoDoCliente(cliente.id)).aRetirar.length === 0, "equipe marca o brinde como entregue");
      ok(!!(await falha(() => entregarBrinde(s, est.aRetirar[0].id))), "não entrega o mesmo brinde duas vezes");
      ok((await db.roletaGiro.findUniqueOrThrow({ where: { id: est.aRetirar[0].id } })).custoCentavos === 400, "giro guarda o custo do brinde no momento do sorteio");

      // Custo x faturamento: comanda de hoje (R$ 50) com R$ 5 de credito da roleta usado (paga R$ 45).
      const cm = await db.comanda.create({ data: { clienteId: cliente.id, status: "FECHADA", descontoCentavos: 500, fechadaEm: new Date() } });
      await db.itemComanda.create({ data: { comandaId: cm.id, descricao: "Corte", precoUnitCentavos: 5000 } });
      await db.pagamentoComanda.create({ data: { comandaId: cm.id, forma: "PIX", valorCentavos: 4500, status: "PAGO", pagoEm: new Date() } });
      const cred = await db.beneficio.findFirstOrThrow({ where: { clienteId: cliente.id, motivo: "ROLETA", status: "DISPONIVEL" } });
      await db.beneficio.update({ where: { id: cred.id }, data: { status: "USADO", usadoEm: new Date(), comandaId: cm.id } });
      const depois = await resultadoRoleta("mes");
      ok(depois.giros.total - antes.giros.total === 4, `giros do mês contam todos os sorteios (+${depois.giros.total - antes.giros.total})`);
      ok(depois.brindes.entregues - antes.brindes.entregues === 1 && depois.brindes.custoCentavos - antes.brindes.custoCentavos === 400, "custo dos brindes entregues (R$ 4)");
      ok(depois.creditos.usadoCentavos - antes.creditos.usadoCentavos === 500, "custo do crédito da roleta usado (R$ 5)");
      ok(depois.custoCentavos - antes.custoCentavos === 900, "custo da roleta = brindes + crédito usado (R$ 9)");
      ok(depois.visitas - antes.visitas === 1 && depois.faturamentoCentavos - antes.faturamentoCentavos === 4500, `faturamento da visita com resgate conta uma vez (R$ 45) (${depois.faturamentoCentavos - antes.faturamentoCentavos})`);
    }
    ok((await falha(() => salvarRoleta(s, cfgAntes, [{ rotulo: "Só um", tipo: "NADA", valorCentavos: 0, peso: 1, cor: "#000000", ativo: true, limiteMensal: null }]))) !== null, "exige pelo menos 2 fatias ativas");
  } finally {
    await apagarCliente(cliente.id);
    await db.roletaGiro.updateMany({ data: { premioId: null }, where: { premioId: { notIn: premiosAntes.map((p) => p.id) } } });
    await db.roletaPremio.deleteMany({ where: { id: { notIn: premiosAntes.map((p) => p.id) } } });
    for (const p of premiosAntes) await db.roletaPremio.update({ where: { id: p.id }, data: p });
    await db.roletaConfig.update({ where: { id: 1 }, data: cfgAntes });
  }
  console.log(process.exitCode ? "\nAlgum teste FALHOU." : "\nTodos os testes passaram.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
