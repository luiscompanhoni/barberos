import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { verificarCodigo } from "./otp";
import { gerarHash, problemaDaSenha } from "./senha";

/** Recuperação explícita: o código de login comum não autoriza redefinir senha. */
export async function recuperarSenhaCliente(p: { telefone: string; codigo: string; senha: string }) {
  const telefone = normalizarTelefone(p.telefone);
  if (!telefone) throw new ErroNegocio("Celular inválido. Use DDD + número.");
  const problema = problemaDaSenha(p.senha, telefone);
  if (problema) throw new ErroNegocio(problema);
  if (!/^\d{6}$/.test(p.codigo)) throw new ErroNegocio("Informe o código de 6 dígitos.");
  const comprovado = await verificarCodigo(telefone, p.codigo, "cliente", "recuperacao");
  const senhaHash = await gerarHash(p.senha);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${comprovado.id}`}))`;
    const u = await tx.usuario.findUnique({ where: { id: comprovado.id }, include: { cliente: true } });
    if (!u?.ativo || u.papel !== "CLIENTE" || !u.telefoneVerificadoEm || u.telefone !== telefone ||
        u.sessaoVersao !== comprovado.sessaoVersao || !u.cliente || u.cliente.excluidoEm) {
      throw new ErroNegocio("Sua conta mudou. Solicite outro código.", 401, "sessao_invalida");
    }
    const atualizado = await tx.usuario.update({ where: { id: u.id }, data: {
      senhaHash, trocarSenha: false, senhaFalhas: 0, bloqueadoAte: null, sessaoVersao: { increment: 1 },
    }, include: { barbeiro: { select: { id: true, ativo: true } }, cliente: { select: { id: true } } } });
    await auditar(tx, u.id, "cliente_recuperar_senha", "usuario", u.id, { revogouSessoes: true });
    return atualizado;
  });
}
