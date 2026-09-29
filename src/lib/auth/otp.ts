import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { enviarTemplate } from "@/lib/whatsapp/canal";

const VALIDADE_MS = 5 * 60_000;
const ESPERA_REENVIO_MS = 60_000;
const MAX_TENTATIVAS = 5;
const MAX_CODIGOS_HORA = 5;

function hash(telefone: string, codigo: string) {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "")
    .update(`${telefone}:${codigo}`)
    .digest("hex");
}

/**
 * Modo de teste local: o codigo volta para a tela de login e os limites de
 * reenvio sao desligados. Nunca ativo em producao nem com o WhatsApp ligado.
 */
export function modoCodigoNaTela(): boolean {
  return process.env.NODE_ENV !== "production" && (process.env.OTP_PROVIDER ?? "console") === "console";
}

/** Canal de entrega do codigo: "console" (teste local) ou "whatsapp" (producao). */
async function entregar(telefone: string, codigo: string) {
  const provedor = process.env.OTP_PROVIDER ?? "console";
  if (provedor === "console") {
    console.log(`\n[BarberOS] Código de acesso para ${telefone}: ${codigo}\n`);
    return;
  }
  if (provedor === "whatsapp") {
    const template = process.env.WHATSAPP_TEMPLATE_CODIGO;
    if (!template) throw new Error("WHATSAPP_TEMPLATE_CODIGO não configurado.");
    // Template de autenticacao da Meta: corpo com o codigo + botao "copiar codigo".
    await enviarTemplate(telefone, { nome: template, parametros: [codigo], botaoCodigo: codigo });
    return;
  }
  throw new Error(`OTP_PROVIDER desconhecido: ${provedor}`);
}

export type Area = "equipe" | "cliente";

/**
 * Gera e envia um codigo de 6 digitos. Na area da equipe so envia para usuarios
 * cadastrados; na area do cliente qualquer celular pode entrar (o cadastro e
 * criado no primeiro acesso). A resposta e sempre a mesma (nao revela quem esta
 * cadastrado). Em modo de teste local, devolve o codigo gerado.
 */
export async function solicitarCodigo(telefone: string, area: Area = "equipe"): Promise<string | null> {
  const agora = Date.now();
  const teste = modoCodigoNaTela();
  const recentes = await db.codigoLogin.findMany({
    where: { telefone, criadoEm: { gte: new Date(agora - 60 * 60_000) } },
    orderBy: { criadoEm: "desc" },
  });
  if (!teste && recentes[0] && agora - recentes[0].criadoEm.getTime() < ESPERA_REENVIO_MS) {
    throw new ErroNegocio("Aguarde um minuto para pedir outro código.", 429, "aguarde");
  }
  if (!teste && recentes.length >= MAX_CODIGOS_HORA) {
    throw new ErroNegocio("Muitos códigos pedidos. Tente de novo mais tarde.", 429, "limite");
  }

  const usuario = await db.usuario.findUnique({ where: { telefone } });
  if (usuario && !usuario.ativo) return null;
  if (!usuario && area === "equipe") return null;

  const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.codigoLogin.create({
    data: { telefone, codigoHash: hash(telefone, codigo), expiraEm: new Date(agora + VALIDADE_MS) },
  });
  await entregar(telefone, codigo);
  return teste ? codigo : null;
}

const incluir = { barbeiro: { select: { id: true, ativo: true } }, cliente: { select: { id: true } } } as const;

/**
 * Confere o codigo mais recente. Retorna o usuario ou lanca erro. Na area do
 * cliente, cria o usuario (e liga ao cadastro de cliente existente) no primeiro acesso.
 */
export async function verificarCodigo(telefone: string, codigo: string, area: Area = "equipe") {
  const reg = await db.codigoLogin.findFirst({
    where: { telefone, usadoEm: null },
    orderBy: { criadoEm: "desc" },
  });
  const invalido = new ErroNegocio("Código inválido ou expirado.", 401, "codigo_invalido");
  if (!reg || reg.expiraEm.getTime() < Date.now() || reg.tentativas >= MAX_TENTATIVAS) throw invalido;

  const esperado = Buffer.from(reg.codigoHash, "hex");
  const recebido = Buffer.from(hash(telefone, codigo), "hex");
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) {
    await db.codigoLogin.update({ where: { id: reg.id }, data: { tentativas: { increment: 1 } } });
    throw invalido;
  }

  await db.codigoLogin.update({ where: { id: reg.id }, data: { usadoEm: new Date() } });
  const usuario = await db.usuario.findUnique({ where: { telefone }, include: incluir });
  if (usuario) {
    if (!usuario.ativo) throw invalido;
    if (usuario.papel === "CLIENTE" && !usuario.cliente) {
      await ligarCliente(usuario.id, telefone, usuario.nome);
      return db.usuario.findUniqueOrThrow({ where: { id: usuario.id }, include: incluir });
    }
    return usuario;
  }
  if (area !== "cliente") throw invalido;

  const cliente = await db.cliente.findUnique({ where: { telefone } });
  const novo = await db.usuario.create({ data: { telefone, nome: cliente?.nome ?? "", papel: "CLIENTE" } });
  await ligarCliente(novo.id, telefone, cliente?.nome ?? "");
  return db.usuario.findUniqueOrThrow({ where: { id: novo.id }, include: incluir });
}

async function ligarCliente(usuarioId: string, telefone: string, nome: string) {
  await db.cliente.upsert({
    where: { telefone },
    create: { telefone, nome, usuarioId },
    update: { usuarioId },
  });
}
