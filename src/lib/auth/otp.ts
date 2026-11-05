import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { ehHomologacao } from "@/lib/ambiente";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { enviarCodigoAcesso } from "@/lib/whatsapp/canal";
import { auditar } from "@/lib/auditoria";

const VALIDADE_MS = 5 * 60_000;
const ESPERA_REENVIO_MS = 60_000;
const MAX_TENTATIVAS = 5;
const MAX_CODIGOS_HORA = 5;

type FinalidadeCodigo = "acesso" | "recuperacao";
function hash(telefone: string, codigo: string, finalidade: FinalidadeCodigo = "acesso") {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "")
    .update(`${finalidade === "recuperacao" ? "recuperacao:" : ""}${telefone}:${codigo}`)
    .digest("hex");
}

/**
 * Modo de teste local: o codigo volta para a tela de login e os limites de
 * reenvio sao desligados. Nunca ativo em producao nem com o WhatsApp ligado.
 */
export function modoCodigoNaTela(): boolean {
  // Homologacao (protegida por senha no Caddy): o codigo aparece na tela para quem esta testando.
  if (ehHomologacao()) return true;
  return process.env.NODE_ENV !== "production" && (process.env.OTP_PROVIDER ?? "console") === "console";
}

/** Canal de entrega do codigo: "console" (teste local) ou "whatsapp" (producao). */
async function entregar(telefone: string, codigo: string) {
  const provedor = ehHomologacao() ? "console" : (process.env.OTP_PROVIDER ?? "console");
  if (provedor === "console") {
    console.log(`\n[BarberOS] Código de acesso para ${telefone}: ${codigo}\n`);
    return;
  }
  if (provedor === "whatsapp") {
    await enviarCodigoAcesso(telefone, codigo);
    return;
  }
  throw new Error(`OTP_PROVIDER desconhecido: ${provedor}`);
}

export type Area = "equipe" | "cliente";

/**
 * Gera e envia um codigo de 6 digitos. Na area da equipe so envia para usuarios
 * cadastrados; na área do cliente também atende à confirmação do cadastro novo.
 * A resposta é sempre a mesma (não revela quem está
 * cadastrado). Em modo de teste local, devolve o codigo gerado.
 */
export async function solicitarCodigo(telefone: string, area: Area = "equipe", finalidade: FinalidadeCodigo = "acesso"): Promise<string | null> {
  const agora = Date.now();
  const teste = modoCodigoNaTela();
  const codigo = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-telefone:${telefone}`}))`;
    const recentes = await tx.codigoLogin.findMany({
      where: { telefone, criadoEm: { gte: new Date(agora - 60 * 60_000) } },
      orderBy: { criadoEm: "desc" },
    });
    if (!teste && recentes[0] && agora - recentes[0].criadoEm.getTime() < ESPERA_REENVIO_MS) {
      throw new ErroNegocio("Aguarde um minuto para pedir outro código.", 429, "aguarde");
    }
    if (!teste && recentes.length >= MAX_CODIGOS_HORA) {
      throw new ErroNegocio("Muitos códigos pedidos. Tente de novo mais tarde.", 429, "limite");
    }

    const usuario = await tx.usuario.findUnique({ where: { telefone }, include: { cliente: { select: { excluidoEm: true } } } });
    if (usuario && !usuario.ativo) return null;
    if (!usuario && area === "equipe") return null;
    if (finalidade === "recuperacao" && (usuario?.papel !== "CLIENTE" || !usuario.cliente || usuario.cliente.excluidoEm)) return null;

    const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
    // Invalida todos os anteriores, incluindo códigos de outra finalidade. Datas
    // estritamente crescentes evitam empates em reenvios locais/concorrentes.
    await tx.codigoLogin.updateMany({ where: { telefone, usadoEm: null }, data: { usadoEm: new Date(agora) } });
    await tx.codigoLogin.create({
      data: { telefone, codigoHash: hash(telefone, codigo, finalidade), expiraEm: new Date(agora + VALIDADE_MS),
        criadoEm: new Date(Math.max(agora, (recentes[0]?.criadoEm.getTime() ?? 0) + 1)) },
    });
    return codigo;
  });
  if (!codigo) return null;
  await entregar(telefone, codigo);
  return teste ? codigo : null;
}

