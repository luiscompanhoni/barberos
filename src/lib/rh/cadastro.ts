import { randomBytes } from "node:crypto";
import { z } from "zod";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, proibido } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { revisaoApuracao } from "./revisao";
import { competenciaSalario, garantirBaselineRemuneracao, gravarVigenciaRemuneracao } from "./vigencias";

export const zPessoaRh = z.object({
  nome: z.string().trim().min(2).max(60),
  telefone: z.string().trim().min(10).max(30),
  cargo: z.string().trim().min(2).max(60),
  salarioCentavos: z.number().int().min(0).max(100_000_000),
  competenciaSalario: z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/),
  idempotencia: z.uuid(),
}).strict();
export type PessoaRhEntrada = z.infer<typeof zPessoaRh>;

/** Cadastro financeiro sem criar login, cadeira, função ou tarefas de checklist. */
export async function criarPessoaRh(s: Sessao, entrada: PessoaRhEntrada) {
  if (s.papel !== "DONO") throw proibido();
  const d = zPessoaRh.parse(entrada), telefone = normalizarTelefone(d.telefone);
  if (!telefone) throw new ErroNegocio("Telefone inválido. Informe DDD e número.");
  const hashPedido = revisaoApuracao({ ...d, telefone, atorId: s.usuarioId });
  return db.$transaction(async tx => {
    // A mesma trava cobre repetição e cadastros concorrentes com o mesmo contato.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('rh:pessoa:criar'))`;
    const ator = await tx.usuario.findUnique({ where: { id: s.usuarioId }, select: { ativo: true, papel: true, sessaoVersao: true } });
    if (!ator?.ativo || ator.papel !== "DONO" || ator.sessaoVersao !== (s.sessaoVersao ?? 0)) throw proibido();
    const anterior = await tx.auditoria.findFirst({ where: { acao: "rh_pessoa_criar", usuarioId: s.usuarioId, dados: { path: ["idempotencia"], equals: d.idempotencia } }, select: { entidadeId: true, dados: true } });
    if (anterior) {
      const dados = anterior.dados as { hashPedido?: string };
      if (dados?.hashPedido !== hashPedido) throw new ErroNegocio("Esta tentativa já foi usada com outros dados. Confira a ficha criada.", 409, "rh_cadastro_idempotencia");
      return { pessoaId: anterior.entidadeId, jaRegistrada: true };
    }
    const competencia = competenciaSalario(d.competenciaSalario);
    const pessoas = await tx.checklistPessoa.findMany({ select: { telefone: true } });
    if (pessoas.some(p => normalizarTelefone(p.telefone) === telefone)) throw new ErroNegocio("Já existe uma ficha com este contato. Confira os cadastros antes de incluir outra pessoa.", 409, "rh_cadastro_duplicado");
    const pessoa = await tx.checklistPessoa.create({ data: { nome: d.nome, telefone, cargo: d.cargo,
      salarioCentavos: d.salarioCentavos, funcao: null, ativo: true, token: randomBytes(24).toString("hex") } });
    await garantirBaselineRemuneracao(tx, `salario:${pessoa.id}`, { salarioCentavos: 0 }, s.usuarioId);
    await gravarVigenciaRemuneracao(tx, { escopo: `salario:${pessoa.id}`, competencia, conteudo: { salarioCentavos: d.salarioCentavos }, atorId: s.usuarioId });
    await auditar(tx, s.usuarioId, "rh_pessoa_criar", "checklist_pessoa", pessoa.id, {
      idempotencia: d.idempotencia, hashPedido, competenciaSalario: competencia, salarioCentavos: d.salarioCentavos,
      checklist: false, acessoCriado: false, cadeiraCriada: false,
    });
    return { pessoaId: pessoa.id, jaRegistrada: false };
  }, { timeout: 30_000 });
}
