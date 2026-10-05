import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { mascararCpf } from "@/lib/assinaturas/regras";
import { assinar, cancelar, entrarNaListaDeEspera, situacaoDoCliente, vagasRestantes } from "@/lib/assinaturas/servico";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { MOTIVOS_CANCELAMENTO } from "@/lib/assinaturas/schemas";

/** Planos disponiveis e a assinatura atual do cliente. */
export const GET = rota(async () => {
  const s = await exigirCliente();
  const [sit, planos, cliente, espera] = await Promise.all([
    situacaoDoCliente(s.clienteId),
    db.plano.findMany({
      where: { ativo: true },
      orderBy: [{ ordem: "asc" }, { precoCentavos: "asc" }],
      include: { servicos: { include: { servico: { select: { nome: true } } } } },
    }),
    db.cliente.findUniqueOrThrow({ where: { id: s.clienteId }, select: { cpf: true, email: true } }),
    db.listaEsperaPlano.findMany({ where: { clienteId: s.clienteId }, select: { planoId: true } }),
  ]);
  return NextResponse.json({
    atual: sit && {
      id: sit.assinatura.id,
      status: sit.assinatura.status,
      valida: sit.valida,
      plano: { id: sit.assinatura.plano.id, nome: sit.assinatura.plano.nome },
      precoCentavos: sit.assinatura.precoCentavos,
      formaPagamento: sit.assinatura.formaPagamento,
      proximoVencimento: sit.assinatura.proximoVencimento,
      cobrancaEmAberto: sit.cobrancaEmAberto && {
        valorCentavos: sit.cobrancaEmAberto.valorCentavos,
        vencimento: sit.cobrancaEmAberto.vencimento,
        status: sit.cobrancaEmAberto.status,
        link: sit.cobrancaEmAberto.link,
      },
    },
    planos: await Promise.all(
      planos.map(async (p) => ({
        id: p.id, nome: p.nome, descricao: p.descricao, precoCentavos: p.precoCentavos,
        intervaloMinDias: p.intervaloMinDias, diasSemana: p.diasSemana, descontoExtrasPct: p.descontoExtrasPct,
        formasPagamento: p.formasPagamento,
        servicos: p.servicos.map((x) => ({ nome: x.servico.nome, usosPorCiclo: x.usosPorCiclo })),
        vagasRestantes: await vagasRestantes(p),
        naListaDeEspera: espera.some((e) => e.planoId === p.id),
      })),
    ),
    cpfCadastrado: mascararCpf(cliente.cpf),
    emailCadastrado: cliente.email,
    motivosCancelamento: MOTIVOS_CANCELAMENTO,
  });
});

/** Assinar (ou entrar na lista de espera se o plano estiver lotado). */
export const POST = rota(async (req: Request) => {
  const s = await exigirCliente();
  const b = await corpo(
    req,
    z.object({
      planoId: z.string(),
      forma: z.enum(["CARTAO", "PIX", "BOLETO"]).optional(),
      cpf: z.string().max(20).optional(),
      email: z.string().trim().max(120).optional(),
      listaDeEspera: z.boolean().optional(),
    }),
  );
  if (b.listaDeEspera) {
    const posicao = await entrarNaListaDeEspera(s.clienteId, b.planoId);
    return NextResponse.json({ listaDeEspera: true, posicao });
  }
  if (!b.forma) throw new ErroNegocio("Escolha a forma de pagamento.", 400);
  const r = await assinar({ clienteId: s.clienteId, planoId: b.planoId, forma: b.forma, cpf: b.cpf, email: b.email || undefined, origem: "SITE", usuarioId: s.usuarioId });
  return NextResponse.json({ link: r.link }, { status: 201 });
});

/** Cancelar pelo site (motivo obrigatorio: ajuda a barbearia a entender a saida). */
export const DELETE = rota(async (req: Request) => {
  const s = await exigirCliente();
  const b = await corpo(req, z.object({ motivo: z.enum(MOTIVOS_CANCELAMENTO), detalhe: z.string().trim().max(200).optional() }));
  const sit = await situacaoDoCliente(s.clienteId);
  if (!sit) throw new ErroNegocio("Você não tem assinatura ativa.", 404);
  await cancelar(sit.assinatura.id, b.detalhe ? `${b.motivo}: ${b.detalhe}` : b.motivo, s.usuarioId);
  return NextResponse.json({ ok: true });
});
