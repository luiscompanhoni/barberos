/**
 * Login por celular (ou usuario) + senha, cadastro do cliente e troca de senha.
 * O login por codigo (otp.ts) continua como "primeiro acesso / esqueci a senha".
 */
import { VERSAO_TERMOS } from "@/lib/lgpd/textos";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { verificarCodigo, type Area } from "./otp";
import { conferirSenha, gerarHash, problemaDaSenha, senhaTemporaria } from "./senha";
import { limitarIdentificadorSenha } from "./limites";
import type { Sessao } from "./sessao";

const MAX_FALHAS = 5;
const BLOQUEIO_MS = 15 * 60_000;
const incluir = { barbeiro: { select: { id: true, ativo: true } }, cliente: { select: { id: true, excluidoEm: true } } } as const;
// Mesma mensagem para usuario inexistente e senha errada (nao revela quem tem conta).
const invalido = () => new ErroNegocio("Celular/usuário ou senha incorretos.", 401, "senha_invalida");

/** Normaliza o nome de usuario: minusculas, letras, numeros, ponto e traco. */
export function normalizarLogin(login: string) {
  const l = login.trim().toLowerCase();
  return /^[a-z][a-z0-9._-]{2,29}$/.test(l) ? l : null;
}

async function acharUsuario(identificador: string) {
  const login = normalizarLogin(identificador);
  if (login) {
    const u = await db.usuario.findUnique({ where: { login }, include: incluir });
    if (u) return u;
  }
  const tel = normalizarTelefone(identificador);
  return tel ? db.usuario.findUnique({ where: { telefone: tel }, include: incluir }) : null;
}

export async function entrarComSenha(identificador: string, senha: string, area: Area) {
  void area; // Compatibilidade com os aplicativos anteriores ao acesso único.
  limitarIdentificadorSenha(identificador);
  const u = await acharUsuario(identificador);
  if (!u || !u.ativo || !u.senhaHash || (u.papel === "CLIENTE" && (!u.cliente || u.cliente.excluidoEm))) {
    await conferirSenha(senha, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"); // tempo parecido com o caminho normal
    throw invalido();
  }
  const r = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${u.id}`}))`;
    const atual = await tx.usuario.findUnique({ where: { id: u.id }, include: incluir });
    if (!atual?.ativo || !atual.senhaHash || (atual.papel === "CLIENTE" && (!atual.cliente || atual.cliente.excluidoEm))) return { erro: invalido() };
    if (atual.bloqueadoAte && atual.bloqueadoAte.getTime() > Date.now()) {
      const min = Math.ceil((atual.bloqueadoAte.getTime() - Date.now()) / 60_000);
      return { erro: new ErroNegocio(`Muitas tentativas erradas. Tente de novo em ${min} min ou use "esqueci a senha".`, 429, "bloqueado") };
    }
    if (!(await conferirSenha(senha, atual.senhaHash))) {
      const falhas = atual.senhaFalhas + 1;
      await tx.usuario.update({ where: { id: atual.id }, data: falhas >= MAX_FALHAS
        ? { senhaFalhas: 0, bloqueadoAte: new Date(Date.now() + BLOQUEIO_MS) } : { senhaFalhas: falhas } });
      // Lançar fora da transação preserva a falha e o bloqueio gravados.
      return { erro: invalido() };
    }
    // O perfil vem exclusivamente do cadastro revalidado, nunca da área escolhida.
    if (atual.senhaFalhas || atual.bloqueadoAte) await tx.usuario.update({ where: { id: atual.id }, data: { senhaFalhas: 0, bloqueadoAte: null } });
    return { usuario: atual };
  });
  if (r.erro) throw r.erro;
  return r.usuario!;
}

/**
 * Só define credenciais após prova do celular. Uma senha já verificada não é
 * substituída pelo formulário público de cadastro.
 */
