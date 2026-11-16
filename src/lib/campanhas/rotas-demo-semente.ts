import { CANAIS, criarRota, registrarJornada, type Canal, type DadosRotas, type Rota } from "./rotas-demo";

function exemplo(canal: Canal, id: string, campanha: string) {
  const base = CANAIS[canal];
  return criarRota({
    id, nome: base.nome, canal,
    utm: { source: base.fonte, medium: base.midia, campaign: campanha },
    destino: "https://exemplo.test/agendar",
  });
}

function amostra(rota: Rota, entradas: number, conversas: number, vendas: number, primeiro: number) {
  const data = Date.parse("2026-11-16T14:00:00-03:00");
  const conversa = rota.etapas.find((etapa) => etapa.tipo === "direct" || etapa.tipo === "whatsapp")?.id ?? "";
  const link = rota.etapas.find((etapa) => etapa.tipo === "link")?.id ?? conversa;
  const venda = rota.etapas.find((etapa) => etapa.tipo === "venda")?.id ?? "";
  return Array.from({ length: entradas }, (_, i) => {
    const n = primeiro + i;
    const fim = i < vendas ? venda : i < conversas ? (i % 2 ? link : conversa) : "";
    return registrarJornada(rota, fim, {
      id: `demo-${n}`,
      nome: `Cliente teste ${String(n).padStart(3, "0")}`,
      instante: data - i * 47 * 60_000 - primeiro * 60_000,
      amostra: true,
    });
  });
}

const instagram = exemplo("instagramAds", "instagram-ads", "primeiro-corte");
const chatgpt = exemplo("chatgpt", "chatgpt-ads", "piloto-chatgpt");
const organico = exemplo("instagramOrganico", "instagram-organico", "perfil-black");

export const DADOS_DEMO_ROTAS: DadosRotas = {
  rotas: [instagram, chatgpt, organico],
  jornadas: [...amostra(instagram, 92, 54, 18, 1), ...amostra(organico, 36, 22, 6, 93)]
    .sort((a, b) => b.instante - a.instante),
};
