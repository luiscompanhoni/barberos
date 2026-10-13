/**
 * Indique e ganhe: cada cliente tem um codigo/link. Quem chega pelo link ganha um desconto de
 * boas-vindas; quem indicou ganha o premio quando o amigo faz o primeiro atendimento.
 * Os premios viram "beneficios" (credito de desconto) usados na comanda.
 */
import type { OrigemAgendamento } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { gerarCodigoIndicacao, normalizarCodigo, TEXTOS } from "./regras";
import { disponiveis } from "./saldo";

export const COOKIE_INDICACAO = "barberos_indicacao";

/** Codigo do cliente (cria na primeira vez, sem repetir). */
export async function codigoDoCliente(clienteId: string) {
  const c = await db.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, codigoIndicacao: true } });
  if (!c) throw naoEncontrado("Cliente");
  if (c.codigoIndicacao) return c.codigoIndicacao;
  for (let i = 0; i < 8; i++) {
    try {
      const r = await db.cliente.update({ where: { id: clienteId }, data: { codigoIndicacao: gerarCodigoIndicacao(c.nome) }, select: { codigoIndicacao: true } });
      return r.codigoIndicacao!;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  throw new Error("Não consegui gerar um código de indicação.");
}

/** Tudo que o cliente precisa para indicar: link, texto pronto, quantos vieram e o que ele ganhou. */
export async function painelDeIndicacao(clienteId: string) {
  const cfg = await configuracao();
  if (!cfg.indicacaoAtiva) return { ativa: false as const };
  const codigo = await codigoDoCliente(clienteId);
  const link = `${urlSite()}/i/${codigo}`;
  const [cliente, indicacoes, beneficios] = await Promise.all([
    db.cliente.findUniqueOrThrow({ where: { id: clienteId }, select: { nome: true } }),
    db.indicacao.findMany({ where: { indicadorId: clienteId }, select: { convertidaEm: true } }),
    db.beneficio.findMany({ where: { clienteId, ...disponiveis() }, select: { id: true, descricao: true, valorCentavos: true } }),
  ]);
  return {
    ativa: true as const,
    codigo,
    link,
    convite: TEXTOS.CONVITE({ nome: cliente.nome, barbearia: cfg.nomeBarbearia, link, codigo, premioIndicado: cfg.premioIndicadoCentavos }),
    premioIndicadorCentavos: cfg.premioIndicadorCentavos,
    premioIndicadoCentavos: cfg.premioIndicadoCentavos,
    indicados: indicacoes.length,
    convertidos: indicacoes.filter((i) => i.convertidaEm).length,
    beneficios,
  };
}

/** Quem e o dono do codigo (para a pagina /i/<codigo> mostrar "indicado por Rafael"). */
export async function donoDoCodigo(codigo: string) {
  const c = normalizarCodigo(codigo);
  if (!c) return null;
  return db.cliente.findUnique({ where: { codigoIndicacao: c }, select: { id: true, nome: true } });
}

/**
 * Liga o cliente novo a quem indicou. So vale para quem ainda nao foi atendido nem indicado,
 * e ninguem indica a si mesmo. Cria o beneficio de boas-vindas.
 */
export async function registrarIndicacao(indicadoId: string, codigoTexto: string, origem: OrigemAgendamento) {
  const cfg = await configuracao();
  if (!cfg.indicacaoAtiva) throw new ErroNegocio("O programa de indicação não está ativo.");
  const codigo = normalizarCodigo(codigoTexto);
  if (!codigo) throw new ErroNegocio("Código de indicação inválido.");
  const indicador = await db.cliente.findUnique({ where: { codigoIndicacao: codigo }, select: { id: true, nome: true, telefone: true } });
  if (!indicador) throw new ErroNegocio("Não achei esse código de indicação.");
  if (indicador.id === indicadoId) throw new ErroNegocio("Não dá para usar o próprio código.");
  const [jaIndicado, atendido] = await Promise.all([
    db.indicacao.findUnique({ where: { indicadoId } }),
    db.agendamento.count({ where: { clienteId: indicadoId, status: "CONCLUIDO" } }),
  ]);
  if (jaIndicado) throw new ErroNegocio("Esse cadastro já foi indicado por alguém.");
  if (atendido) throw new ErroNegocio("A indicação vale só para quem ainda não cortou aqui.");

  return db.$transaction(async (tx) => {
    const ind = await tx.indicacao.create({ data: { indicadorId: indicador.id, indicadoId, origem } });
    await tx.cliente.update({ where: { id: indicadoId }, data: { origem: "INDICACAO", origemDetalhe: indicador.nome } });
    if (cfg.premioIndicadoCentavos > 0) {
      await tx.beneficio.create({
        data: { clienteId: indicadoId, descricao: `Boas-vindas (indicação de ${indicador.nome.split(" ")[0]})`, valorCentavos: cfg.premioIndicadoCentavos, motivo: "INDICADO", indicacaoId: ind.id },
      });
    }
    await auditar(tx, null, "indicacao", "cliente", indicadoId, { indicadorId: indicador.id, origem });
    return { indicacao: ind, indicador, premioCentavos: cfg.premioIndicadoCentavos };
  });
}

/** Indicacoes cujo indicado ja foi atendido: premia quem indicou (uma vez) e devolve quem avisar. */
export async function converterIndicacoes(opts: { clienteIds?: string[] } = {}) {
  const cfg = await configuracao();
  const pendentes = await db.indicacao.findMany({
    where: { convertidaEm: null, indicado: { agendamentos: { some: { status: "CONCLUIDO" } } }, ...(opts.clienteIds ? { indicadorId: { in: opts.clienteIds } } : {}) },
    include: { indicador: { select: { id: true, nome: true, telefone: true } }, indicado: { select: { nome: true } } },
  });
  const premiados: { indicacaoId: string; indicador: { id: string; nome: string; telefone: string }; amigo: string; premio: number }[] = [];
  for (const p of pendentes) {
    const r = await db.$transaction(async (tx) => {
      const marcou = await tx.indicacao.updateMany({ where: { id: p.id, convertidaEm: null }, data: { convertidaEm: new Date() } });
      if (!marcou.count || cfg.premioIndicadorCentavos <= 0) return false;
      await tx.beneficio.create({
        data: { clienteId: p.indicadorId, descricao: `Indicou ${p.indicado.nome.split(" ")[0] || "um amigo"}`, valorCentavos: cfg.premioIndicadorCentavos, motivo: "INDICOU", indicacaoId: p.id },
      });
      return true;
    });
    if (r) premiados.push({ indicacaoId: p.id, indicador: p.indicador, amigo: p.indicado.nome, premio: cfg.premioIndicadorCentavos });
  }
  return premiados;
}
