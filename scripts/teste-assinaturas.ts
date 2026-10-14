// Teste de integracao do ciclo da assinatura (gateway simulado) contra o banco de DESENVOLVIMENTO.
// Cria e apaga os proprios dados. Rodar: npm run teste:assinaturas
process.env.COBRANCA_ENDERECO ||= "50, Rua Teste, Centro"; process.env.COBRANCA_CEP ||= "89160161"; process.env.COBRANCA_CIDADE ||= "Rio do Sul"; process.env.COBRANCA_UF ||= "SC";
import { db } from "@/lib/db";
import { assinar, cancelar, situacaoDoCliente, entrarNaListaDeEspera } from "@/lib/assinaturas/servico";
import { cobrancaEmAberto, processarEventoGateway } from "@/lib/assinaturas/cobrancas";
import { pagarSimulada, atrasarSimulada } from "@/lib/pagamentos/simulado";
import { agendarPeloCliente } from "@/lib/agenda/cliente";
import { alterarStatus } from "@/lib/agenda/agendamentos";
import { ErroNegocio } from "@/lib/erros";
import { instanteLocal } from "@/lib/agenda/tempo";

const ok = (c: boolean, msg: string) => console.log(`${c ? "OK  " : "FALHOU"} ${msg}`);
const FUSO = "America/Sao_Paulo";
const dono = { usuarioId: "teste", papel: "DONO" as const, nome: "t", barbeiroId: null, clienteId: null };

async function tentar<T>(f: () => Promise<T>): Promise<T | ErroNegocio> {
  try { return await f(); } catch (e) { if (e instanceof ErroNegocio) return e; throw e; }
}

async function limpar(tel: string) {
  const c = await db.cliente.findUnique({ where: { telefone: tel } });
  if (!c) return;
  await db.agendamento.deleteMany({ where: { clienteId: c.id } });
  await db.assinatura.deleteMany({ where: { clienteId: c.id } });
  await db.listaEsperaPlano.deleteMany({ where: { clienteId: c.id } });
  await db.conversa.deleteMany({ where: { telefone: tel } });
  await db.cliente.delete({ where: { id: c.id } });
}

