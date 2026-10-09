// Teste de integracao: lista de espera, retorno no ritmo do cliente e indicacao com premio,
// contra o banco de DESENVOLVIMENTO (WhatsApp em modo simulador). Cria e apaga os proprios dados.
// Rodar: npm run teste:crescimento
process.env.WHATSAPP_PROVIDER = "simulador";

import type { Sessao } from "@/lib/auth/sessao";
import { carregarDia, configuracao, servicoDoBarbeiro } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { adicionarProduto, abrirComanda, cancelarComanda, detalheComanda, fecharComanda } from "@/lib/comandas/servico";
import { entrarNaEspera, opcoesDoDia } from "@/lib/crescimento/espera";
import { codigoDoCliente, registrarIndicacao } from "@/lib/crescimento/indicacao";
import { extratoDoCliente, indicadosDoCliente, saldoDoCliente, usarSaldo } from "@/lib/crescimento/saldo";
import { registrarPagamento } from "@/lib/comandas/maquininha";
import { processarEsperas, processarIndicacoes, processarRetornos } from "@/lib/crescimento/rotina";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";

const ok = (c: boolean, msg: string) => console.log(`${c ? "OK  " : "FALHOU"} ${msg}`);
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error; } };
const MIN = 60_000;
const D = 86_400_000;
const TELS = ["5511933336001", "5511933336002", "5511933336003", "5511933336004", "5511933336005", "5511933336006"];
const bloqueiosCriados: string[] = [];

async function limpar() {
  const cs = await db.cliente.findMany({ where: { telefone: { in: TELS } }, select: { id: true } });
  const ids = cs.map((c) => c.id);
  const comandas = await db.comanda.findMany({ where: { clienteId: { in: ids } }, select: { id: true } });
  await db.movimentoEstoque.deleteMany({ where: { comandaId: { in: comandas.map((c) => c.id) } } });
  await db.comanda.deleteMany({ where: { id: { in: comandas.map((c) => c.id) } } });
  await db.automacaoEnviada.deleteMany({ where: { clienteId: { in: ids } } });
  await db.agendamento.deleteMany({ where: { clienteId: { in: ids } } });
  await db.bloqueio.deleteMany({ where: { id: { in: bloqueiosCriados } } });
  const conversas = await db.conversa.findMany({ where: { telefone: { in: TELS } }, select: { id: true } });
  await db.mensagem.deleteMany({ where: { conversaId: { in: conversas.map((c) => c.id) } } });
  await db.conversa.deleteMany({ where: { telefone: { in: TELS } } });
  await db.cliente.deleteMany({ where: { id: { in: ids } } }); // esperas, indicacoes e beneficios vao junto (cascade)
}