export async function criarContaCliente(p: { nome: string; telefone: string; senha: string; codigo: string; cpf?: string; email?: string; endereco?: string; dataNascimento?: Date }) {
  const tel = normalizarTelefone(p.telefone);
  if (!tel) throw new ErroNegocio("Celular inválido. Use DDD + número.", 400);
  const problema = problemaDaSenha(p.senha, tel);
  if (problema) throw new ErroNegocio(problema);

  if (!/^\d{6}$/.test(p.codigo ?? "")) throw new ErroNegocio("Confirme seu celular com o código recebido.", 400, "confirmar_celular");
  const comprovado = await verificarCodigo(tel, p.codigo, "cliente", "acesso", { permitirNovoCadastro: true });
  if (comprovado.papel !== "CLIENTE") throw new ErroNegocio("Esse número já pertence à equipe. Volte e entre com senha ou código.", 403);
  const senhaHash = await gerarHash(p.senha);
  const nome = p.nome.trim();
  const aceite = { termosVersao: VERSAO_TERMOS, termosAceitosEm: new Date() };
  const perfil = { cpf: p.cpf, email: p.email, endereco: p.endereco, dataNascimento: p.dataNascimento,
    ...(p.cpf && p.email && p.endereco && p.dataNascimento ? { perfilCompletoEm: new Date() } : {}) };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${comprovado.id}`}))`;
    const u = await tx.usuario.findUniqueOrThrow({ where: { id: comprovado.id }, include: { ...incluir, cliente: true } });
    if (!u.ativo || u.papel !== "CLIENTE" || !u.telefoneVerificadoEm || u.sessaoVersao !== comprovado.sessaoVersao || !u.cliente || u.cliente.excluidoEm) throw invalido();
    if (u.senhaHash) throw new ErroNegocio("Esse celular já tem conta. Entre com a senha ou use o acesso por código.", 409, "ja_tem_conta");
    await tx.usuario.update({ where: { id: u.id }, data: { nome, senhaHash, trocarSenha: false } });
    await tx.cliente.update({ where: { id: u.cliente.id }, data: { nome, ...aceite, ...perfil } });
    return tx.usuario.findUniqueOrThrow({ where: { id: u.id }, include: incluir });
  });
}

/** Troca a propria senha. Quem ainda nao tem senha (entrou por codigo) define sem a atual. */
export async function trocarPropriaSenha(usuarioId: string, p: { atual?: string | null; nova: string }, versaoSessao = 0) {
  return db.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${usuarioId}`}))`;
  const u = await tx.usuario.findUnique({ where: { id: usuarioId } });
  if (!u) throw naoEncontrado("Usuário");
  if (!u.ativo || (u.sessaoVersao ?? 0) !== versaoSessao) throw invalido();
  if (u.papel === "CLIENTE" && !u.telefoneVerificadoEm) throw new ErroNegocio("Entre por código para confirmar seu celular antes de alterar a senha.", 403, "confirmar_celular");
  if (u.senhaHash && !(await conferirSenha(p.atual ?? "", u.senhaHash))) throw new ErroNegocio("Senha atual incorreta.", 401, "senha_atual");
  const problema = problemaDaSenha(p.nova, u.telefone);
  if (problema) throw new ErroNegocio(problema);
  if (u.senhaHash && (await conferirSenha(p.nova, u.senhaHash))) throw new ErroNegocio("A nova senha precisa ser diferente da atual.");
  const atualizado = await tx.usuario.update({ where: { id: usuarioId }, data: {
    senhaHash: await gerarHash(p.nova), trocarSenha: false, senhaFalhas: 0, bloqueadoAte: null, sessaoVersao: { increment: 1 },
  }, include: incluir });
  await auditar(tx, usuarioId, "trocar_senha", "usuario", usuarioId, { revogouSessoes: true });
  return atualizado;
  });
}

/** Dono define uma senha temporaria para alguem da equipe (troca obrigatoria no 1o acesso). */
export async function definirSenhaTemporaria(usuarioId: string) {
  return (await redefinirSenhaTemporaria(usuarioId)).senha;
}

/** A rota passa o dono para revalidar e auditar o reset na mesma transação. */
export async function redefinirSenhaTemporaria(usuarioId: string, ator?: Pick<Sessao, "usuarioId" | "sessaoVersao">) {
  const senha = senhaTemporaria();
  const senhaHash = await gerarHash(senha);
  return db.$transaction(async (tx) => {
    // Ordem estável também quando dois donos redefinem a senha um do outro.
    for (const id of [...new Set([usuarioId, ...(ator ? [ator.usuarioId] : [])])].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${id}`}))`;
    }
    if (ator) {
      const dono = await tx.usuario.findUnique({ where: { id: ator.usuarioId } });
      if (!dono?.ativo || dono.papel !== "DONO" || (dono.sessaoVersao ?? 0) !== (ator.sessaoVersao ?? 0)) throw proibido();
    }
    const u = await tx.usuario.findUnique({ where: { id: usuarioId } });
    if (!u || u.papel === "CLIENTE") throw naoEncontrado("Usuário da equipe");
    const usuario = await tx.usuario.update({ where: { id: usuarioId }, data: {
      senhaHash, trocarSenha: true, senhaFalhas: 0, bloqueadoAte: null, sessaoVersao: { increment: 1 },
    }, include: incluir });
    await auditar(tx, ator?.usuarioId ?? null, "senha_temporaria", "usuario", usuarioId, { revogouSessoes: true });
    return { senha, usuario };
  });
}
