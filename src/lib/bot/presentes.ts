import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";

/** Consulta somente os direitos já registrados para o telefone desta conversa. Não joga nem concede prêmio. */
export async function presentesDaConversa(telefone: string, agora = Date.now()) {
  const cliente = await db.cliente.findUnique({ where: { telefone }, select: { id: true, excluidoEm: true } });
  if (!cliente || cliente.excluidoEm) return { premios: [], convite: null, orientacao: "Nenhum presente confirmado para este contato. Não prometa prêmio nem peça novo cadastro só para consultar." };
  const [premios, convite] = await Promise.all([
    db.premioGanho.findMany({
      where: { clienteId: cliente.id }, orderBy: { criadoEm: "desc" }, take: 10,
      select: { rotulo: true, codigo: true, status: true, expiraEm: true, agendamentoId: true },
    }),
    db.campanhaEnvio.findFirst({
      where: { clienteId: cliente.id, status: "ENVIADO", token: { not: null }, campanha: { status: "ATIVA", jogoId: { not: null } } },
      orderBy: { enviadoEm: "desc" },
      select: { token: true, jogadaId: true, enviadoEm: true, campanha: { select: { nome: true, jogo: { select: { ativo: true, inicioEm: true, fimEm: true, validadeDias: true } } } } },
    }),
  ]);
  const jogo = convite?.campanha.jogo;
  const valido = convite && jogo?.ativo && (!jogo.inicioEm || +jogo.inicioEm <= agora) && (!jogo.fimEm || +jogo.fimEm >= agora)
    && convite.enviadoEm && +convite.enviadoEm + jogo.validadeDias * 86_400_000 >= agora;
  return {
    premios: premios.map(p => ({ ...p, status: p.expiraEm && +p.expiraEm < agora && ["DISPONIVEL", "RESERVADO"].includes(p.status) ? "EXPIRADO" : p.status })),
    convite: convite && valido && convite.token ? { campanha: convite.campanha.nome, link: `${urlSite()}/c/r/${convite.token}`, ja_jogou: !!convite.jogadaId } : null,
    link_meus_premios: `${urlSite()}/c/premios`,
    orientacao: "Informe somente o prêmio e o estado retornados. Reservado não é resgatado. Confira validade e condições na tela Meus prêmios; a consulta não reserva nem agenda. Não solicite instalar o app ou ativar notificações para reconhecer um prêmio existente.",
  };
}
