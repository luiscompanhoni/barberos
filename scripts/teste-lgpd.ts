// Teste de integracao da LGPD (aceite, copia dos dados, exclusao pelo cliente e retencao de candidaturas), contra o
// banco de DESENVOLVIMENTO. Cria e apaga os proprios dados. Rodar: npm run teste:lgpd
import { db } from "@/lib/db";
import { VERSAO_TERMOS } from "@/lib/lgpd/textos";
import { aceitarTermos, excluirConta, exportarDados, situacaoPrivacidade } from "@/lib/lgpd/titular";
import { apagarCandidaturasVencidas } from "@/lib/recrutamento/servico";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const falha = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as Error & { codigo?: string }; } };
const TAG = "[teste lgpd]";
const TEL = "5511977771234";

async function limpar() {
  const c = await db.cliente.findMany({ where: { OR: [{ telefone: TEL }, { nome: TAG }, { observacoes: TAG }] }, select: { id: true, usuarioId: true } });
  for (const x of c) {
    await db.conversa.deleteMany({ where: { clienteId: x.id } });
    await db.agendamento.deleteMany({ where: { clienteId: x.id } });
    await db.cliente.delete({ where: { id: x.id } });
  }
  await db.usuario.deleteMany({ where: { OR: [{ telefone: TEL }, { nome: TAG }] } });
  await db.conversa.deleteMany({ where: { telefone: TEL } });
  await db.candidatoRecrutamento.deleteMany({ where: { nome: TAG } });
  await db.vagaRecrutamento.deleteMany({ where: { titulo: TAG } });
}

async function main() {
  await limpar();
  const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
  const u = await db.usuario.create({ data: { telefone: TEL, nome: TAG, papel: "CLIENTE", senhaHash: "x" } });
  const c = await db.cliente.create({ data: { telefone: TEL, nome: TAG, usuarioId: u.id, cpf: "00000000000", email: "teste@example.com", observacoes: TAG } });
  const ids = [c.id];
  try {
    // ================= aceite
    ok((await situacaoPrivacidade(c.id)).precisaAceitar, "cliente sem aceite precisa aceitar a versão atual");
    await aceitarTermos(c.id, u.id);
    const s = await situacaoPrivacidade(c.id);
    ok(!s.precisaAceitar && s.termosVersao === VERSAO_TERMOS, "aceite grava a versão e a data");

    // ================= copia dos dados
    const conversa = await db.conversa.create({ data: { telefone: TEL, clienteId: c.id, mensagens: { create: [{ autor: "CLIENTE", texto: `${TAG} oi` }] } } });
    const d = await exportarDados(c.id);
    ok(d.dados.telefone === TEL && d.dados.conversa?.mensagens.length === 1, "cópia traz cadastro e conversas");

    // ================= exclusao bloqueada com horario marcado
    const servico = await db.servico.findFirstOrThrow();
    const barbeiro = await db.barbeiro.findFirstOrThrow();
    const inicio = new Date(Date.now() + 3 * 86_400_000);
    const ag = await db.agendamento.create({ data: { clienteId: c.id, servicoId: servico.id, barbeiroId: barbeiro.id, inicio, fim: new Date(+inicio + 30 * 60_000), origem: "PAINEL", precoCentavos: 5000, observacao: `${TAG} detalhe` } });
    ok((await falha(() => excluirConta(c.id, u.id)))?.codigo === "exclusao_bloqueada", "horário marcado impede a exclusão");
    await db.agendamento.update({ where: { id: ag.id }, data: { status: "CONCLUIDO", inicio: new Date(Date.now() - 86_400_000), fim: new Date(Date.now() - 86_400_000 + 30 * 60_000) } });

    // ================= exclusao
    await excluirConta(c.id, u.id);
    const depois = await db.cliente.findUniqueOrThrow({ where: { id: c.id } });
    ok(depois.nome === "Cliente excluído" && depois.telefone === `excluido-${c.id}` && !depois.cpf && !depois.email && !depois.observacoes && !!depois.excluidoEm, "dados pessoais do cliente apagados");
    ok(!depois.aceitaMensagens && !depois.usuarioId, "sem mensagens e sem login ligado");
    const usuario = await db.usuario.findUniqueOrThrow({ where: { id: u.id } });
    ok(!usuario.ativo && !usuario.senhaHash && usuario.telefone !== TEL, "login desativado e sem o celular");
    ok(!(await db.conversa.findUnique({ where: { id: conversa.id } })), "conversas apagadas");
    const agDepois = await db.agendamento.findUniqueOrThrow({ where: { id: ag.id } });
    ok(agDepois.clienteId === c.id && agDepois.observacao === null && agDepois.precoCentavos === 5000, "atendimento fica no histórico, sem a observação");
    const audit = await db.auditoria.findFirst({ where: { acao: "lgpd_exclusao", entidadeId: c.id } });
    ok(!!audit && !JSON.stringify(audit.dados).includes(TEL), "auditoria da exclusão sem dado pessoal");
    await excluirConta(c.id, u.id);
    ok(true, "excluir de novo não quebra");

    // ================= retencao de candidaturas
    const vaga = await db.vagaRecrutamento.create({ data: { titulo: TAG, cidade: "X", descricao: "X", privacidade: "X", criadoPorId: dono.id } });
    const antiga = new Date(Date.now() - 400 * 86_400_000);
    const nova = (futuras: boolean, criadoEm: Date) => db.candidaturaRecrutamento.create({ data: {
      envioId: crypto.randomUUID(), conteudoHash: "x", vaga: { connect: { id: vaga.id } }, candidato: { create: { nome: TAG, telefone: TEL, cidade: "X" } },
      experienciaMeses: 1, servicos: [], disponibilidade: "X", portfolio: "", instagram: "", futurasOportunidades: futuras, formularioVersao: "t", avisoPrivacidade: "X", origem: {}, criadoEm,
    } });
    const vencida = await nova(false, antiga), banco = await nova(true, antiga), recente = await nova(false, new Date());
    await apagarCandidaturasVencidas();
    const resta = async (id: string) => !!(await db.candidaturaRecrutamento.findUnique({ where: { id } }));
    ok(!(await resta(vencida.id)) && !(await db.candidatoRecrutamento.findUnique({ where: { id: vencida.candidatoId } })), "candidatura de mais de 12 meses sem autorização é apagada com o candidato");
    ok((await resta(banco.id)) && (await resta(recente.id)), "banco de talentos autorizado e candidatura recente ficam");
  } finally {
    for (const id of ids) {
      await db.conversa.deleteMany({ where: { clienteId: id } });
      await db.agendamento.deleteMany({ where: { clienteId: id } });
      await db.cliente.deleteMany({ where: { id } });
    }
    await db.usuario.deleteMany({ where: { id: u.id } });
    await limpar();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
