/**
 * Link rastreado das campanhas (/c/r/<token>): o que a pagina mostra, o clique e o "abriu o app" depois de receber.
 * Sem login: o token (aleatorio, um por mensagem) identifica o cliente so para isso.
 */
import { configuracao } from "@/lib/agenda/carregar";
import { situacaoDoCliente } from "@/lib/assinaturas/servico";
import { db } from "@/lib/db";
import { noAr, paraCliente } from "@/lib/jogos/motor";
import { multiplicador } from "@/lib/jogos/regras";

const DIA = 86_400_000;
/** "Abriu o app" conta ate 14 dias depois de receber (mesma janela do "marcou depois" das campanhas). */
const JANELA_APP_DIAS = 14;

/** Dados da pagina do link, ou null se o link nao existe (ou a mensagem ainda nao saiu). */
export async function landingDaCampanha(token: string) {
  const envio = await db.campanhaEnvio.findUnique({
    where: { token },
    include: {
      campanha: { include: { jogo: { include: { premios: { where: { ativo: true }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] } } } } },
      cliente: { select: { id: true, nome: true } },
      jogada: { include: { premios: { include: { agendamento: true } } } },
    },
  });
  if (!envio || envio.status !== "ENVIADO") return null;
  const cfg = await configuracao();
  const base = { nome: envio.cliente.nome.trim().split(/\s+/)[0] || "", barbearia: cfg.nomeBarbearia };
  const j = envio.campanha.jogo;
  if (!j) return { ...base, jogo: null };

  const sit = await situacaoDoCliente(envio.cliente.id);
  const vencido = +(envio.enviadoEm ?? envio.liberadoEm) + j.validadeDias * DIA < Date.now();
  return {
    ...base,
    jogo: {
      id: j.id, tipo: j.tipo, nome: j.nome, raridade: j.raridade, premiosPorJogada: j.premiosPorJogada,
      ativo: noAr(j),
      vencido: !envio.jogada && vencido,
      multiplicador: multiplicador(!!sit?.valida, j.bonusAssinantePct),
      fatias: j.tipo === "ROLETA" ? j.premios.map((p) => ({ id: p.id, rotulo: p.rotulo, cor: p.cor, icone: p.icone, tipo: p.tipo, raridade: p.raridade })) : [],
      vitrine: j.premios.filter((p) => p.tipo !== "NADA").map((p) => ({ id: p.id, rotulo: p.rotulo, tipo: p.tipo, raridade: p.raridade, icone: p.icone, cor: p.cor, chanceBps: p.chanceBps })),
      // Ja jogou: a pagina mostra o que saiu (abrir o link de novo nao joga outra vez).
      jogada: envio.jogada ? paraCliente(envio.jogada) : null,
    },
  };
}
export type Landing = NonNullable<Awaited<ReturnType<typeof landingDaCampanha>>>;

/** A pagina abriu num navegador (chamado pelo JavaScript da pagina: robo de previa de link nao conta). */
export async function registrarClique(token: string) {
  await db.campanhaEnvio.updateMany({ where: { token, status: "ENVIADO", clicouEm: null }, data: { clicouEm: new Date() } });
}

/** O cliente entrou na area do cliente: conta para as campanhas que ele recebeu nos ultimos 14 dias. */
export async function marcarAppAberto(clienteId: string, agora = Date.now()) {
  await db.campanhaEnvio.updateMany({
    where: { clienteId, status: "ENVIADO", appAbertoEm: null, enviadoEm: { gte: new Date(agora - JANELA_APP_DIAS * DIA), lte: new Date(agora) } },
    data: { appAbertoEm: new Date(agora) },
  });
}
