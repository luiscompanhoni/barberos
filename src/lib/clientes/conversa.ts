import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { BALCAO, type Sessao } from "@/lib/auth/sessao";

/** Abre o cadastro e a conversa, sem enviar mensagem ou consentir campanhas pelo cliente. */
export async function cadastrarPelaConversa(entrada: { nome: string; telefone: string }, s: Pick<Sessao, "usuarioId" | "sessaoVersao">) {
  const telefone = normalizarTelefone(entrada.telefone);
  if (!telefone) throw new ErroNegocio("Informe um celular com DDD válido.", 422);
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-telefone:${telefone}`}))`;
      // Serializa com revogação, troca de papel e encerramento de sessões.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${s.usuarioId}`}))`;
      await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${s.usuarioId} FOR UPDATE`;
      const ator = await tx.usuario.findUnique({ where: { id: s.usuarioId }, select: { ativo: true, papel: true, sessaoVersao: true } });
      if (!ator?.ativo || !BALCAO.includes(ator.papel) || ator.sessaoVersao !== (s.sessaoVersao ?? 0)) throw new ErroNegocio("Sua sessão mudou. Entre novamente.", 401, "sessao_invalida");
      let cliente = await tx.cliente.findUnique({ where: { telefone } });
      if (cliente?.excluidoEm) throw new ErroNegocio("Este cadastro foi excluído. Revise a identidade antes de cadastrar novamente.", 409);
      const existente = await tx.conversa.findUnique({ where: { telefone } });
      if (existente?.clienteId && existente.clienteId !== cliente?.id) throw new ErroNegocio("O contato tem outro vínculo. Confira a ficha antes de continuar.", 409);
      const criado = !cliente;
      if (!cliente) cliente = await tx.cliente.create({ data: { nome: entrada.nome.trim(), telefone, aceitaMensagens: false } });
      const conversa = await tx.conversa.upsert({ where: { telefone },
        create: { telefone, clienteId: cliente.id, estado: "HUMANO" },
        update: { clienteId: cliente.id },
        select: { id: true, clienteId: true },
      });
      await auditar(tx, s.usuarioId, "abrir_cadastro_conversa", "cliente", cliente.id, { conversaId: conversa.id, criado });
      return { ...conversa, criado };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ErroNegocio("O contato foi cadastrado enquanto você preenchia. Pesquise pelo número para abrir a ficha.", 409);
    throw e;
  }
}
