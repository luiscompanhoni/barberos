import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { exigirPessoa, travarCompetencia } from "./acesso";
import { proximasMarcacoes, sequenciaValida } from "./regras";
import type { TipoMarcacao } from "./schemas";

export const incluirAjustes = { ajustes: { where: { status: "APROVADO" }, orderBy: { revisadoEm: "desc" as const }, take: 1 } };
export const instanteEfetivo = <T extends { instante: Date; ajustes: { instante: Date }[] }>(m: T) => ({ ...m, instanteOriginal: m.instante, instante: m.ajustes[0]?.instante ?? m.instante });

export async function marcarPresenca(s: Sessao, d: { pessoaId: string; tipo: TipoMarcacao; chave: string }) {
  const { pessoa } = await exigirPessoa(s, d.pessoaId, { propria: true });
  if (!pessoa.ativo) throw new ErroNegocio("Seu cadastro de RH está inativo.");
  const fuso = (await configuracao()).fuso;
  return db.$transaction(async (tx) => {
    const agora = new Date(), dia = dataLocal(agora, fuso);
    await tx.$queryRaw`SELECT id FROM checklist_pessoas WHERE id = ${d.pessoaId} FOR UPDATE`;
    const repetida = await tx.presencaMarcacao.findUnique({ where: { chave: d.chave } });
    if (repetida) {
      if (repetida.pessoaId !== d.pessoaId || repetida.tipo !== d.tipo) throw new ErroNegocio("Identificador de marcação já utilizado.", 409);
      return repetida;
    }
    await travarCompetencia(tx, d.pessoaId, dia.slice(0, 7));
    const anteriores = (await tx.presencaMarcacao.findMany({ where: { pessoaId: d.pessoaId, instante: { gte: new Date(instanteLocal(dia, 0, fuso)), lt: new Date(instanteLocal(somarDias(dia, 1), 0, fuso)) } }, include: incluirAjustes, orderBy: { instante: "asc" } })).map(instanteEfetivo).sort((a, b) => +a.instante - +b.instante);
    if (!sequenciaValida(anteriores) || !proximasMarcacoes(anteriores.map((m) => m.tipo)).includes(d.tipo)) throw new ErroNegocio("A sequência de marcações mudou. Atualize a tela antes de continuar.", 409);
    const m = await tx.presencaMarcacao.create({ data: { pessoaId: d.pessoaId, tipo: d.tipo, chave: d.chave, instante: agora, criadoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "presenca_marcar", "presenca_marcacao", m.id, { pessoaId: d.pessoaId, tipo: d.tipo, instante: agora.toISOString() });
    return m;
  });
}

export async function solicitarAjuste(s: Sessao, d: { pessoaId: string; marcacaoId?: string; tipo?: TipoMarcacao; instante: Date; motivo: string }) {
  const m = d.marcacaoId ? await db.presencaMarcacao.findUnique({ where: { id: d.marcacaoId } }) : null;
  if (d.marcacaoId && (!m || m.pessoaId !== d.pessoaId)) throw naoEncontrado("Marcação");
  if (!m && !d.tipo) throw new ErroNegocio("Escolha o tipo da marcação esquecida.");
  await exigirPessoa(s, d.pessoaId);
  const fuso = (await configuracao()).fuso;
  if (+d.instante > Date.now() || (m && dataLocal(d.instante, fuso) !== dataLocal(m.instante, fuso))) throw new ErroNegocio("O ajuste deve permanecer no mesmo dia e não pode indicar horário futuro.");
  return db.$transaction(async (tx) => {
    await travarCompetencia(tx, d.pessoaId, dataLocal(d.instante, fuso).slice(0, 7));
    const repetida = m ? { marcacaoId: m.id } : { pessoaId: d.pessoaId, marcacaoId: null, tipo: d.tipo, instante: d.instante };
    if (await tx.presencaAjuste.findFirst({ where: { ...repetida, status: "PENDENTE" } })) throw new ErroNegocio("Esta marcação já tem uma correção aguardando revisão.", 409);
    const ajuste = await tx.presencaAjuste.create({ data: { pessoaId: d.pessoaId, marcacaoId: m?.id, tipo: m ? null : d.tipo, instante: d.instante, motivo: d.motivo, solicitadoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "presenca_ajuste_solicitar", "presenca_ajuste", ajuste.id, { motivo: d.motivo, instante: d.instante.toISOString(), marcacaoId: m?.id ?? null, tipo: d.tipo ?? null });
    return ajuste;
  });
}

export async function revisarAjuste(s: Sessao, d: { id: string; aprovar: boolean }) {
  return revisarAjustes(s, { ids: [d.id], aprovar: d.aprovar });
}

/** Permite revisar juntos pausa e retorno esquecidos, sem aprovar uma sequência incompleta. */
export async function revisarAjustes(s: Sessao, d: { ids: string[]; aprovar: boolean }) {
  const ids = [...new Set(d.ids)];
  const ajustes = await db.presencaAjuste.findMany({ where: { id: { in: ids } }, include: { marcacao: true } });
  if (!ids.length || ajustes.length !== ids.length) throw naoEncontrado("Correção");
  const pessoaId = ajustes[0].pessoaId, fuso = (await configuracao()).fuso, dia = dataLocal(ajustes[0].instante, fuso);
  if (ajustes.some((a) => a.pessoaId !== pessoaId || dataLocal(a.instante, fuso) !== dia)) throw new ErroNegocio("Revise somente as correções de uma pessoa e um dia por vez.");
  await exigirPessoa(s, pessoaId, { avaliar: true });
  if (ajustes.some((a) => a.solicitadoPorId === s.usuarioId)) throw new ErroNegocio("Quem solicita a correção não pode aprová-la.", 403);
  return db.$transaction(async (tx) => {
    await travarCompetencia(tx, pessoaId, dia.slice(0, 7));
    const pendentes = await tx.presencaAjuste.count({ where: { id: { in: ids }, status: "PENDENTE" } });
    if (pendentes !== ids.length) throw new ErroNegocio("Uma das correções já foi revisada. Atualize a tela.", 409);
    if (d.aprovar) {
      const ms = (await tx.presencaMarcacao.findMany({ where: { pessoaId, instante: { gte: new Date(instanteLocal(dia, 0, fuso)), lt: new Date(instanteLocal(somarDias(dia, 1), 0, fuso)) } }, include: incluirAjustes, orderBy: { instante: "asc" } })).map(instanteEfetivo);
      const corrigidas = ms.map((m) => ({ ...m, instante: ajustes.find((a) => a.marcacaoId === m.id)?.instante ?? m.instante }));
      const inclusoes = ajustes.filter((a) => !a.marcacaoId).map((a) => ({ id: a.id, tipo: a.tipo!, instante: a.instante }));
      const verificacao = [...corrigidas, ...inclusoes].sort((a, b) => +a.instante - +b.instante);
      if (!sequenciaValida(verificacao)) throw new ErroNegocio("O ajuste deixaria as marcações fora de sequência. Pausa e retorno esquecidos devem ser revisados juntos.");
    }
    for (const a of ajustes) {
      const r = await tx.presencaAjuste.updateMany({ where: { id: a.id, status: "PENDENTE" }, data: { status: d.aprovar ? "APROVADO" : "RECUSADO", revisadoEm: new Date(), revisadoPorId: s.usuarioId } });
      if (!r.count) throw new ErroNegocio("Essa correção já foi revisada.", 409);
      if (d.aprovar && !a.marcacaoId) {
        const nova = await tx.presencaMarcacao.create({ data: { pessoaId, tipo: a.tipo!, instante: a.instante, chave: `ajuste:${a.id}`, criadoPorId: s.usuarioId } });
        await tx.presencaAjuste.update({ where: { id: a.id }, data: { marcacaoId: nova.id } });
      }
      await auditar(tx, s.usuarioId, "presenca_ajuste_revisar", "presenca_ajuste", a.id, { aprovar: d.aprovar, antes: a.marcacao?.instante.toISOString() ?? null, depois: a.instante.toISOString() });
    }
    return { ok: true };
  });
}
