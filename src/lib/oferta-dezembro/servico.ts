import { createHash } from "node:crypto";
import type { z } from "zod";
import { travarClienteAgenda, type TitularAgenda } from "@/lib/agenda/cliente-identidade";
import { auditar, origemDaRequisicao } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { vagasRestantes } from "@/lib/assinaturas/vagas";
import { lerConfigOfertaDezembro, ofertaDezembroEmHomologacao } from "./config";
import { consultarInelegibilidadeDezembro, consultarPlanoBaseDezembro } from "./consulta";
import { adesaoNoPeriodo, INICIO_GRATIS_DEZEMBRO } from "./regras";
import { CARTAO_DEZEMBRO_APROVADO, schemaAdesaoDezembro } from "./schemas";

export type TitularOfertaDezembro = TitularAgenda & { clienteId: string };

const ofertaIndisponivel = () => new ErroNegocio("A oferta está indisponível no momento.", 404, "oferta_indisponivel");

export async function aderirOfertaDezembro(titular: TitularOfertaDezembro, entrada: z.input<typeof schemaAdesaoDezembro>, agora = new Date()) {
  if (!ofertaDezembroEmHomologacao()) throw ofertaIndisponivel();
  const proposta = schemaAdesaoDezembro.parse(entrada);
  const { clienteId, usuarioId } = titular;
  const chaveIdempotencia = createHash("sha256").update(JSON.stringify([clienteId, proposta.chave.toLowerCase()])).digest("hex");
  const origem = await origemDaRequisicao();
  return db.$transaction(async tx => {
    await travarClienteAgenda(tx, clienteId, titular);
    await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${clienteId} FOR UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assinatura-cliente:${clienteId}`}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${clienteId}`}))`;

    const anterior = await tx.ofertaDezembroAdesao.findUnique({
      where: { chaveIdempotencia },
      select: { assinaturaId: true, precoCentavos: true, limiteUsos: true, assinatura: { select: { clienteId: true, planoId: true } } },
    });
    if (anterior) {
      if (anterior.assinatura.clienteId !== clienteId || anterior.assinatura.planoId !== proposta.planoId ||
        anterior.precoCentavos !== proposta.precoCentavos || anterior.limiteUsos !== proposta.limiteUsos ||
        proposta.cartaoToken !== CARTAO_DEZEMBRO_APROVADO) {
        throw new ErroNegocio("As condições da tentativa anterior são diferentes. Atualize a página.", 409, "adesao_divergente");
      }
      return { assinaturaId: anterior.assinaturaId, repetida: true };
    }

    const cfg = lerConfigOfertaDezembro();
    if (!cfg || !adesaoNoPeriodo(agora)) throw ofertaIndisponivel();
    const inelegivel = await consultarInelegibilidadeDezembro(tx, clienteId, agora);
    if (inelegivel) throw new ErroNegocio(inelegivel.mensagem, 409, inelegivel.codigo);

    // Cota da campanha antes da trava compartilhada com a compra do plano regular.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('oferta-dezembro-2026', 0))`;
    await tx.$queryRaw`SELECT id FROM planos WHERE id = ${cfg.planoId} FOR UPDATE`;
    const plano = await consultarPlanoBaseDezembro(tx, cfg.planoId);
    if (!plano) throw ofertaIndisponivel();
    if (proposta.planoId !== plano.id || proposta.precoCentavos !== plano.precoCentavos || proposta.limiteUsos !== cfg.limiteUsos) {
      throw new ErroNegocio("As condições da oferta mudaram. Atualize a página e confira o termo.", 409, "oferta_alterada");
    }
    const [ocupadas, vagasDoPlano] = await Promise.all([tx.ofertaDezembroAdesao.count(), vagasRestantes(plano, tx, agora)]);
    if (ocupadas >= cfg.vagas || vagasDoPlano === 0) throw new ErroNegocio("As vagas da oferta acabaram.", 409, "sem_vagas");

    // O simulador aceita exclusivamente os tokens fictícios da tela e não aciona um provedor.
    if (proposta.cartaoToken !== CARTAO_DEZEMBRO_APROVADO) {
      throw new ErroNegocio("O cartão de homologação foi recusado. Escolha outro cartão de teste.", 422, "cartao_recusado");
    }
    const assinatura = await tx.assinatura.create({
      data: {
        clienteId, planoId: plano.id, formaPagamento: "CARTAO", status: "ATIVA", precoCentavos: 0, origem: "SITE",
        criadaEm: agora, cicloInicio: new Date(INICIO_GRATIS_DEZEMBRO),
        ofertaDezembro: { create: {
          chaveIdempotencia, aceitaEm: agora, termosVersao: proposta.termosVersao,
          precoCentavos: plano.precoCentavos, limiteUsos: cfg.limiteUsos, ip: origem.ip, agenteUsuario: origem.dispositivo,
        } },
      },
      select: { id: true },
    });
    await auditar(tx, usuarioId, "aderir_oferta_dezembro", "assinatura", assinatura.id, {
      planoId: plano.id, precoCentavos: plano.precoCentavos, limiteUsos: cfg.limiteUsos, termosVersao: proposta.termosVersao,
    });
    return { assinaturaId: assinatura.id, repetida: false };
  });
}
