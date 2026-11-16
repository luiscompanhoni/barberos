import { z } from "zod";

export const CANAIS = {
  instagramAds: { nome: "Instagram Ads", tipo: "Tráfego pago", fonte: "instagram", midia: "paid_social" },
  chatgpt: { nome: "ChatGPT Ads", tipo: "Piloto de tráfego pago", fonte: "chatgpt", midia: "paid_ai" },
  instagramOrganico: { nome: "Instagram orgânico", tipo: "Perfil e Direct", fonte: "instagram", midia: "organic_social" },
  outra: { nome: "Outra origem", tipo: "Personalizada", fonte: "", midia: "" },
} as const;

export const ETAPAS = {
  criativo: { nome: "Criativo", responsavel: "Design", instrucao: "Preparar a arte da campanha e anexar a versão aprovada para o gestor de tráfego." },
  trafego: { nome: "Tráfego pago", responsavel: "Gestor de tráfego", instrucao: "Usar o criativo selecionado, definir público e orçamento e associar o link de destino da rota." },
  origem: { nome: "Origem", responsavel: "Marketing", instrucao: "Definir o ponto de entrada e como identificar a origem do contato." },
  whatsapp: { nome: "WhatsApp", responsavel: "Bot de atendimento", instrucao: "" },
  direct: { nome: "Direct", responsavel: "Atendimento", instrucao: "Oi, {{nome}}! Aqui é da {{barbearia}}. Posso te ajudar a escolher um serviço? Se quiser ver os horários, o link é {{link}}." },
  link: { nome: "Agendamento", responsavel: "Link rastreado", instrucao: "Compartilhar o link de destino da rota e registrar o clique." },
  venda: { nome: "Fechamento", responsavel: "Venda confirmada", instrucao: "Registrar a venda quando o cliente concluir a contratação." },
  relatorio: { nome: "Relatório", responsavel: "Métricas da rota", instrucao: "Revisar entradas, conversas e vendas por origem no fim da campanha." },
  tarefa: { nome: "Tarefa", responsavel: "", instrucao: "" },
} as const;

const utmSchema = z.object({ source: z.string(), medium: z.string(), campaign: z.string() });
const imagemSchema = z.object({ nome: z.string(), url: z.string().regex(/^data:image\/(png|jpeg|webp);base64,/) });
const tipoEtapa = z.enum(Object.keys(ETAPAS) as [keyof typeof ETAPAS, ...(keyof typeof ETAPAS)[]]);
const etapaSchema = z.object({
  id: z.string(),
  tipo: tipoEtapa,
  titulo: z.string(),
  responsavel: z.string(),
  instrucao: z.string(),
  modo: z.enum(["padrao", "personalizada"]),
  imagem: imagemSchema.nullable(),
});
const origemSchema = z.object({
  id: z.string(),
  nome: z.string(),
  canal: z.enum(Object.keys(CANAIS) as [keyof typeof CANAIS, ...(keyof typeof CANAIS)[]]),
  utm: utmSchema,
  destino: z.string(),
});
const rotaSchema = origemSchema.extend({ etapas: z.array(etapaSchema) });
const eventoSchema = z.object({
  tipo: z.enum(["entrada", "whatsapp", "direct", "link", "venda"]),
  titulo: z.string(),
  detalhe: z.string(),
});
const jornadaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  origem: origemSchema,
  instante: z.number(),
  amostra: z.boolean(),
  eventos: z.array(eventoSchema).min(1),
});
const dadosSchema = z.object({ rotas: z.array(rotaSchema).min(1), jornadas: z.array(jornadaSchema) });

export type Canal = keyof typeof CANAIS;
export type TipoEtapa = keyof typeof ETAPAS;
export type Etapa = z.infer<typeof etapaSchema>;
export type Origem = z.infer<typeof origemSchema>;
export type Rota = z.infer<typeof rotaSchema>;
export type Jornada = z.infer<typeof jornadaSchema>;
export type DadosRotas = z.infer<typeof dadosSchema>;
export type TipoEvento = z.infer<typeof eventoSchema>["tipo"];

const modelos: Record<Canal, TipoEtapa[]> = {
  instagramAds: ["criativo", "trafego", "whatsapp", "venda", "relatorio"],
  chatgpt: ["origem", "whatsapp", "venda", "relatorio"],
  instagramOrganico: ["origem", "direct", "link", "venda", "relatorio"],
  outra: ["origem"],
};

export const MENSAGEM_BOT_DEMO =
  "Oi, {{nome}}! Aqui é da {{barbearia}}. Quer ver os horários disponíveis para o seu próximo corte?";

export function criarEtapa(tipo: TipoEtapa, id: string): Etapa {
  const dados = ETAPAS[tipo];
  return {
    id, tipo, titulo: dados.nome, responsavel: dados.responsavel, instrucao: dados.instrucao,
    modo: tipo === "whatsapp" ? "padrao" : "personalizada", imagem: null,
  };
}