async function main() {
  await limpar();
  const original = await db.configuracao.findUniqueOrThrow({ where: { id: 1 } });
  await db.configuracao.update({ where: { id: 1 }, data: { retornoAtivo: true, indicacaoAtiva: true, premioIndicadorCentavos: 2000, premioIndicadoCentavos: 1000 } });
  const cfg = await configuracao();
  try {
    const servico = await db.servico.findFirstOrThrow({ where: { nome: "Corte" } });
    const barbeiro = await db.barbeiro.findFirstOrThrow({ where: { ativo: true, servicos: { some: { servicoId: servico.id } } } });
    const [e1, e2, r1, r2, ind, novo] = await Promise.all(TELS.map((telefone, i) => db.cliente.create({ data: { telefone, nome: `Cresc Teste ${i + 1}` } })));
    const ids = [e1, e2, r1, r2, ind, novo].map((c) => c.id);
    const hoje = dataLocal(Date.now(), cfg.fuso);
    // Dentro do horario de aviso (7h-21h), mesmo rodando de madrugada ou a noite.
    const agora = Math.min(Math.max(Date.now(), instanteLocal(hoje, 10 * 60, cfg.fuso)), instanteLocal(hoje, 20 * 60, cfg.fuso));

    // ================= LISTA DE ESPERA
    // Dia com expediente e algum horario livre de verdade (a agenda de desenvolvimento tem atendimentos).
    let dia = "";
    let janelas: { inicio: number; fim: number }[] = [];
    let livres: Awaited<ReturnType<typeof opcoesDoDia>> = [];
    for (let i = 2; i < 15 && !livres.length; i++) {
      dia = somarDias(hoje, i);
      janelas = (await carregarDia(dia, [barbeiro.id], { fuso: cfg.fuso })).get(barbeiro.id)!.janelas;
      livres = janelas.length ? await opcoesDoDia(dia, servico.id, barbeiro.id, "QUALQUER") : [];
    }
    const bloquear = async (inicio: number, fim: number) => {
      if (fim <= inicio) return;
      bloqueiosCriados.push((await db.bloqueio.create({ data: { barbeiroId: barbeiro.id, inicio: new Date(inicio), fim: new Date(fim), motivo: "teste-crescimento" } })).id);
    };
    const inicioDia = janelas[0].inicio, fimDia = janelas.at(-1)!.fim;
    await bloquear(inicioDia, fimDia); // dia lotado

    await entrarNaEspera(e1.id, { data: dia, servicoId: servico.id, barbeiroId: barbeiro.id, origem: "SITE" });
    await new Promise((r) => setTimeout(r, 20));
    await entrarNaEspera(e2.id, { data: dia, servicoId: servico.id, barbeiroId: barbeiro.id, origem: "BOT" });
    const dup = await entrarNaEspera(e1.id, { data: dia, servicoId: servico.id, barbeiroId: barbeiro.id, origem: "SITE" });
    ok((await db.esperaHorario.count({ where: { clienteId: e1.id } })) === 1 && !!dup, "entrar duas vezes no mesmo dia não duplica");
    ok((await processarEsperas(agora, { clienteIds: ids })) === 0, "sem vaga: ninguém é avisado");

    // Abre exatamente 1 horario (cancelamento): libera so o espaco de um corte.
    await db.bloqueio.deleteMany({ where: { id: { in: bloqueiosCriados.splice(0) } } });
    const duracao = (await servicoDoBarbeiro(barbeiro.id, servico.id))!.duracaoMin; // o barbeiro pode ter duracao propria
    const slot = Date.parse(livres[0].inicio);
    await bloquear(inicioDia, slot);
    await bloquear(slot + duracao * MIN, fimDia);

    ok((await processarEsperas(agora, { clienteIds: ids })) === 1, "abriu 1 vaga: avisa 1 pessoa");
    const s1 = await db.esperaHorario.findFirstOrThrow({ where: { clienteId: e1.id } });
    const s2 = await db.esperaHorario.findFirstOrThrow({ where: { clienteId: e2.id } });
    ok(s1.status === "AVISADA" && s2.status === "ATIVA", "o primeiro da fila é avisado primeiro");
    const msgEspera = await db.mensagem.findFirst({ where: { conversa: { telefone: TELS[0] }, texto: { contains: "Abriu horário" } } });
    ok(!!msgEspera?.texto.includes(barbeiro.nome), `mensagem com o horário: "${msgEspera?.texto.slice(0, 90)}..."`);
    ok((await processarEsperas(agora + 5 * MIN, { clienteIds: ids })) === 0, "5 min depois: ainda é a vez do primeiro");
    ok((await processarEsperas(agora + 21 * MIN, { clienteIds: ids })) === 1, "20 min sem ninguém pegar: vai para o próximo da fila");

    // Com vaga, nao entra na espera (manda marcar)
    const livre = somarDias(dia, 1);
    const eVaga = await falha(() => entrarNaEspera(r2.id, { data: livre, servicoId: servico.id, origem: "SITE" }));
    ok(eVaga instanceof ErroNegocio && eVaga.codigo === "tem_vaga", "dia com vaga: sugere marcar direto");

    // ================= RETORNO NO RITMO
    const visita = (clienteId: string, quando: number, minuto = 0) => {
      const inicio = instanteLocal(dataLocal(quando, cfg.fuso), 5 * 60 + minuto, cfg.fuso); // de madrugada: fora do expediente, nao colide
      return db.agendamento.create({ data: { barbeiroId: barbeiro.id, servicoId: servico.id, clienteId, inicio: new Date(inicio), fim: new Date(inicio + 30 * MIN), status: "CONCLUIDO", origem: "RECEPCAO", precoCentavos: 5000 } });
    };
    for (const [k, c] of [r1, r2].entries()) for (const d of [59, 39, 19]) await visita(c.id, Date.now() - d * D, k * 40);
    // r2 ja tem horario marcado: nao precisa lembrar
    const futuro = instanteLocal(somarDias(hoje, 20), 6 * 60, cfg.fuso);
    await db.agendamento.create({ data: { barbeiroId: barbeiro.id, servicoId: servico.id, clienteId: r2.id, inicio: new Date(futuro), fim: new Date(futuro + 30 * MIN), status: "MARCADO", origem: "RECEPCAO", precoCentavos: 5000 } });
    ok((await processarRetornos(agora, { clienteIds: ids })) === 1, "ritmo de 20 dias, 19 sem vir: lembra (e pula quem já marcou)");
    const msgRet = await db.mensagem.findFirst({ where: { conversa: { telefone: TELS[2] }, texto: { contains: "hora do trato" } } });
    ok(!!msgRet?.texto.match(/19 dias/), `mensagem de retorno: "${msgRet?.texto.slice(0, 110)}..."`);
    ok((await processarRetornos(agora + 10 * MIN, { clienteIds: ids })) === 0, "não repete o lembrete");

    // ================= INDICACAO
    const s: Sessao = { usuarioId: (await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } })).id, papel: "DONO", nome: "Dono", barbeiroId: null, clienteId: null };
    const codigo = await codigoDoCliente(ind.id);
    ok(codigo === (await codigoDoCliente(ind.id)) && /^CRESC[A-Z2-9]{3}$/.test(codigo), `código estável e legível (${codigo})`);
    const eProprio = await falha(() => registrarIndicacao(ind.id, codigo, "SITE"));
    ok(eProprio instanceof ErroNegocio, "não indica a si mesmo");
    const eAntigo = await falha(() => registrarIndicacao(r1.id, codigo, "SITE"));
    ok(eAntigo instanceof ErroNegocio, "quem já cortou aqui não conta como indicado");
    await registrarIndicacao(novo.id, codigo.toLowerCase(), "BOT");
    const novoDb = await db.cliente.findUniqueOrThrow({ where: { id: novo.id }, include: { beneficios: true } });
    ok(novoDb.origem === "INDICACAO" && novoDb.beneficios[0]?.valorCentavos === 1000, "amigo marcado como indicação e ganha R$ 10 de boas-vindas");
    const eDupla = await falha(() => registrarIndicacao(novo.id, codigo, "SITE"));
    ok(eDupla instanceof ErroNegocio, "ninguém é indicado duas vezes");

    ok((await processarIndicacoes({ clienteIds: ids })) === 0, "antes do amigo cortar: sem prêmio");
    await visita(novo.id, Date.now() - 2 * D, 80);
    ok((await processarIndicacoes({ clienteIds: ids })) === 1, "amigo cortou: quem indicou ganha e é avisado");
    ok((await processarIndicacoes({ clienteIds: ids })) === 0, "prêmio sai uma vez só");
    const premio = await db.beneficio.findFirstOrThrow({ where: { clienteId: ind.id } });
    ok(premio.valorCentavos === 2000 && premio.status === "DISPONIVEL", "R$ 20 guardado para a próxima visita");

    // Saldo na comanda: usa, nao repete, devolve no cancelamento, divide o credito e gera cashback
    const produtos = await db.produto.findMany({ where: { ativo: true, categoria: { in: ["BAR", "LOJA"] }, precoCentavos: { gt: 0 } }, orderBy: { precoCentavos: "asc" } });
    if (produtos.length) {
      const caro = produtos.at(-1)!, barato = produtos[0];
      const { id } = await abrirComanda(s, { clienteId: ind.id });
      await adicionarProduto(s, id, caro.id, 3);
      const antes = await detalheComanda(id);
      ok(antes.saldoCliente === 2000, "comanda mostra o saldo do cliente (R$ 20)");
      await usarSaldo(s, id);
      const depois = await detalheComanda(id);
      ok(depois.resumo.desconto === Math.min(2000, antes.resumo.subtotal) && depois.saldoCliente === Math.max(0, 2000 - antes.resumo.subtotal), `saldo virou desconto (${depois.resumo.desconto})`);
      const eDenovo = await falha(() => usarSaldo(s, id));
      ok(eDenovo instanceof ErroNegocio, "sem saldo, não usa de novo");
      await cancelarComanda(s, id, "teste");
      ok((await saldoDoCliente(ind.id)) === 2000, "comanda cancelada devolve o saldo");

      // Credito maior que a conta: usa so a parte e o resto continua no saldo
      if (barato.precoCentavos < 2000) {
        const c2 = await abrirComanda(s, { clienteId: ind.id });
        await adicionarProduto(s, c2.id, barato.id, 1);
        await usarSaldo(s, c2.id);
        ok((await saldoDoCliente(ind.id)) === 2000 - barato.precoCentavos, `usa só o necessário e sobra ${2000 - barato.precoCentavos} centavos`);
        await cancelarComanda(s, c2.id, "teste");
      }

      // Cashback de 10% ao fechar; some se a comanda for cancelada
      await db.configuracao.update({ where: { id: 1 }, data: { cashbackAtivo: true, cashbackPct: 10, cashbackValidadeDias: 90 } });
      const c3 = await abrirComanda(s, { clienteId: novo.id });
      await adicionarProduto(s, c3.id, barato.id, 2);
      const total = (await detalheComanda(c3.id)).resumo.total;
      await registrarPagamento(s, c3.id, { forma: "DINHEIRO", valorCentavos: total, naMaquininha: false });
      const fechou = await fecharComanda(s, c3.id);
      const cb = await db.beneficio.findFirst({ where: { comandaOrigemId: c3.id, motivo: "CASHBACK" } });
      ok(fechou.cashbackCentavos === Math.floor(total / 10) && cb?.valorCentavos === fechou.cashbackCentavos && !!cb?.expiraEm, `cashback de 10% (${fechou.cashbackCentavos} centavos, com validade)`);
      const extrato = await extratoDoCliente(novo.id);
      ok(extrato.some((e) => e.origem === "Cashback" && e.geradoNaComanda !== null), "cashback aparece no extrato do cliente");
      await cancelarComanda(s, c3.id, "teste");
      ok((await db.beneficio.findUniqueOrThrow({ where: { id: cb!.id } })).status === "CANCELADO", "comanda cancelada cancela o cashback");
      const indicados = await indicadosDoCliente(ind.id);
      ok(indicados.length === 1 && indicados[0].veio && indicados[0].ganhouCentavos === 2000, "tela de indicações mostra o amigo e o prêmio");
    } else {
      console.log("(pulado) sem produto cadastrado para testar a comanda");
    }
  } finally {
    const { id: _id, ...dados } = original;
    void _id;
    await db.configuracao.update({ where: { id: 1 }, data: dados });
    await limpar();
    await db.$disconnect();
  }
}
main().catch(async (e) => { console.error(e); process.exit(1); });
