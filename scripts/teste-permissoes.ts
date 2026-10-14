// Teste de integracao do papel Gerente e da matriz de permissoes por acao, contra o banco de DESENVOLVIMENTO.
// Cria e apaga os proprios dados e restaura a matriz no fim. Rodar: npm run teste:permissoes
import type { Papel } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { exigirPermissao, matrizPermissoes, permissoesDe, salvarPermissoes, telefonesCom } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/sessao";
import { cancelarComanda, definirDesconto } from "@/lib/comandas/servico";
import { db } from "@/lib/db";
import { decidirEstorno, listarEstornos } from "@/lib/estornos/servico";
import { criarDespesa, excluirDespesa } from "@/lib/financeiro/despesas";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string }; } };
const TAG = "[teste permissoes]";
const TEL_GERENTE = "5511977770001";

async function main() {
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  // As regras olham so o papel; o usuario e o dono para a auditoria ficar ligada a alguem que existe.
  const como = (papel: Papel): Sessao => ({ usuarioId: dono.id, papel, nome: `${TAG} ${papel}`, barbeiroId: null, clienteId: null });
  const [sDono, sGerente, sRecepcao, sBarbeiro] = (["DONO", "GERENTE", "RECEPCAO", "BARBEIRO"] as const).map(como);
  const hoje = dataLocal(Date.now(), (await configuracao()).fuso);
  const linhasAntes = await db.permissaoPapel.findMany();
  await db.permissaoPapel.deleteMany({});
  const comandas: string[] = [];
  try {
    // ================= PADRAO (sem nada salvo)
    const g = await permissoesDe("GERENTE");
    ok(g.desconto && g.caixa && g.resultado && !g.estorno && !g.folha && !g.excluir, "gerente: desconto, caixa e resultado; sem estorno, folha e exclusão");
    const r = await permissoesDe("RECEPCAO");
    ok(r.desconto && r.caixa && !r.resultado && !r.estorno, "recepção: igual a antes (desconto e caixa, sem resultado e sem estorno)");

    const aberta = await db.comanda.create({ data: { nomeAvulso: TAG, itens: { create: [{ descricao: "Corte", precoUnitCentavos: 5000 }] } } });
    comandas.push(aberta.id);
    await definirDesconto(sGerente, aberta.id, 500);
    ok((await db.comanda.findUniqueOrThrow({ where: { id: aberta.id } })).descontoCentavos === 500, "gerente dá desconto");
    ok((await falha(() => definirDesconto(sBarbeiro, aberta.id, 1000)))?.codigo === "proibido", "barbeiro não dá desconto (padrão)");

    const fechada = await db.comanda.create({ data: { nomeAvulso: TAG, status: "FECHADA", fechadaEm: new Date(), itens: { create: [{ descricao: "Corte", precoUnitCentavos: 5000 }] } } });
    comandas.push(fechada.id);
    ok((await falha(() => cancelarComanda(sGerente, fechada.id, "teste")))?.codigo === "proibido", "gerente não cancela comanda fechada (padrão)");

    const d = await criarDespesa(sRecepcao, { descricao: `${TAG} Luz`, categoria: "ENERGIA", valorCentavos: 1000, vencimento: hoje, recorrente: false });
    ok((await falha(() => excluirDespesa(sRecepcao, d.id)))?.codigo === "proibido", "recepção não exclui conta a pagar (padrão)");
    await excluirDespesa(sDono, d.id);
    ok(!(await db.despesa.findUnique({ where: { id: d.id } })), "dono exclui");

    ok((await falha(() => decidirEstorno(sGerente, "nao-existe", { acao: "aprovar" })))?.codigo === "proibido", "gerente não aprova estorno (padrão)");
    ok((await listarEstornos(sGerente)).dono === false, "tela de estornos do gerente: só pedir");
    ok((await falha(() => exigirPermissao(sRecepcao, "folha", "comissao")))?.message.includes("folha e salários ou alterar comissões") === true, "mensagem diz o que falta");

    // ================= DONO LIGA PARA O GERENTE
    await db.usuario.create({ data: { telefone: TEL_GERENTE, nome: `${TAG} Gerente`, papel: "GERENTE" } });
    ok(!(await telefonesCom("estorno")).includes(TEL_GERENTE), "aviso de estorno não vai para o gerente sem a permissão");
    const desde = new Date();
    await salvarPermissoes(sDono, { GERENTE: { estorno: true, excluir: true }, RECEPCAO: {}, BARBEIRO: { desconto: true } });
    ok((await telefonesCom("estorno")).includes(TEL_GERENTE), "com a permissão, o gerente recebe o aviso de estorno");
    ok((await falha(() => decidirEstorno(sGerente, "nao-existe", { acao: "aprovar" })))?.codigo === "nao_encontrado", "gerente com permissão passa da checagem de estorno");
    ok((await listarEstornos(sGerente)).dono === true, "tela de estornos do gerente: aprova");
    await cancelarComanda(sGerente, fechada.id, "teste");
    ok((await db.comanda.findUniqueOrThrow({ where: { id: fechada.id } })).status === "CANCELADA", "gerente com permissão cancela comanda fechada");
    await definirDesconto(sBarbeiro, aberta.id, 1000);
    ok((await db.comanda.findUniqueOrThrow({ where: { id: aberta.id } })).descontoCentavos === 1000, "barbeiro com permissão dá desconto");

    const log = await db.auditoria.findFirst({ where: { acao: "permissoes", criadoEm: { gte: desde } }, orderBy: { criadoEm: "desc" } });
    const dados = log?.dados as { antes?: Record<string, boolean>; depois?: Record<string, boolean> } | null;
    ok(dados?.antes?.["GERENTE.estorno"] === false && dados?.depois?.["GERENTE.estorno"] === true && dados?.depois?.["BARBEIRO.desconto"] === true, "auditoria guarda antes → depois da matriz");

    // ================= VOLTAR AO PADRAO APAGA AS LINHAS
    ok((await db.permissaoPapel.count()) === 3, "só o que difere do padrão fica gravado (3 linhas)");
    await salvarPermissoes(sDono, { GERENTE: { estorno: false, excluir: false }, RECEPCAO: {}, BARBEIRO: { desconto: false, caixa: true } });
    ok((await db.permissaoPapel.count()) === 0, "voltar ao padrão apaga as linhas (e ação que não se aplica é ignorada)");
    const m = await matrizPermissoes();
    ok(m.find((x) => x.chave === "caixa")?.papeis.BARBEIRO === null && m.find((x) => x.chave === "desconto")?.papeis.BARBEIRO?.permitido === false, "matriz da tela: barbeiro sem caixa (não se aplica)");
  } finally {
    await db.permissaoPapel.deleteMany({});
    if (linhasAntes.length) await db.permissaoPapel.createMany({ data: linhasAntes.map(({ papel, permissao, permitido }) => ({ papel, permissao, permitido })) });
    await db.usuario.deleteMany({ where: { telefone: TEL_GERENTE } });
    await db.despesa.deleteMany({ where: { descricao: { startsWith: TAG } } });
    await db.itemComanda.deleteMany({ where: { comandaId: { in: comandas } } });
    await db.comanda.deleteMany({ where: { id: { in: comandas } } });
  }
  console.log(process.exitCode ? "\nAlgum teste FALHOU." : "\nTodos os testes passaram.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
