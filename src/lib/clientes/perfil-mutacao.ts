import type { Cliente, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio } from "@/lib/erros";
import { cadastroCompleto } from "./perfil-cadastro";

type Titular = { usuarioId: string; clienteId: string; sessaoVersao?: number };
type DadosPerfil = Partial<Pick<Cliente, "nome" | "cpf" | "email" | "endereco" | "dataNascimento" | "observacoes" | "origem" | "origemDetalhe">>;

/** Ordem compartilhada com autenticação, CRM e exclusão: usuário antes do cliente. */
export async function travarPerfilTitular(tx: Prisma.TransactionClient, s: Titular) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${s.usuarioId}`}))`;
  await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${s.clienteId} FOR UPDATE`;
  const [u, c] = await Promise.all([
    tx.usuario.findUnique({ where: { id: s.usuarioId } }),
    tx.cliente.findUnique({ where: { id: s.clienteId } }),
  ]);
  if (!u?.ativo || u.papel !== "CLIENTE" || (u.sessaoVersao ?? 0) !== (s.sessaoVersao ?? 0) ||
      !c || c.excluidoEm || c.usuarioId !== u.id) {
    throw new ErroNegocio("Sua sessão mudou. Entre novamente.", 401, "sessao_invalida");
  }
  return c;
}

export async function atualizarPerfilTitular(s: Titular, dados: DadosPerfil) {
  return db.$transaction(async (tx) => {
    const atual = await travarPerfilTitular(tx, s);
    const completo = cadastroCompleto({ ...atual, ...dados });
    const novo = await tx.cliente.update({ where: { id: s.clienteId }, data: { ...dados,
      perfilCompletoEm: completo ? atual.perfilCompletoEm ?? new Date() : null }, select: { nome: true, observacoes: true } });
    if (dados.nome) await tx.usuario.update({ where: { id: s.usuarioId }, data: { nome: dados.nome } });
    await auditar(tx, s.usuarioId, "cliente_atualizar_perfil", "cliente", s.clienteId, { campos: Object.keys(dados) });
    return novo;
  });
}

export async function atualizarFotoTitular(s: Titular, foto: { dados: Buffer; tipo: string } | null) {
  return db.$transaction(async (tx) => {
    const atual = await travarPerfilTitular(tx, s);
    const versao = Math.abs(atual.fotoVersao) + 1;
    const novo = await tx.cliente.update({ where: { id: s.clienteId }, data: {
      fotoDados: foto ? new Uint8Array(foto.dados) : null, fotoTipo: foto?.tipo ?? null, fotoVersao: foto ? versao : -versao,
    }, select: { fotoVersao: true } });
    await auditar(tx, s.usuarioId, foto ? "cliente_foto_atualizar" : "cliente_foto_remover", "cliente", s.clienteId,
      foto ? { bytes: foto.dados.length, tipo: foto.tipo } : undefined);
    return novo;
  });
}
