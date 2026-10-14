/**
 * Link rastreado das campanhas (/c/r/<token>): o que a pagina mostra, o clique e o "abriu o app" depois de receber.
 * Sem login: o token (aleatorio, um por mensagem) identifica o cliente so para isso.
 */
import { configuracao } from "@/lib/agenda/carregar";
import { db } from "@/lib/db";
import { configRoleta, multiplicadorDoCliente } from "@/lib/roleta/servico";

const DIA = 86_400_000;
/** "Abriu o app" conta ate 14 dias depois de receber (mesma janela do "marcou depois" das campanhas). */
const JANELA_APP_DIAS = 14;

/** Dados da pagina do link, ou null se o link nao existe (ou a mensagem ainda nao saiu). */
export async function landingDaCampanha(token: string) {
  const envio = await db.campanhaEnvio.findUnique({
    where: { token },
    include: { campanha: { select: { roleta: true } }, cliente: { select: { id: true, nome: true } }, giro: true },
  });
  if (!envio || envio.status !== "ENVIADO") return null;
  const cfg = await configuracao();
  const base = { nome: envio.cliente.nome.trim().split(/\s+/)[0] || "", barbearia: cfg.nomeBarbearia };
  if (!envio.campanha.roleta) return { ...base, roleta: null };

  const roleta = await configRoleta();
  const premios = await db.roletaPremio.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] });
  const vencido = !!envio.enviadoEm && +envio.enviadoEm + roleta.validadeDias * DIA < Date.now();
  return {
    ...base,
    roleta: {
      ativa: roleta.ativa,
      vencido: !envio.giro && vencido,
      multiplicador: await multiplicadorDoCliente(envio.cliente.id),
      premios: premios.map((p) => ({ id: p.id, rotulo: p.rotulo, cor: p.cor, tipo: p.tipo, valorCentavos: p.valorCentavos })),
      // Ja girou: a pagina mostra o premio que saiu (abrir o link de novo nao gira outra vez).
      giro: envio.giro ? { premioId: envio.giro.premioId, rotulo: envio.giro.rotulo, tipo: envio.giro.tipo, valorCentavos: envio.giro.tipo === "CREDITO" ? envio.giro.valorCentavos : 0 } : null,
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
