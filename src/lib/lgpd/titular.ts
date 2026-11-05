/**
 * Direitos do titular (LGPD art. 18) na area do cliente: aceitar os termos, mensagens de divulgacao, copia dos
 * dados e exclusao da conta. Na exclusao os dados pessoais sao apagados; atendimentos, comandas e pagamentos ficam
 * no historico da barbearia sem identificar a pessoa (obrigacao fiscal e contabil).
 */
import { auditar } from "@/lib/auditoria";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { impedimentosExclusao, NOME_EXCLUIDO, telefoneExcluido } from "./regras";
import { VERSAO_TERMOS } from "./textos";
import { atualizarPreferencia, travarMudancaTelefone, travarPreferencia } from "@/lib/whatsapp/preferencia";

export async function situacaoPrivacidade(clienteId: string) {
  const c = await db.cliente.findUnique({ where: { id: clienteId }, select: { termosVersao: true, termosAceitosEm: true, aceitaMensagens: true } });
  if (!c) throw naoEncontrado("Cliente");
  return { ...c, versaoAtual: VERSAO_TERMOS, precisaAceitar: c.termosVersao !== VERSAO_TERMOS, impedimentos: await impedimentosDo(clienteId) };
}

export async function aceitarTermos(clienteId: string, usuarioId: string) {
  await db.$transaction(async (tx) => {
    await tx.cliente.update({ where: { id: clienteId }, data: { termosVersao: VERSAO_TERMOS, termosAceitosEm: new Date() } });
    await auditar(tx, usuarioId, "lgpd_aceite", "cliente", clienteId, { versao: VERSAO_TERMOS });
  });
}

export async function mudarMensagens(clienteId: string, usuarioId: string, aceita: boolean) {
  await db.$transaction(async (tx) => {
    const cliente = await tx.cliente.findUnique({ where: { id: clienteId }, select: { telefone: true } });
    if (!cliente) throw naoEncontrado("Cliente");
    await travarPreferencia(tx, cliente.telefone);
    const atual = await tx.cliente.findUnique({ where: { id: clienteId }, select: { telefone: true } });
    if (!atual || atual.telefone !== cliente.telefone) throw new ErroNegocio("O telefone mudou. Atualize a página antes de alterar a preferência.", 409);
    await atualizarPreferencia(tx, cliente.telefone, aceita);
    await auditar(tx, usuarioId, "lgpd_mensagens", "cliente", clienteId, { aceitaMensagens: aceita });
  });
}

async function impedimentosDo(clienteId: string, c: typeof db | Prisma.TransactionClient = db) {
  const agora = new Date();
  const [assinaturasAbertas, cobrancasEmAberto, antecipados, links, comandasAbertas, horariosFuturos] = await Promise.all([
    c.assinatura.count({ where: { clienteId, status: { in: ["PENDENTE", "ATIVA", "ATRASADA"] } } }),
    c.cobranca.count({ where: { assinatura: { clienteId }, status: { in: ["PENDENTE", "ATRASADA"] } } }),
    c.pagamentoAntecipado.count({ where: { clienteId, status: "PENDENTE" } }),
    c.linkPagamento.count({ where: { clienteId, status: "PENDENTE" } }),
    c.comanda.count({ where: { clienteId, status: "ABERTA" } }),
    c.agendamento.count({ where: { clienteId, inicio: { gt: agora }, status: { in: ["MARCADO", "CONFIRMADO"] } } }),
  ]);
  return impedimentosExclusao({ assinaturasAbertas, cobrancasEmAberto, pagamentosPendentes: antecipados + links, comandasAbertas, horariosFuturos });
}

/** Copia dos dados do cliente (portabilidade/acesso), em JSON. */
export async function exportarDados(clienteId: string) {
  const c = await db.cliente.findUnique({
    where: { id: clienteId },
    select: {
      nome: true, telefone: true, email: true, cpf: true, endereco: true, dataNascimento: true, observacoes: true, origem: true, origemDetalhe: true,
      fotoDados: true, fotoTipo: true, perfilCompletoEm: true,
      usuario: { select: { identidadesSociais: { select: { provedor: true, subject: true, criadoEm: true } } } },
      aceitaMensagens: true, criadoEm: true, termosVersao: true, termosAceitosEm: true,
      pedidosAgendamento: { orderBy: { criadoEm: "desc" }, select: { dataPreferida: true, horaPreferida: true, servicoIds: true, observacao: true, status: true, criadoEm: true, decididoEm: true } },
      agendamentos: { orderBy: { inicio: "desc" }, select: { inicio: true, status: true, precoCentavos: true, observacao: true, servico: { select: { nome: true } }, barbeiro: { select: { nome: true } } } },
      comandas: { orderBy: { abertaEm: "desc" }, select: { numero: true, status: true, abertaEm: true, fechadaEm: true, itens: { select: { descricao: true, quantidade: true, precoUnitCentavos: true } }, pagamentos: { select: { forma: true, valorCentavos: true, status: true, pagoEm: true } } } },
      assinaturas: { select: { status: true, criadaEm: true, plano: { select: { nome: true } }, cobrancas: { select: { valorCentavos: true, status: true, vencimento: true, pagaEm: true } } } },
      beneficios: { select: { descricao: true, valorCentavos: true, status: true, motivo: true } },
      premiosGanhos: { select: { codigo: true, rotulo: true, status: true } },
      elegibilidadesMensais: { select: { competencia: true, pulouEm: true, criadoEm: true } },
      conversa: { select: { mensagens: { orderBy: { criadoEm: "asc" }, select: { autor: true, texto: true, criadoEm: true } } } },
    },
  });
  if (!c) throw naoEncontrado("Cliente");
  const { fotoDados, fotoTipo, ...dados } = c;
  return { geradoEm: new Date().toISOString(), observacao: "Valores em centavos de real. Datas em UTC.",
    dados: { ...dados, foto: fotoDados && fotoTipo ? `data:${fotoTipo};base64,${Buffer.from(fotoDados).toString("base64")}` : null } };
}

