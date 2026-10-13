// Teste de integracao da roleta contra o banco de DESENVOLVIMENTO. Guarda e devolve a configuracao
// e os premios atuais; cria e apaga os proprios dados. Rodar: npm run teste:roleta
process.env.WHATSAPP_PROVIDER = "simulador";

import type { Sessao } from "@/lib/auth/sessao";
import { saldoDoCliente } from "@/lib/crescimento/saldo";
import { db } from "@/lib/db";
import { configRoleta, entregarBrinde, estadoDoCliente, girar, painelRoleta, salvarRoleta } from "@/lib/roleta/servico";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string }; } };
const TEL = "5511933337003";
async function apagarCliente(id: string) {
  await db.roletaGiro.deleteMany({ where: { clienteId: id } });
  await db.beneficio.deleteMany({ where: { clienteId: id } });
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

    const inicio = new Date(Date.now() + 60_000);
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
      pr.map((p) => ({ id: p.id, rotulo: p.rotulo, tipo: p.tipo, valorCentavos: p.valorCentavos, peso: p.tipo === "BRINDE" ? 1000 : 1, cor: p.cor, ativo: true, limiteMensal: p.tipo === "BRINDE" ? 1 : null })));
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