export function criarRota(origem: Origem): Rota {
  const etapas = modelos[origem.canal].map((tipo, i) => criarEtapa(tipo, `${origem.id}-${i}`));
  if (origem.canal === "instagramOrganico") {
    etapas[0].titulo = "Perfil Instagram";
    etapas[0].responsavel = "Orgânico";
    etapas[0].instrucao = "Usar como entrada uma interação identificável, como uma conversa iniciada no Direct.";
  }
  if (origem.canal === "chatgpt") {
    etapas[0].titulo = "Anúncio ChatGPT";
    etapas[0].responsavel = "Canal planejado";
  }
  return { ...origem, etapas };
}

export function lerDadosRotas(json: string | null): DadosRotas | null {
  if (!json) return null;
  try {
    const dados = dadosSchema.safeParse(JSON.parse(json));
    return dados.success ? dados.data : null;
  } catch {
    return null;
  }
}

export function ordemEtapas(etapas: Etapa[], origem: number, destino: number) {
  if (origem < 0 || destino < 0 || origem >= etapas.length || destino >= etapas.length || origem === destino) return etapas;
  const resultado = [...etapas];
  const [etapa] = resultado.splice(origem, 1);
  resultado.splice(destino, 0, etapa);
  return resultado;
}

export function etapasDaJornada(rota: Rota) {
  return rota.etapas.filter((etapa) => tipoEvento(etapa.tipo) !== null);
}

function tipoEvento(tipo: TipoEtapa): Exclude<TipoEvento, "entrada"> | null {
  return tipo === "whatsapp" || tipo === "direct" || tipo === "link" || tipo === "venda" ? tipo : null;
}

export function montarLink(origem: Origem) {
  try {
    const url = new URL(origem.destino);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    Object.entries(origem.utm).forEach(([chave, valor]) => {
      if (valor) url.searchParams.set(`utm_${chave}`, valor);
    });
    return url.href;
  } catch {
    return "";
  }
}

export function preencherMensagem(texto: string, nome: string, origem: Origem) {
  const valores: Record<string, string> = {
    nome, barbearia: "Black Barber", rota: origem.nome, link: montarLink(origem) || "[link de destino]",
  };
  return texto.replace(/\{\{(nome|barbearia|rota|link)\}\}/g, (_, chave: string) => valores[chave]);
}

export function registrarJornada(rota: Rota, fim: string, cliente: Pick<Jornada, "id" | "nome" | "instante" | "amostra">): Jornada {
  const origem: Origem = { id: rota.id, nome: rota.nome, canal: rota.canal, utm: rota.utm, destino: rota.destino };
  const etapas = etapasDaJornada(rota);
  const ate = etapas.findIndex((etapa) => etapa.id === fim);
  const eventos: Jornada["eventos"] = [{ tipo: "entrada", titulo: "Entrada na rota", detalhe: CANAIS[rota.canal].nome }];
  for (const etapa of etapas.slice(0, ate + 1)) {
    const tipo = tipoEvento(etapa.tipo)!;
    let detalhe = "";
    if (tipo === "whatsapp" || tipo === "direct") {
      detalhe = preencherMensagem(etapa.modo === "padrao" ? MENSAGEM_BOT_DEMO : etapa.instrucao, cliente.nome, origem);
    }
    if (tipo === "link") detalhe = montarLink(origem);
    if (tipo === "venda") detalhe = "Venda concluída na simulação.";
    eventos.push({ tipo, titulo: etapa.titulo, detalhe });
  }
  return { ...cliente, origem, eventos };
}

export type Contagem = { entradas: number; conversas: number; vendas: number };

export function contarJornadas(jornadas: Jornada[]): Contagem {
  return jornadas.reduce((total, jornada) => {
    total.entradas++;
    if (jornada.eventos.some((evento) => evento.tipo === "whatsapp" || evento.tipo === "direct")) total.conversas++;
    if (jornada.eventos.some((evento) => evento.tipo === "venda")) total.vendas++;
    return total;
  }, { entradas: 0, conversas: 0, vendas: 0 });
}

export function conversao({ entradas, vendas }: Contagem) {
  return entradas ? new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(vendas / entradas) : "—";
}

export function relatorioCsv(rotas: Rota[], jornadas: Jornada[]) {
  const linhas = rotas.map((rota) => {
    const total = contarJornadas(jornadas.filter(({ origem }) => origem.id === rota.id));
    return [rota.nome, CANAIS[rota.canal].nome, total.entradas, total.conversas, total.vendas, conversao(total)];
  });
  return [
    ["Rota", "Canal", "Entradas simuladas", "Conversas simuladas", "Vendas simuladas", "Conversão"],
    ...linhas,
  ].map((linha) => linha.map((valor) => {
    const celula = String(valor);
    const texto = /^[\s]*[=+\-@]|^[\t\r\n]/.test(celula) ? `'${celula}` : celula;
    return `"${texto.replaceAll('"', '""')}"`;
  }).join(";")).join("\r\n");
}