/** O proprio cliente exclui a conta: apaga os dados pessoais e deixa o historico anonimo. */
export async function excluirConta(clienteId: string, usuarioId: string, sessaoVersao = 0) {
  const impedimentos = await impedimentosDo(clienteId);
  if (impedimentos.length) throw new ErroNegocio(impedimentos.join(" "), 409, "exclusao_bloqueada");
  const c = await db.cliente.findUnique({ where: { id: clienteId }, select: { telefone: true, usuarioId: true, excluidoEm: true } });
  if (!c) throw naoEncontrado("Cliente");
  if (c.excluidoEm) return;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${usuarioId}`}))`;
    // Pedido/reserva e exclusão revalidam o titular antes de gravar dados deste cliente.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-ciclo-telefone:${c.telefone}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-ciclo:${clienteId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`avaliacao-mensal:${clienteId}`}))`;
    await travarMudancaTelefone(tx, c.telefone, telefoneExcluido(clienteId));
    await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${clienteId} FOR UPDATE`;
    const atual = await tx.cliente.findUnique({ where: { id: clienteId } });
    const usuario = await tx.usuario.findUnique({ where: { id: usuarioId } });
    if (atual?.excluidoEm) return;
    if (!usuario || (usuario.sessaoVersao ?? 0) !== sessaoVersao) {
      throw new ErroNegocio("Sua sessão mudou. Entre novamente antes de excluir.", 401, "sessao_invalida");
    }
    if (!atual || atual.usuarioId !== usuarioId || atual.telefone !== c.telefone || !usuario?.ativo || usuario.papel !== "CLIENTE") {
      throw new ErroNegocio("Sua conta mudou. Entre novamente antes de excluir.", 409);
    }
    const impedimentosAtuais = await impedimentosDo(clienteId, tx);
    if (impedimentosAtuais.length) throw new ErroNegocio(impedimentosAtuais.join(" "), 409, "exclusao_bloqueada");
    await tx.conversa.deleteMany({ where: { OR: [{ clienteId }, { telefone: c.telefone }] } });
    await tx.codigoLogin.deleteMany({ where: { telefone: c.telefone } });
    await tx.esperaHorario.deleteMany({ where: { clienteId } });
    await tx.listaEsperaPlano.deleteMany({ where: { clienteId } });
    await tx.avaliacaoMensalElegibilidade.deleteMany({ where: { clienteId } });
    await tx.agendamento.updateMany({ where: { clienteId }, data: { observacao: null } });
    await tx.pedidoAgendamento.updateMany({ where: { clienteId }, data: { observacao: null } });
    await tx.pedidoAgendamento.updateMany({ where: { clienteId, status: "PENDENTE" }, data: { status: "CANCELADO", decididoPorId: usuarioId, decididoEm: new Date() } });
    await tx.comanda.updateMany({ where: { clienteId }, data: { observacao: null } });
    await tx.linkPagamento.updateMany({ where: { clienteId }, data: { nome: NOME_EXCLUIDO, telefone: "", cpf: null, email: null } });
    await tx.cliente.update({
      where: { id: clienteId },
      data: {
        nome: NOME_EXCLUIDO, telefone: telefoneExcluido(clienteId), observacoes: null, cpf: null, email: null, dataNascimento: null,
        endereco: null, fotoDados: null, fotoTipo: null, fotoVersao: 0, perfilCompletoEm: null,
        origemDetalhe: null, codigoIndicacao: null, aceitaMensagens: false, usuarioId: null, excluidoEm: new Date(),
      },
    });
    await tx.identidadeSocial.deleteMany({ where: { usuarioId } });
    await tx.fluxoSocial.deleteMany({ where: { usuarioId } });
    await tx.usuario.update({ where: { id: usuarioId }, data: { nome: NOME_EXCLUIDO, telefone: telefoneExcluido(usuarioId), login: null, senhaHash: null, ativo: false, sessaoVersao: { increment: 1 } } });
    // Auditoria sem dado pessoal: so que a conta foi excluida pelo titular.
    await auditar(tx, usuarioId, "lgpd_exclusao", "cliente", clienteId, { pelo: "titular" });
  });
}
