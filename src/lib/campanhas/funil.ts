/**
 * Funil de uma campanha: do WhatsApp ao caixa. Para cada mensagem enviada: entregue, lida, abriu o link, jogou e ganhou
 * (campanha com jogo), abriu o app, tem conta, agendou (ate 14 dias depois de receber), compareceu, resgatou o premio e quanto
 * deixou nas comandas desses atendimentos.
 */
import { resumoComanda } from "@/lib/comandas/regras";
import { db } from "@/lib/db";
import { naoEncontrado } from "@/lib/erros";
import { DIAS_RESULTADO, resultadosAtribuidos } from "./atribuicao";
import { montarFunil, type LinhaFunil } from "./regras";

export async function funilCampanha(campanhaId: string) {
  const c = await db.campanha.findUnique({ where: { id: campanhaId }, select: { id: true, nome: true, jogo: { select: { nome: true } } } });
  if (!c) throw naoEncontrado("Campanha");
  const envios = await db.campanhaEnvio.findMany({
    where: { campanhaId, status: "ENVIADO" },
    select: {
      clienteId: true, enviadoEm: true, clicouEm: true, appAbertoEm: true,
      mensagem: { select: { criadoEm: true, erro: true, wamid: true, entregueEm: true, lidaEm: true } },
      jogada: { select: { vitoria: true, premios: { select: { tipo: true, status: true, beneficioId: true } } } },
      cliente: { select: { usuario: { select: { criadoEm: true } } } },
    },
  });
  const reservas = envios.length ? await resultadosAtribuidos(campanhaId) : [];
  const marcados = new Set(reservas.map(r => r.clienteId));
  const atendidos = new Set(reservas.filter(r => r.status === "CONCLUIDO").map(r => r.clienteId));

  // Premio do jogo usado: credito gasto (inteiro ou em parte) ou premio validado na barbearia.
  const beneficios = envios.flatMap((e) => e.jogada?.premios.map((p) => p.beneficioId) ?? []).filter((x): x is string => !!x);
  const usados = new Set(
    beneficios.length
      ? (await db.beneficio.findMany({
          where: { status: "USADO", OR: [{ id: { in: beneficios } }, { origemBeneficioId: { in: beneficios } }] },
          select: { id: true, origemBeneficioId: true },
        })).map((b) => b.origemBeneficioId ?? b.id)
      : [],
  );

  // Faturado: comandas fechadas dos atendimentos que vieram da campanha (o que ficou com a barbearia).
  const comandaIds = reservas.flatMap(r => r.comandaId ? [r.comandaId] : []);
  const comandas = comandaIds.length
    ? await db.comanda.findMany({ where: { id: { in: comandaIds }, status: "FECHADA" }, include: { itens: true, pagamentos: true } })
    : [];
  const faturadoCentavos = comandas.reduce((total, cm) => {
    const { pago, troco } = resumoComanda(cm.itens, cm.pagamentos, cm.descontoCentavos);
    return total + (pago - troco);
  }, 0);

  const linhas: LinhaFunil[] = envios.map((e) => {
    const g = e.jogada;
    const usuario = e.cliente.usuario;
    const instante = e.mensagem && e.mensagem.erro === null ? Math.max(+e.mensagem.criadoEm, e.enviadoEm?.getTime() ?? -Infinity) : null;
    return {
      enviada: instante !== null,
      entregue: !!(e.mensagem?.entregueEm || e.mensagem?.lidaEm), lida: !!e.mensagem?.lidaEm, clicou: !!e.clicouEm,
      girou: !!g, ganhou: !!g?.vitoria, app: instante !== null && !!e.appAbertoEm && +e.appAbertoEm >= instante,
      conta: instante !== null && !!usuario, contaNova: instante !== null && !!usuario && +usuario.criadoEm > instante,
      agendou: marcados.has(e.clienteId), compareceu: atendidos.has(e.clienteId),
      resgatou: !!g?.premios.some((p) => (p.tipo === "CREDITO" ? !!p.beneficioId && usados.has(p.beneficioId) : p.status === "UTILIZADO")),
    };
  });
  const compareceram = linhas.filter((l) => l.compareceu).length;
  return {
    campanha: c,
    etapas: montarFunil(linhas, { jogo: c.jogo?.nome ?? null, statusDisponivel: envios.some((e) => !!e.mensagem?.wamid) }),
    faturadoCentavos,
    comandas: comandas.length,
    ticketMedioCentavos: compareceram ? Math.round(faturadoCentavos / compareceram) : null,
    janelaDias: DIAS_RESULTADO,
  };
}
export type Funil = Awaited<ReturnType<typeof funilCampanha>>;
