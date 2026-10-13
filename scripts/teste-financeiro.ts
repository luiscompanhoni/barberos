// Teste de integracao do financeiro (caixa + conciliacao) e do checklist, contra o banco de
// DESENVOLVIMENTO. Cria e apaga os proprios dados. Rodar: npm run teste:financeiro
process.env.WHATSAPP_PROVIDER = "simulador";

import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import type { Sessao } from "@/lib/auth/sessao";
import { enviarLista, enviarResumo, listaPublica, marcarPublico, painelDoDia, rodarChecklist, salvarCadastro } from "@/lib/checklist/servico";
import { db } from "@/lib/db";
import { abrirCaixa, caixaAberto, fecharCaixa, movimentarCaixa, resumoCaixa } from "@/lib/financeiro/caixa";
import { conciliacao, conferir, desfazerConferencia } from "@/lib/financeiro/conciliacao";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string }; } };
const TELS = ["5511933337101", "5511933337102", "5511933337103"];

async function main() {
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const s: Sessao = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, barbeiroId: null, clienteId: null };
  const hoje = dataLocal(Date.now(), (await configuracao()).fuso);
  // Nao mexe em caixa de verdade aberto no banco de desenvolvimento.
  const jaAberto = await caixaAberto();
  if (jaAberto) await db.caixa.update({ where: { id: jaAberto.id }, data: { status: "FECHADO", fechadoEm: new Date(), observacao: "fechado pelo teste" } });
  const comandas: string[] = [];
  const caixas: string[] = [];
  const cfgAntes = await db.checklistConfig.findUnique({ where: { id: 1 } });
  const pessoasAntes = (await db.checklistPessoa.findMany()).map((p) => p.id);
  const tarefasAntes = await db.checklistTarefa.findMany();
  try {
    // ================= CAIXA
    ok((await falha(() => movimentarCaixa(s, "SANGRIA", 100, "x")))?.codigo === "fechado", "sem caixa aberto não registra sangria");
    const c = await abrirCaixa(s, 15000);
    caixas.push(c.id);
    ok((await falha(() => abrirCaixa(s, 0)))?.codigo === "ja_aberto", "não abre dois caixas");
    // Comanda paga em dinheiro com troco (R$ 50 de R$ 43,21) + uma no Pix + uma no credito
    const nova = async (itens: number, pags: { forma: "DINHEIRO" | "PIX" | "CREDITO"; v: number }[]) => {
      const cm = await db.comanda.create({ data: { nomeAvulso: "[teste financeiro]", status: "FECHADA", fechadaEm: new Date(), itens: { create: [{ descricao: "Corte", precoUnitCentavos: itens }] }, pagamentos: { create: pags.map((p) => ({ forma: p.forma, valorCentavos: p.v, status: "PAGO" as const, pagoEm: new Date() })) } } });
      comandas.push(cm.id);
    };
    await nova(4321, [{ forma: "DINHEIRO", v: 5000 }]);
    await nova(6500, [{ forma: "PIX", v: 6500 }]);
    await nova(11800, [{ forma: "CREDITO", v: 11800 }]);
    await movimentarCaixa(s, "SUPRIMENTO", 2000, "reforço de troco");
    await movimentarCaixa(s, "SANGRIA", 5000, "depósito");
    ok((await falha(() => movimentarCaixa(s, "SANGRIA", 999_999, "tudo"))) !== null, "sangria maior que o dinheiro do caixa é recusada");
    const r = await resumoCaixa((await caixaAberto())!);
    // 150 + 50 - 6,79 troco + 20 - 50 = 163,21
    ok(r.esperado === 16321, `esperado em dinheiro = fundo + recebido - troco + suprimento - sangria (${r.esperado})`);
    ok(r.totais.PIX === 6500 && r.totais.CREDITO === 11800 && r.comandasFechadas === 3 && r.faturado === 22621, "resumo por forma e faturado do turno");
    ok((await falha(() => fecharCaixa(s, 16000)))?.codigo === "explicar_diferenca", "diferença sem explicação não fecha");
    const f = await fecharCaixa(s, 16000, "faltou troco de 3,21");
    ok(f.diferenca === -321, "fecha registrando a diferença (faltou R$ 3,21)");
    ok(!(await caixaAberto()), "caixa fica fechado");

    // ================= CONCILIACAO
    const con = await conciliacao(hoje, hoje);
    const pix = con.linhas.find((l) => l.forma === "PIX")!;
    const cred = con.linhas.find((l) => l.forma === "CREDITO")!;
    ok(!!pix && pix.brutoCentavos >= 6500 && pix.status === "PENDENTE", "Pix do dia aparece para conferir");
    ok(!!cred && cred.liquidoCentavos === cred.brutoCentavos - Math.round((cred.brutoCentavos * con.taxas.find((t) => t.forma === "CREDITO")!.taxaBps) / 10000), "crédito: líquido = bruto - taxa");
    ok(!con.linhas.some((l) => (l.forma as string) === "DINHEIRO"), "dinheiro fica fora da conciliação (vai no caixa)");
    ok((await conferir(s, { data: hoje, forma: "PIX", recebidoCentavos: pix.liquidoCentavos })).status === "CONFERIDO", "valor igual ao esperado = conferido");
    ok((await falha(() => conferir(s, { data: hoje, forma: "CREDITO", recebidoCentavos: 100 })))?.codigo === "explicar_diferenca", "valor diferente exige motivo");
    ok((await conferir(s, { data: hoje, forma: "CREDITO", recebidoCentavos: 100, observacao: "teste" })).status === "DIVERGENTE", "com motivo fica marcado como divergente");
    await desfazerConferencia(s, hoje, "PIX");
    await desfazerConferencia(s, hoje, "CREDITO");
    ok((await conciliacao(hoje, hoje)).linhas.filter((l) => l.status !== "PENDENTE").length === 0, "desfazer volta para a conferir");

    // ================= CHECKLIST
    await salvarCadastro(s, {
      config: { ativo: true, horaEnvio: "00:00", horaResumo: "23:59" },
      pessoas: [
        { nome: "[teste] Diarista", telefone: TELS[0], funcao: "DIARISTA", ativo: true },
        { nome: "[teste] Barbeiro", telefone: TELS[1], funcao: "BARBEIRO", ativo: true },
        { nome: "[teste] Gerente", telefone: TELS[2], funcao: "GERENTE", ativo: true },
      ],
      tarefas: [
        { titulo: "Varrer", funcao: "DIARISTA", diasSemana: [], horario: "08:00", ativo: true },
        { titulo: "Nunca hoje", funcao: "DIARISTA", diasSemana: [(new Date(`${hoje}T12:00:00Z`).getUTCDay() + 1) % 7], horario: null, ativo: true },
        { titulo: "Esterilizar máquinas", funcao: "BARBEIRO", diasSemana: [], horario: null, ativo: true },
        { titulo: "Fechar caixa", funcao: "GERENTE", diasSemana: [], horario: "20:00", ativo: true },
      ],
    });
    const dia = await painelDoDia(hoje);
    const diarista = dia.find((p) => p.nome === "[teste] Diarista")!;
    ok(diarista.itens.map((i) => i.titulo).join() === "Varrer", "diarista recebe só as tarefas da função e do dia da semana");
    ok(dia.filter((p) => p.nome.startsWith("[teste]")).every((p) => p.itens.length === 1), "cada função com a sua lista");
    const r1 = await rodarChecklist();
    ok(r1.listas === 3, `rotina manda a lista de cada pessoa (${r1.listas})`);
    ok((await rodarChecklist()).listas === 0, "não manda a lista duas vezes no mesmo dia");
    const conv = await db.conversa.findUnique({ where: { telefone: TELS[0] }, include: { mensagens: true } });
    ok(!!conv?.mensagens.some((m) => m.texto.includes("Varrer") && m.texto.includes("/t/")), "mensagem no WhatsApp tem a tarefa e o link");
    ok(conv?.estado === "HUMANO", "conversa da equipe não fica com o bot");
    const token = (await db.checklistPessoa.findFirstOrThrow({ where: { nome: "[teste] Diarista" } })).token;
    const pub = (await listaPublica(token))!;
    await marcarPublico(token, pub.itens[0].id, true);
    ok((await listaPublica(token))!.itens[0].feito, "marca a tarefa pelo link sem login");
    const outro = (await db.checklistPessoa.findFirstOrThrow({ where: { nome: "[teste] Barbeiro" } })).token;
    ok(!!(await falha(() => marcarPublico(outro, pub.itens[0].id, false))), "link de uma pessoa não mexe na tarefa de outra");
    ok((await listaPublica("token-que-nao-existe")) === null, "link inválido não abre");
    ok((await enviarLista(diarista.id, hoje, true)) === false, "lista sem pendências não é reenviada");
    const n = await enviarResumo(hoje, true);
    const resumo = await db.mensagem.findFirst({ where: { conversa: { telefone: TELS[2] }, texto: { contains: "Ficou pendente" } } });
    ok(n === 1 && !!resumo && resumo.texto.includes("Esterilizar") && !resumo.texto.includes("Varrer"), "resumo vai para o gerente só com o que ficou pendente");
  } finally {
    await db.pagamentoComanda.deleteMany({ where: { comandaId: { in: comandas } } });
    await db.itemComanda.deleteMany({ where: { comandaId: { in: comandas } } });
    await db.comanda.deleteMany({ where: { id: { in: comandas } } });
    await db.caixa.deleteMany({ where: { id: { in: caixas } } });
    if (jaAberto) await db.caixa.update({ where: { id: jaAberto.id }, data: { status: "ABERTO", fechadoEm: null, observacao: null } });
    await db.conciliacao.deleteMany({ where: { observacao: "teste" } });
    const conv = await db.conversa.findMany({ where: { telefone: { in: TELS } }, select: { id: true } });
    await db.mensagem.deleteMany({ where: { conversaId: { in: conv.map((c) => c.id) } } });
    await db.conversa.deleteMany({ where: { id: { in: conv.map((c) => c.id) } } });
    await db.checklistPessoa.deleteMany({ where: { id: { notIn: pessoasAntes } } });
    await db.checklistPessoa.updateMany({ where: { id: { in: pessoasAntes } }, data: { ativo: true } });
    await db.checklistItem.deleteMany({ where: { tarefa: { id: { notIn: tarefasAntes.map((t) => t.id) } } } });
    await db.checklistTarefa.deleteMany({ where: { id: { notIn: tarefasAntes.map((t) => t.id) } } });
    for (const t of tarefasAntes) await db.checklistTarefa.update({ where: { id: t.id }, data: t });
    await db.checklistEnvio.deleteMany({ where: { OR: TELS.map((t) => ({ chave: { contains: t } })) } });
    if (cfgAntes) await db.checklistConfig.update({ where: { id: 1 }, data: cfgAntes });
    else await db.checklistConfig.deleteMany({});
  }
  console.log(process.exitCode ? "\nAlgum teste FALHOU." : "\nTodos os testes passaram.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
