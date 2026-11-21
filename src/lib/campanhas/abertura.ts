import { setTimeout as esperar } from "node:timers/promises";
import { aberturaReativacao } from "@/lib/automacoes/regras";
import { db } from "@/lib/db";
import { dentroJanela24h, provedorWhatsApp, temJanela24h, type TemplateWhatsApp } from "@/lib/whatsapp/canal";
import { enviarNaConversa, obterConversa } from "@/lib/whatsapp/conversas";
import { naFila } from "@/lib/whatsapp/fila-conversa";
import { campanhasBloqueadas } from "./bloqueio";
import { impedimentoCampanha } from "./contato";
import type { LoteAutorizado } from "./lote-autorizado";
import { migracaoDoCliente } from "./reservar-contato";

function modelosDaAbertura(nome: string): [TemplateWhatsApp, TemplateWhatsApp] {
  const saudacao = process.env.WHATSAPP_TEMPLATE_CAMPANHA_SAUDACAO?.trim();
  const apresentacao = process.env.WHATSAPP_TEMPLATE_CAMPANHA_APRESENTACAO?.trim();
  if (!saudacao || !apresentacao || saudacao === apresentacao) {
    throw new Error("Configure os dois modelos distintos e aprovados de abertura da campanha.");
  }
  return [
    { nome: saudacao, parametros: [nome.trim().split(/\s+/)[0] || "tudo bem"] },
    { nome: apresentacao, parametros: [] },
  ];
}

export function enviarAberturaCampanha(
  envio: { id: string; campanhaId: string; clienteId: string },
  destino: { nome: string; telefone: string },
  autorizado: LoteAutorizado | null,
) {
  return naFila(destino.telefone, async () => {
    const conversa = await obterConversa(destino.telefone);
    const modelos = temJanela24h() && !dentroJanela24h(conversa.ultimaEntradaEm) ? modelosDaAbertura(destino.nome) : null;
    const abertura = aberturaReativacao(destino.nome);
    for (const etapa of [0, 1] as const) {
      if (etapa === 1 && provedorWhatsApp() !== "simulador") await esperar(2000);
      const [atual, campanha] = await Promise.all([
        db.cliente.findUnique({
          where: { id: envio.clienteId },
          select: { telefone: true, aceitaMensagens: true, excluidoEm: true, conversa: { select: { estado: true, recusaAutomaticas: true } }, assinaturas: migracaoDoCliente,
            agendamentos: { where: { status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(Date.now()) } }, take: 1, select: { id: true } } },
        }),
        db.campanha.findUnique({ where: { id: envio.campanhaId }, select: { status: true } }),
      ]);
      if (!atual || atual.telefone !== destino.telefone || conversa.clienteId !== envio.clienteId ||
        impedimentoCampanha(atual, atual.agendamentos.length > 0) || campanha?.status !== "ATIVA" ||
        (!autorizado && await campanhasBloqueadas())) throw new Error("A abertura da campanha foi interrompida.");
      const r = await enviarNaConversa(conversa.id, abertura[etapa], "SISTEMA", {
        campanha: true, pararSeHumano: true, templateAberturaCampanha: modelos?.[etapa],
        aberturaLote: autorizado ? { envioId: envio.id, etapa } : undefined,
      });
      if (!r.ok || (!r.wamid && provedorWhatsApp() !== "simulador")) throw new Error(r.erro ?? "O canal não confirmou o balão.");
      const agora = new Date(Date.now());
      await db.campanhaEnvio.update({ where: { id: envio.id }, data: {
        mensagemId: r.mensagemId,
        ...(etapa === 1 ? { aberturaConcluidaEm: agora, enviadoEm: agora } : {}),
      } });
    }
  });
}
