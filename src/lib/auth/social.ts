import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio } from "@/lib/erros";
import { cadastroCompleto, type zDadosCadastroCliente } from "@/lib/clientes/perfil-cadastro";
import type { z } from "zod";
import { VERSAO_TERMOS } from "@/lib/lgpd/textos";
import { abrirSessao } from "./abrir-sessao";
import { verificarCodigo } from "./otp";
import { COOKIE_SOCIAL_NAVEGADOR, guardarIdentidadePendente, identidadePendente, limparIdentidadePendente, socialSeguro } from "./social-cookies";
import { configuracaoSocial, urlAutorizacao, verificarIdentidadeSocial, type IdentidadeVerificada, type ProvedorSocial } from "./social-provedores";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const incluir = { barbeiro: { select: { id: true, ativo: true } }, cliente: true } as const;
const invalido = () => new ErroNegocio("Este acesso expirou ou já foi utilizado. Comece novamente.", 401, "social_invalido");

export async function iniciarSocial(provedor: ProvedorSocial) {
  if (!configuracaoSocial(provedor)) throw new ErroNegocio("Acesso social ainda não configurado.", 503);
  const state = randomBytes(32).toString("base64url"), navegador = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url"), verificador = randomBytes(48).toString("base64url");
  await db.fluxoSocial.deleteMany({ where: { expiraEm: { lt: new Date() } } });
  await db.fluxoSocial.create({ data: {
    id: hash(state), navegadorHash: hash(navegador), provedor, nonce, verificador, expiraEm: new Date(Date.now() + 600_000),
  } });
  (await cookies()).set(COOKIE_SOCIAL_NAVEGADOR, navegador, { httpOnly: true, secure: socialSeguro(),
    sameSite: provedor === "apple" ? "none" : "lax", path: "/api/auth/social", maxAge: 600 });
  const desafio = createHash("sha256").update(verificador).digest("base64url");
  return urlAutorizacao(provedor, state, nonce, desafio);
}

export async function retornarSocial(provedor: ProvedorSocial, state: string, code: string) {
  const navegador = (await cookies()).get(COOKIE_SOCIAL_NAVEGADOR)?.value;
  if (!navegador || !state || state.length > 150 || !code || code.length > 4096) throw invalido();
  const f = await db.fluxoSocial.findUnique({ where: { id: hash(state) } });
  if (!f || f.provedor !== provedor || f.navegadorHash !== hash(navegador) || f.consumidoEm || f.expiraEm <= new Date()) throw invalido();
  // O claim é atômico: duas callbacks simultâneas não trocam o mesmo código.
  const claim = await db.fluxoSocial.updateMany({ where: { id: f.id, consumidoEm: null, expiraEm: { gt: new Date() } }, data: { consumidoEm: new Date() } });
  if (claim.count !== 1) throw invalido();
  (await cookies()).set(COOKIE_SOCIAL_NAVEGADOR, "", { path: "/api/auth/social", maxAge: 0 });
  const identidade = await verificarIdentidadeSocial(provedor, code, f.nonce, f.verificador ?? "");
  const vinculo = await db.identidadeSocial.findUnique({ where: { provedor_subject: { provedor, subject: identidade.subject } }, include: { usuario: { include: incluir } } });
  if (!vinculo) {
    await guardarIdentidadePendente(identidade);
    return "/c/entrar?social=pendente";
  }
  const u = vinculo.usuario;
  if (!u.ativo || u.papel !== "CLIENTE" || !u.cliente || u.cliente.excluidoEm) throw invalido();
  if (!u.telefoneVerificadoEm) {
    await guardarIdentidadePendente(identidade);
    return "/c/entrar?social=pendente";
  }
  await limparIdentidadePendente();
  await abrirSessao(u);
  return cadastroCompleto(u.cliente) ? "/c" : "/c/perfil?completar=1";
}

async function vincular(tx: Prisma.TransactionClient, usuarioId: string, identidade: IdentidadeVerificada) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`social-usuario:${usuarioId}:${identidade.provedor}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`social:${identidade.provedor}:${identidade.subject}`}))`;
  const existente = await tx.identidadeSocial.findUnique({ where: { provedor_subject: { provedor: identidade.provedor, subject: identidade.subject } } });
  if (existente && existente.usuarioId !== usuarioId) throw new ErroNegocio("Esse acesso já está vinculado a outra conta.", 409);
  const outro = await tx.identidadeSocial.findUnique({ where: { usuarioId_provedor: { usuarioId, provedor: identidade.provedor } } });
  if (outro && outro.subject !== identidade.subject) throw new ErroNegocio("Sua conta já tem outro acesso desse provedor vinculado.", 409);
  if (!existente) await tx.identidadeSocial.create({ data: { usuarioId, provedor: identidade.provedor, subject: identidade.subject } });
  await auditar(tx, usuarioId, "login_social_vincular", "usuario", usuarioId, { provedor: identidade.provedor });
}

/** Somente após prova da conta local; e-mail retornado pelo provedor nunca faz o vínculo. */
export async function vincularSocialDaSessao(usuarioId: string, versaoSessao = 0) {
  const identidade = await identidadePendente();
  if (!identidade) throw invalido();
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${usuarioId}`}))`;
    const u = await tx.usuario.findUnique({ where: { id: usuarioId }, include: { cliente: true } });
    if (!u?.ativo || u.papel !== "CLIENTE" || !u.cliente || u.cliente.excluidoEm) throw invalido();
    if ((u.sessaoVersao ?? 0) !== versaoSessao) throw invalido();
    if (!u.telefoneVerificadoEm) throw new ErroNegocio("Confirme seu celular pelo acesso por código antes de vincular esta conta.", 403, "confirmar_celular");
    await vincular(tx, u.id, identidade);
  });
  await limparIdentidadePendente();
}

export async function concluirCadastroSocial(dados: z.infer<typeof zDadosCadastroCliente>, codigo: string) {
  const identidade = await identidadePendente();
  if (!identidade) throw invalido();
  const u = await verificarCodigo(dados.telefone, codigo, "cliente", "acesso", { permitirNovoCadastro: true });
  if (!u.ativo || u.papel !== "CLIENTE" || !u.cliente) throw invalido();
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${u.id}`}))`;
    const atual = await tx.usuario.findUnique({ where: { id: u.id }, include: { cliente: true } });
    if (!atual?.ativo || atual.papel !== "CLIENTE" || !atual.telefoneVerificadoEm || atual.sessaoVersao !== u.sessaoVersao || !atual.cliente || atual.cliente.excluidoEm) throw invalido();
    await vincular(tx, u.id, identidade);
    await tx.usuario.update({ where: { id: u.id }, data: { nome: dados.nome } });
    await tx.cliente.update({ where: { id: u.cliente!.id }, data: { ...dados,
      perfilCompletoEm: new Date(), termosVersao: VERSAO_TERMOS, termosAceitosEm: new Date() } });
    await auditar(tx, u.id, "cliente_completar_cadastro", "cliente", u.cliente!.id, { origem: "social" });
  });
  await limparIdentidadePendente();
  await abrirSessao({ ...u, nome: dados.nome });
  return { ok: true, destino: "/c/perfil?foto=1" };
}
