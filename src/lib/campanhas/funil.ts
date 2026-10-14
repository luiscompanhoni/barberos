/**
 * Funil de uma campanha: do WhatsApp ao caixa. Para cada mensagem enviada: entregue, lida, abriu o link, girou e ganhou
 * (roleta), abriu o app, tem conta, agendou (ate 14 dias depois de receber), compareceu, resgatou o premio e quanto
 * deixou nas comandas desses atendimentos.
 */
import { resumoComanda } from "@/lib/comandas/regras";
import { db } from "@/lib/db";
import { naoEncontrado } from "@/lib/erros";
import { DIAS_RESULTADO } from "./servico";
import { montarFunil, type LinhaFunil } from "./regras";

const DIA = 86_400_000;

export async function funilCampanha(campanhaId: string) {
  const c = await db.campanha.findUnique({ where: { id: campanhaId }, select: { id: true, nome: true, roleta: true } });
  if (!c) throw naoEncontrado("Campanha");
  const envios = await db.campanhaEnvio.findMany({
    where: { campanhaId, status: "ENVIADO", enviadoEm: { not: null } },
    select: {
      clienteId: true, enviadoEm: true, clicouEm: true, appAbertoEm: true,
      mensagem: { select: { wamid: true, entregueEm: true, lidaEm: true } },
      giro: { select: { tipo: true, status: true, beneficioId: true, entregueEm: true } },
      cliente: { select: { usuario: { select: { criadoEm: true } } } },
    },
  });
  const ids = envios.map((e) => e.clienteId);
  const primeiro = envios.reduce((m, e) => Math.min(m, +e.enviadoEm!), Infinity);

  // Atendimentos marcados depois de receber (janela igual a das campanhas).
  const ags = envios.length
    ? await db.agendamento.findMany({ where: { clienteId: { in: ids }, criadoEm: { gt: new Date(primeiro) } }, select: { id: true, clienteId: true, criadoEm: true, status: true } })
    : [];
  const daCampanha = new Map<string, typeof ags>();
  for (const e of envios) {
    const de = +e.enviadoEm!, ate = de + DIAS_RESULTADO * DIA;
    daCampanha.set(e.clienteId, ags.filter((a) => a.clienteId === e.clienteId && +a.criadoEm > de && +a.criadoEm <= ate));
  }

  // Premio da roleta usado: credito gasto (inteiro ou em parte) ou brinde retirado.
  const beneficios = envios.map((e) => e.giro?.beneficioId).filter((x): x is string => !!x);
  const usados = new Set(
    beneficios.length
      ? (await db.beneficio.findMany({
          where: { status: "USADO", OR: [{ id: { in: beneficios } }, { origemBeneficioId: { in: beneficios } }] },
          select: { id: true, origemBeneficioId: true },
        })).map((b) => b.origemBeneficioId ?? b.id)
      : [],
  );

  // Faturado: comandas fechadas dos atendimentos que vieram da campanha (o que ficou com a barbearia).
  const agIds = [...daCampanha.values()].flat().map((a) => a.id);
  const comandaIds = agIds.length ? [...new Set((await db.itemComanda.findMany({ where: { agendamentoId: { in: agIds } }, select: { comandaId: true } })).map((i) => i.comandaId))] : [];
  const comandas = comandaIds.length
    ? await db.comanda.findMany({ where: { id: { in: comandaIds }, status: "FECHADA" }, include: { itens: true, pagamentos: true } })
    : [];
  const faturadoCentavos = comandas.reduce((t, cm) => t + resumoComanda(cm.itens, cm.pagamentos, cm.descontoCentavos).pago, 0);

  const linhas: LinhaFunil[] = envios.map((e) => {
    const seus = daCampanha.get(e.clienteId) ?? [];
    const g = e.giro;
    const usuario = e.cliente.usuario;
    return {
      entregue: !!(e.mensagem?.entregueEm || e.mensagem?.lidaEm), lida: !!e.mensagem?.lidaEm, clicou: !!e.clicouEm,
      girou: !!g, ganhou: !!g && g.tipo !== "NADA", app: !!e.appAbertoEm,
      conta: !!usuario, contaNova: !!usuario && usuario.criadoEm > e.enviadoEm!,
      agendou: seus.length > 0, compareceu: seus.some((a) => a.status === "CONCLUIDO"),
      resgatou: !!g && (g.tipo === "CREDITO" ? !!g.beneficioId && usados.has(g.beneficioId) : g.tipo === "BRINDE" && !!g.entregueEm),
    };
  });
  const compareceram = linhas.filter((l) => l.compareceu).length;
  return {
    campanha: c,
    etapas: montarFunil(linhas, { roleta: c.roleta, statusDisponivel: envios.some((e) => !!e.mensagem?.wamid) }),
    faturadoCentavos,
    comandas: comandas.length,
    ticketMedioCentavos: compareceram ? Math.round(faturadoCentavos / compareceram) : null,
    janelaDias: DIAS_RESULTADO,
  };
}
export type Funil = Awaited<ReturnType<typeof funilCampanha>>;
