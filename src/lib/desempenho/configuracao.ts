import type { Prisma } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, somarDias } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { exigirDono, exigirPessoa, travarCompetencia } from "./acesso";
import { zPrograma, type Programa } from "./schemas";

export async function salvarPrograma(s: Sessao, competenciaInicio: string, config: Programa) {
  exigirDono(s);
  const programa = zPrograma.parse(config), hoje = dataLocal(Date.now(), (await configuracao()).fuso);
  if (competenciaInicio <= hoje.slice(0, 7)) throw new ErroNegocio("As novas regras entram a partir do próximo mês, preservando o mês atual e o histórico.");
  if (programa.ativo && !Object.values(programa.faixas).some((f) => f.bonusCentavos > 0) && !(programa.pontosPresenca + programa.pontosLider + programa.pontosClientes)) throw new ErroNegocio("Defina o valor do bônus ou os pontos antes de ativar o programa.");
  return db.$transaction(async (tx) => {
    const antes = await tx.desempenhoRegra.findUnique({ where: { competenciaInicio } });
    const regra = await tx.desempenhoRegra.upsert({ where: { competenciaInicio }, create: { competenciaInicio, config: programa, criadoPorId: s.usuarioId }, update: { config: programa, criadoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "desempenho_regra", "desempenho_regra", regra.id, { competenciaInicio, antes: antes?.config ?? null, depois: programa });
    return regra;
  });
}

export async function proporAdesao(s: Sessao, d: { pessoaId: string; inicio: string; diasSemana: number[]; inicioMin: number; fimMin: number }) {
  exigirDono(s);
  const { pessoa } = await exigirPessoa(s, d.pessoaId);
  if (!pessoa.usuarioId) throw new ErroNegocio("Vincule um acesso à pessoa antes de propor a adesão.");
  const hoje = dataLocal(Date.now(), (await configuracao()).fuso);
  if (d.inicio < hoje || d.fimMin <= d.inicioMin || new Set(d.diasSemana).size !== d.diasSemana.length) throw new ErroNegocio("Confira início, dias da semana e horário final.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM checklist_pessoas WHERE id = ${d.pessoaId} FOR UPDATE`;
    if (await tx.desempenhoAdesao.findFirst({ where: { pessoaId: d.pessoaId, encerradaEm: null } })) throw new ErroNegocio("Encerre a adesão anterior antes de propor novos horários.", 409);
    const adesao = await tx.desempenhoAdesao.create({ data: { pessoaId: d.pessoaId, inicio: d.inicio, diasSemana: d.diasSemana, inicioMin: d.inicioMin, fimMin: d.fimMin, criadoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "desempenho_adesao_propor", "desempenho_adesao", adesao.id, d);
    return adesao;
  });
}

export async function responderAdesao(s: Sessao, id: string, acao: "aceitar" | "encerrar") {
  const adesao = await db.desempenhoAdesao.findUnique({ where: { id } });
  if (!adesao) throw naoEncontrado("Adesão");
  await exigirPessoa(s, adesao.pessoaId, { propria: acao === "aceitar" || s.papel !== "DONO" });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM checklist_pessoas WHERE id = ${adesao.pessoaId} FOR UPDATE`;
    const agora = new Date();
    const r = await tx.desempenhoAdesao.updateMany({ where: { id, encerradaEm: null, ...(acao === "aceitar" ? { aceitaEm: null } : {}) }, data: acao === "aceitar" ? { aceitaEm: agora } : { encerradaEm: agora } });
    if (!r.count) throw new ErroNegocio("A adesão já foi respondida ou encerrada.", 409);
    await auditar(tx, s.usuarioId, `desempenho_adesao_${acao}`, "desempenho_adesao", id, { instante: agora.toISOString() });
    return { ok: true };
  });
}

export async function justificarPresenca(s: Sessao, d: { pessoaId: string; data: string; tipo: "FOLGA" | "ABONO"; motivo: string }) {
  await exigirPessoa(s, d.pessoaId, { avaliar: true });
  const hoje = dataLocal(Date.now(), (await configuracao()).fuso);
  if (d.data > somarDias(hoje, 366)) throw new ErroNegocio("Informe uma data nos próximos 12 meses ou no histórico aberto.");
  // Folga ou abono num dia que já passou muda a apuração do bônus: só o dono (a liderança registra de hoje em diante).
  if (d.data < hoje) exigirDono(s);
  return db.$transaction(async (tx) => {
    await travarCompetencia(tx, d.pessoaId, d.data.slice(0, 7));
    const antes = await tx.presencaJustificativa.findUnique({ where: { pessoaId_data: { pessoaId: d.pessoaId, data: d.data } } });
    // Abono conta o dia como cumprido para o bônus: só o dono concede ou troca (a liderança registra folgas).
    if (d.tipo === "ABONO" || antes?.tipo === "ABONO") exigirDono(s);
    const j = await tx.presencaJustificativa.upsert({ where: { pessoaId_data: { pessoaId: d.pessoaId, data: d.data } }, create: { pessoaId: d.pessoaId, data: d.data, tipo: d.tipo, motivo: d.motivo, porId: s.usuarioId }, update: { tipo: d.tipo, motivo: d.motivo, porId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "presenca_justificar", "presenca_justificativa", j.id, { antes: antes ? { tipo: antes.tipo, motivo: antes.motivo } : null, depois: d });
    return j;
  });
}

export async function vincularPessoa(s: Sessao, pessoaId: string, usuarioId: string) {
  exigirDono(s);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${usuarioId} FOR UPDATE`;
    const [pessoa, usuario] = await Promise.all([
      tx.checklistPessoa.findUnique({ where: { id: pessoaId }, include: { barbeiro: true } }),
      tx.usuario.findUnique({ where: { id: usuarioId }, include: { checklistPessoa: true, barbeiro: true } }),
    ]);
    if (!pessoa || !usuario) throw naoEncontrado("Cadastro");
    if (!usuario.ativo || usuario.papel === "CLIENTE") throw new ErroNegocio("Escolha um acesso ativo da equipe.");
    if ((pessoa.usuarioId && pessoa.usuarioId !== usuarioId) || (usuario.checklistPessoa && usuario.checklistPessoa.id !== pessoaId) || (pessoa.barbeiro && pessoa.barbeiro.usuarioId !== usuarioId)) throw new ErroNegocio("O cadastro já está ligado a outra pessoa. Confira os vínculos em Acessos.", 409);
    if (usuario.barbeiro && pessoa.barbeiroId !== usuario.barbeiro.id) throw new ErroNegocio("Vincule o cadastro de RH que já pertence ao barbeiro.", 409);
    await tx.checklistPessoa.update({ where: { id: pessoaId }, data: { usuarioId } });
    await auditar(tx, s.usuarioId, "desempenho_vincular", "checklist_pessoa", pessoaId, { usuarioId });
    return { ok: true };
  });
}

export function jsonSeguro(valor: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(valor)) as Prisma.InputJsonValue;
}