const incluir = { barbeiro: { select: { id: true, ativo: true } }, cliente: { select: { id: true } } } as const;

/**
 * Login comum só cria acesso para uma ficha existente. Criar ficha nova é uma
 * opção interna exclusiva dos fluxos que já validaram o cadastro completo.
 */
export async function verificarCodigo(telefone: string, codigo: string, area: Area = "equipe", finalidade: FinalidadeCodigo = "acesso", opcoes: { permitirNovoCadastro?: boolean } = {}) {
  const invalido = new ErroNegocio("Código inválido ou expirado.", 401, "codigo_invalido");
  const consumiu = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-telefone:${telefone}`}))`;
    const reg = await tx.codigoLogin.findFirst({
      where: { telefone },
      orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
    });
    if (!reg || reg.usadoEm || reg.expiraEm.getTime() <= Date.now() || reg.tentativas >= MAX_TENTATIVAS) return false;

    const esperado = Buffer.from(reg.codigoHash, "hex");
    const recebido = Buffer.from(hash(telefone, codigo, finalidade), "hex");
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) {
      await tx.codigoLogin.update({ where: { id: reg.id }, data: { tentativas: { increment: 1 } } });
      return false; // O erro fica fora da transação para não desfazer a tentativa.
    }

    const consumo = await tx.codigoLogin.updateMany({
      where: { id: reg.id, usadoEm: null, expiraEm: { gt: new Date() }, tentativas: { lt: MAX_TENTATIVAS } },
      data: { usadoEm: new Date() },
    });
    return consumo.count === 1;
  });
  if (!consumiu) throw invalido;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-telefone:${telefone}`}))`;
    let usuario = await tx.usuario.findUnique({ where: { telefone }, include: incluir });
    if (usuario) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${usuario.id}`}))`;
      usuario = await tx.usuario.findUniqueOrThrow({ where: { id: usuario.id }, include: incluir });
      if (!usuario.ativo) throw invalido;
      if (finalidade === "recuperacao") {
        if (usuario.papel !== "CLIENTE" || !usuario.cliente) throw invalido;
        const cliente = await tx.cliente.findUnique({ where: { id: usuario.cliente.id } });
        if (!cliente || cliente.excluidoEm) throw invalido;
      }
      // A prova do celular nunca altera credenciais nem permissões da equipe.
      if (usuario.papel !== "CLIENTE") return usuario;
      if (!usuario.telefoneVerificadoEm) {
        // Cadastros legados podiam criar senha sem comprovar o número. A primeira
        // prova remove essas credenciais e revoga inclusive sessões já emitidas.
        await tx.identidadeSocial.deleteMany({ where: { usuarioId: usuario.id } });
        usuario = await tx.usuario.update({ where: { id: usuario.id }, data: {
          telefoneVerificadoEm: new Date(), senhaHash: null, trocarSenha: false,
          senhaFalhas: 0, bloqueadoAte: null, sessaoVersao: { increment: 1 },
        }, include: incluir });
        await auditar(tx, usuario.id, "cliente_confirmar_celular", "usuario", usuario.id, { revogouCredenciaisLegadas: true });
      }
      if (usuario.cliente) return usuario;
    } else {
      if (area !== "cliente" || finalidade === "recuperacao") throw invalido;
      const cliente = await tx.cliente.findUnique({ where: { telefone } });
      if (cliente?.usuarioId || cliente?.excluidoEm) throw invalido;
      if (!cliente && !opcoes.permitirNovoCadastro) {
        throw new ErroNegocio("Para criar sua conta, preencha o cadastro completo e solicite um novo código de confirmação.", 409, "cadastro_necessario");
      }
      usuario = await tx.usuario.create({ data: { telefone, nome: cliente?.nome ?? "", papel: "CLIENTE", telefoneVerificadoEm: new Date() }, include: incluir });
    }
    const cliente = await tx.cliente.findUnique({ where: { telefone } });
    if (cliente?.excluidoEm || (cliente?.usuarioId && cliente.usuarioId !== usuario.id)) throw invalido;
    await tx.cliente.upsert({ where: { telefone }, create: { telefone, nome: usuario.nome, usuarioId: usuario.id }, update: { usuarioId: usuario.id } });
    return tx.usuario.findUniqueOrThrow({ where: { id: usuario.id }, include: incluir });
  });
}