async function main() {
  const A = "5511933330001", B = "5511933330002";
  await limpar(A); await limpar(B);
  const ca = await db.cliente.create({ data: { telefone: A, nome: "Assinante Teste" } });
  const cb = await db.cliente.create({ data: { telefone: B, nome: "Espera Teste" } });
  const pCorte = await db.plano.findFirstOrThrow({ where: { nome: "Plano Corte" } });
  const pCombo = await db.plano.findFirstOrThrow({ where: { nome: "Plano Corte + Barba" } });
  const corte = await db.servico.findFirstOrThrow({ where: { nome: "Corte" } });
  const luzes = await db.servico.findFirstOrThrow({ where: { nome: "Luzes" } });
  const joao = await db.barbeiro.findFirstOrThrow({ where: { nome: "Joao" } });
  const pedro = await db.barbeiro.findFirstOrThrow({ where: { nome: "Pedro" } });

  // 1. CPF invalido e recusado
  const e1 = await tentar(() => assinar({ clienteId: ca.id, planoId: pCorte.id, forma: "PIX", cpf: "111.111.111-11", origem: "SITE" }));
  ok(e1 instanceof ErroNegocio && e1.codigo === "cpf", "CPF inválido recusado");

  // 2. Assina: fica pendente com link
  const r = await assinar({ clienteId: ca.id, planoId: pCorte.id, forma: "PIX", cpf: "529.982.247-25", origem: "SITE" });
  ok(r.assinatura.status === "PENDENTE" && !!r.link?.includes("/c/pagamento-simulado/"), `assinatura pendente com link (${r.link})`);
  const again = await assinar({ clienteId: ca.id, planoId: pCorte.id, forma: "PIX", origem: "SITE" });
  ok(again.reaproveitada && again.link === r.link, "pedir de novo reaproveita a mesma cobrança");

  // 3. Antes de pagar, corte e cobrado normal
  // Proxima sexta com pelo menos 2 dias de folga (o teste nao depende do dia em que roda).
  const base = new Date(Date.now() + 2 * 86_400_000);
  base.setUTCDate(base.getUTCDate() + ((5 - base.getUTCDay() + 7) % 7));
  const SEXTA = base.toISOString().slice(0, 10);
  const sex = (h: number, dias = 0) => new Date(instanteLocal(SEXTA, h * 60, FUSO) + dias * 86_400_000);
  const ag0 = await agendarPeloCliente({ telefone: A, nome: "x", barbeiroId: joao.id, servicoId: corte.id, inicio: sex(9), origem: "SITE" });
  ok(ag0.precoCentavos === 5000 && ag0.assinaturaId === null, "sem pagar: corte avulso R$ 50");
  await alterarStatus(ag0.id, "CANCELADO", dono);

  // 4. Paga -> ativa
  let aberta = await cobrancaEmAberto(r.assinatura.id);
  await pagarSimulada(aberta!.gatewayId);
  await processarEventoGateway(`t_${aberta!.gatewayId}_pago`, "PAYMENT_RECEIVED", aberta!.gatewayId);
  const rep = await processarEventoGateway(`t_${aberta!.gatewayId}_pago`, "PAYMENT_RECEIVED", aberta!.gatewayId);
  let sit = await situacaoDoCliente(ca.id);
  ok(sit?.assinatura.status === "ATIVA" && sit.valida, "pagamento confirmado: ATIVA");
  ok(rep.repetido === true, "webhook repetido é ignorado");

  // 5. Agenda pelo plano
  const ag1 = await agendarPeloCliente({ telefone: A, nome: "x", barbeiroId: joao.id, servicoId: corte.id, inicio: sex(10), origem: "SITE" });
  ok(ag1.precoCentavos === 0 && ag1.assinaturaId === sit!.assinatura.id, "corte pelo plano: R$ 0");
  const e2 = await tentar(() => agendarPeloCliente({ telefone: A, nome: "x", barbeiroId: pedro.id, servicoId: corte.id, inicio: sex(10, 1), origem: "SITE" }));
  ok(e2 instanceof ErroNegocio && e2.codigo === "regra_plano", `2º horário aberto bloqueado: "${(e2 as Error).message}"`);

  // 6. Depois de atendido, intervalo de 7 dias
  await alterarStatus(ag1.id, "CONCLUIDO", dono);
  const e3 = await tentar(() => agendarPeloCliente({ telefone: A, nome: "x", barbeiroId: pedro.id, servicoId: corte.id, inicio: sex(10, 4), origem: "SITE" }));
  ok(e3 instanceof ErroNegocio && /a partir de/.test(e3.message), `intervalo de 7 dias: "${(e3 as Error).message}"`);
  const ag2 = await agendarPeloCliente({ telefone: A, nome: "x", barbeiroId: pedro.id, servicoId: corte.id, inicio: sex(10, 4), origem: "SITE", forcarAvulso: true });
  ok(ag2.precoCentavos === 4500 && ag2.assinaturaId === null, "aceitou avulso: R$ 45 (10% de assinante)");
  await alterarStatus(ag2.id, "CANCELADO", dono);
  const ag3 = await agendarPeloCliente({ telefone: A, nome: "x", barbeiroId: pedro.id, servicoId: corte.id, inicio: sex(10, 8), origem: "SITE" });
  ok(ag3.precoCentavos === 0, "8 dias depois: pelo plano de novo");

  // 7. Servico fora do plano: desconto
  const ag4 = await agendarPeloCliente({ telefone: A, nome: "x", barbeiroId: pedro.id, servicoId: luzes.id, inicio: sex(14, 8), origem: "SITE" });
  ok(ag4.precoCentavos === 13500, `luzes (fora do plano): R$ ${ag4.precoCentavos / 100} com 10%`);
  await alterarStatus(ag4.id, "CANCELADO", dono);

  // 8. Atraso: dentro da tolerancia ainda vale
  const { gerarProximaSimulada } = await import("@/lib/pagamentos/simulado");
  const prox = await gerarProximaSimulada(sit!.assinatura.gatewayId!);
  await atrasarSimulada(prox.id);
  await processarEventoGateway(`t_${prox.id}_atraso`, "PAYMENT_OVERDUE", prox.id);
  sit = await situacaoDoCliente(ca.id);
  ok(sit?.assinatura.status === "ATRASADA" && sit.valida === true, "vencida ontem: ATRASADA mas ainda vale (tolerância 3 dias)");
  // O aviso sai em segundo plano: espera ate 3 s.
  let aviso = null;
  for (let i = 0; i < 30 && !aviso; i++) {
    aviso = await db.mensagem.findFirst({ where: { conversa: { telefone: A }, texto: { contains: "ainda não foi paga" } } });
    if (!aviso) await new Promise((r) => setTimeout(r, 100));
  }
  ok(!!aviso, "cliente avisado no WhatsApp com o link");

  // 9. Cancelar: horario futuro vira avulso
  await cancelar(sit!.assinatura.id, "Ficou caro", null);
  const ag3b = await db.agendamento.findUniqueOrThrow({ where: { id: ag3.id } });
  sit = await situacaoDoCliente(ca.id);
  ok(sit === null && ag3b.assinaturaId === null && ag3b.precoCentavos === 5000, "cancelada: horário futuro virou avulso R$ 50");

  // 10. Vagas e lista de espera
  // Sobra exatamente 1 vaga (o banco de desenvolvimento pode ter assinantes de verdade nesse plano).
  const ocupadas = await db.assinatura.count({ where: { planoId: pCombo.id, OR: [{ status: { in: ["ATIVA", "ATRASADA"] } }, { status: "PENDENTE", criadaEm: { gt: new Date(Date.now() - 3 * 86_400_000) } }] } });
  await db.plano.update({ where: { id: pCombo.id }, data: { vagas: ocupadas + 1 } });
  const ra = await assinar({ clienteId: ca.id, planoId: pCombo.id, forma: "CARTAO", origem: "SITE" });
  aberta = await cobrancaEmAberto(ra.assinatura.id);
  await pagarSimulada(aberta!.gatewayId);
  await processarEventoGateway(`t_${aberta!.gatewayId}_pago`, "PAYMENT_RECEIVED", aberta!.gatewayId);
  const e4 = await tentar(() => assinar({ clienteId: cb.id, planoId: pCombo.id, forma: "PIX", cpf: "529.982.247-25", origem: "SITE" }));
  ok(e4 instanceof ErroNegocio && e4.codigo === "sem_vagas", "plano lotado recusa nova adesão");
  await entrarNaListaDeEspera(cb.id, pCombo.id);
  await cancelar(ra.assinatura.id, "Mudei de cidade ou de bairro", null);
  await new Promise((r) => setTimeout(r, 500));
  const avisoVaga = await db.mensagem.findFirst({ where: { conversa: { telefone: B }, texto: { contains: "Abriu uma vaga" } } });
  ok(!!avisoVaga, "vaga aberta: primeiro da lista de espera avisado");
  await db.plano.update({ where: { id: pCombo.id }, data: { vagas: 45 } });

  await limpar(A); await limpar(B);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
