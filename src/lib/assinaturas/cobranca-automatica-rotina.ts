import { db } from "@/lib/db";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { horarioComercial } from "@/lib/automacoes/regras";
import { gatewayPorId, type CobrancaGateway } from "@/lib/pagamentos/gateway";
import { notificarCliente } from "@/lib/whatsapp/conversas";
import { despacharCobrancaAutomatica, marcarEnviosInterrompidosIncertos, prepararCobrancaAutomatica } from "./cobranca-automatica";
import { linkAbsoluto } from "./cobrancas";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";

type DadosEnvio = { telefone: string; nome: string; plano: string; link: string; valorCentavos: number; vencimento: string };
type Dependencias = { enviar: (dados: DadosEnvio) => Promise<{ idProvedor: string | null }>; consultar: (id: string) => Promise<CobrancaGateway> };

/** O ID externo só prova aceitação pelo provedor, não entrega. */
async function enviarWhatsApp(d: DadosEnvio) {
  const valor = (d.valorCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const link = linkAbsoluto(d.link);
  if (!link) throw new Error("Link indisponível.");
  const resultado = await notificarCliente(d.telefone, `Oi, ${d.nome.trim().split(/\s+/)[0] || "tudo bem"}! Consta uma mensalidade de ${valor} do ${d.plano}, com vencimento em ${d.vencimento.split("-").reverse().join("/")}. Se já pagou, desconsidere. Link: ${link}. Qualquer dúvida, responda por aqui.`);
  if (!resultado.ok) return { idProvedor: null };
  const mensagem = await db.mensagem.findUnique({ where: { id: resultado.mensagemId }, select: { wamid: true } });
  return { idProvedor: mensagem?.wamid ?? null };
}

/** Não há backlog implícito: exige data inicial definida e nunca roda com o legado ativado. */
export async function processarCobrancasAutomaticas(agora = new Date(), deps?: Dependencias) {
  if (quarentenaRestauracao() || process.env.COBRANCA_AUTOMATICA_WHATSAPP_ATIVA !== "true" || process.env.COBRANCA_LEGADA_WHATSAPP_ATIVA === "true") return { processadas: 0 };
  const desde = process.env.COBRANCA_AUTOMATICA_DESDE ?? "";
  const inicio = new Date(`${desde}T00:00:00Z`);
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$/.test(desde) || !Number.isFinite(+inicio) || inicio.toISOString().slice(0, 10) !== desde) return { processadas: 0 };
  await marcarEnviosInterrompidosIncertos(new Date(+agora - 10 * 60_000));
  const cfg = await configuracao();
  if (!horarioComercial(+agora, cfg.fuso)) return { processadas: 0 };
  const hoje = dataLocal(+agora, cfg.fuso);
  if (desde > hoje) return { processadas: 0 };
  const clientes = new Set<string>();
  const usar = deps ?? { enviar: enviarWhatsApp, consultar: async (id: string) => (await gatewayPorId(id)).buscarCobranca(id) };
  let processadas = 0;
  let cursor: string | undefined;
  while (clientes.size < 10) {
    const cobrancas: { id: string; assinatura: { clienteId: string } }[] = await db.cobranca.findMany({ where: { status: { in: ["PENDENTE", "ATRASADA"] },
      vencimento: { gte: inicio, lte: new Date(`${hoje}T00:00:00Z`) },
      assinatura: { status: { not: "CANCELADA" }, cliente: { aceitaMensagens: true, excluidoEm: null } },
      vinculosExternos: { none: {} },
      tentativasAutomaticas: { none: { canal: "WHATSAPP", etapa: "PRIMEIRO_AVISO", estado: { not: "PREPARADA" } } },
    }, orderBy: [{ vencimento: "asc" }, { id: "asc" }], take: 50, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, assinatura: { select: { clienteId: true } } } });
    if (!cobrancas.length) break;
    cursor = cobrancas[cobrancas.length - 1].id;
    for (const c of cobrancas) {
      if (clientes.has(c.assinatura.clienteId)) continue;
      const r = await prepararCobrancaAutomatica(c.id, agora);
      if ("tentativa" in r && r.tentativa?.estado === "PREPARADA") {
        clientes.add(c.assinatura.clienteId);
        await despacharCobrancaAutomatica(r.tentativa.id, usar.enviar, usar.consultar, agora);
        processadas++;
      }
      if (clientes.size >= 10) break;
    }
    if (cobrancas.length < 50) break;
  }
  return { processadas };
}
