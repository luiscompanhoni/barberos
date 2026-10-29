/**
 * Direitos do titular (LGPD art. 18) na area do cliente: aceitar os termos, mensagens de divulgacao, copia dos
 * dados e exclusao da conta. Na exclusao os dados pessoais sao apagados; atendimentos, comandas e pagamentos ficam
 * no historico da barbearia sem identificar a pessoa (obrigacao fiscal e contabil).
 */
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { impedimentosExclusao, NOME_EXCLUIDO, telefoneExcluido } from "./regras";
import { VERSAO_TERMOS } from "./textos";

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
    await tx.cliente.update({ where: { id: clienteId }, data: { aceitaMensagens: aceita } });
    await auditar(tx, usuarioId, "lgpd_mensagens", "cliente", clienteId, { aceitaMensagens: aceita });
  });
}

async function impedimentosDo(clienteId: string) {
  const agora = new Date();
  const [assinaturasAbertas, cobrancasEmAberto, antecipados, links, comandasAbertas, horariosFuturos] = await Promise.all([
    db.assinatura.count({ where: { clienteId, status: { in: ["PENDENTE", "ATIVA", "ATRASADA"] } } }),
    db.cobranca.count({ where: { assinatura: { clienteId }, status: { in: ["PENDENTE", "ATRASADA"] } } }),
    db.pagamentoAntecipado.count({ where: { clienteId, status: "PENDENTE" } }),
    db.linkPagamento.count({ where: { clienteId, status: "PENDENTE" } }),
    db.comanda.count({ where: { clienteId, status: "ABERTA" } }),
    db.agendamento.count({ where: { clienteId, inicio: { gt: agora }, status: { in: ["MARCADO", "CONFIRMADO"] } } }),
  ]);
  return impedimentosExclusao({ assinaturasAbertas, cobrancasEmAberto, pagamentosPendentes: antecipados + links, comandasAbertas, horariosFuturos });
}

/** Copia dos dados do cliente (portabilidade/acesso), em JSON. */
export async function exportarDados(clienteId: string) {
  const c = await db.cliente.findUnique({
    where: { id: clienteId },
    select: {
      nome: true, telefone: true, email: true, cpf: true, dataNascimento: true, observacoes: true, origem: true, origemDetalhe: true,
      aceitaMensagens: true, criadoEm: true, termosVersao: true, termosAceitosEm: true,
      agendamentos: { orderBy: { inicio: "desc" }, select: { inicio: true, status: true, precoCentavos: true, observacao: true, servico: { select: { nome: true } }, barbeiro: { select: { nome: true } } } },
      comandas: { orderBy: { abertaEm: "desc" }, select: { numero: true, status: true, abertaEm: true, fechadaEm: true, itens: { select: { descricao: true, quantidade: true, precoUnitCentavos: true } }, pagamentos: { select: { forma: true, valorCentavos: true, status: true, pagoEm: true } } } },
      assinaturas: { select: { status: true, criadaEm: true, plano: { select: { nome: true } }, cobrancas: { select: { valorCentavos: true, status: true, vencimento: true, pagaEm: true } } } },
      beneficios: { select: { descricao: true, valorCentavos: true, status: true, motivo: true } },
      premiosGanhos: { select: { codigo: true, rotulo: true, status: true } },
      conversa: { select: { mensagens: { orderBy: { criadoEm: "asc" }, select: { autor: true, texto: true, criadoEm: true } } } },
    },
  });
  if (!c) throw naoEncontrado("Cliente");
  return { geradoEm: new Date().toISOString(), observacao: "Valores em centavos de real. Datas em UTC.", dados: c };
}

/** O proprio cliente exclui a conta: apaga os dados pessoais e deixa o historico anonimo. */
export async function excluirConta(clienteId: string, usuarioId: string) {
  const impedimentos = await impedimentosDo(clienteId);
  if (impedimentos.length) throw new ErroNegocio(impedimentos.join(" "), 409, "exclusao_bloqueada");
  const c = await db.cliente.findUnique({ where: { id: clienteId }, select: { telefone: true, usuarioId: true, excluidoEm: true } });
  if (!c) throw naoEncontrado("Cliente");
  if (c.excluidoEm) return;
  await db.$transaction(async (tx) => {
    await tx.conversa.deleteMany({ where: { OR: [{ clienteId }, { telefone: c.telefone }] } });
    await tx.codigoLogin.deleteMany({ where: { telefone: c.telefone } });
    await tx.esperaHorario.deleteMany({ where: { clienteId } });
    await tx.listaEsperaPlano.deleteMany({ where: { clienteId } });
    await tx.agendamento.updateMany({ where: { clienteId }, data: { observacao: null } });
    await tx.comanda.updateMany({ where: { clienteId }, data: { observacao: null } });
    await tx.linkPagamento.updateMany({ where: { clienteId }, data: { nome: NOME_EXCLUIDO, telefone: "", cpf: null, email: null } });
    await tx.cliente.update({
      where: { id: clienteId },
      data: {
        nome: NOME_EXCLUIDO, telefone: telefoneExcluido(clienteId), observacoes: null, cpf: null, email: null, dataNascimento: null,
        origemDetalhe: null, codigoIndicacao: null, aceitaMensagens: false, usuarioId: null, excluidoEm: new Date(),
      },
    });
    if (c.usuarioId) {
      await tx.usuario.update({ where: { id: c.usuarioId }, data: { nome: NOME_EXCLUIDO, telefone: telefoneExcluido(c.usuarioId), login: null, senhaHash: null, ativo: false } });
    }
    // Auditoria sem dado pessoal: so que a conta foi excluida pelo titular.
    await auditar(tx, usuarioId, "lgpd_exclusao", "cliente", clienteId, { pelo: "titular" });
  });
}
