import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { credenciaisOficial, graph, meta } from "@/lib/whatsapp/oficial";

/**
 * Modelos de mensagem (templates) da conta oficial na Meta: listar, criar e apagar.
 * A Meta revisa cada modelo criado; só os aprovados podem ser enviados fora da janela de 24 h.
 */

export type Modelo = { id: string; nome: string; status: string; categoria: string; idioma: string; texto: string; motivo: string | null };
type ModeloMeta = { id: string; name: string; status: string; category: string; language: string; rejected_reason?: string; components?: { type: string; text?: string }[] };

export const NOME_MODELO = /^[a-z0-9_]{1,512}$/;

/** Quantas variáveis {{1}}, {{2}}... o texto usa; a Meta exige numeração em sequência a partir de 1. */
export function variaveisDoTexto(texto: string): number {
  const nums = [...texto.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const max = nums.length ? Math.max(...nums) : 0;
  for (let i = 1; i <= max; i++) if (!nums.includes(i)) throw new ErroNegocio(`Variável {{${i}}} faltando: numere em sequência a partir de {{1}}.`);
  return max;
}

async function conta() {
  const c = await credenciaisOficial();
  if (!c) throw new ErroNegocio("Conecte a API oficial do WhatsApp antes de gerenciar modelos.", 409);
  if (!c.wabaId) throw new ErroNegocio("Falta WHATSAPP_WABA_ID no servidor para gerenciar modelos.", 409);
  return { token: c.token, waba: c.wabaId };
}

const falhaMeta = (acao: string) => (e: unknown): never => {
  throw new ErroNegocio(`A Meta recusou ${acao} (${(e as Error).message}).`, 502);
};

export async function listarModelos(): Promise<Modelo[]> {
  const { token, waba } = await conta();
  const q = new URLSearchParams({ fields: "id,name,status,category,language,rejected_reason,components", limit: "100" });
  const r = await meta<{ data?: ModeloMeta[] }>(graph(`${waba}/message_templates?${q}`), { token }).catch(falhaMeta("a lista de modelos"));
  return (r.data ?? []).map((m) => ({
    id: m.id, nome: m.name, status: m.status, categoria: m.category, idioma: m.language,
    texto: m.components?.find((c) => c.type === "BODY")?.text ?? "",
    motivo: m.rejected_reason && m.rejected_reason !== "NONE" ? m.rejected_reason : null,
  }));
}

export async function criarModelo(p: { nome: string; categoria: "UTILITY" | "MARKETING"; texto: string; exemplos: string[] }, usuarioId: string) {
  const n = variaveisDoTexto(p.texto);
  if (p.exemplos.length !== n) throw new ErroNegocio(`Informe ${n} exemplo(s), um para cada variável do texto.`);
  const { token, waba } = await conta();
  const corpo = {
    name: p.nome, language: "pt_BR", category: p.categoria,
    components: [{ type: "BODY", text: p.texto, ...(n ? { example: { body_text: [p.exemplos] } } : {}) }],
  };
  const r = await meta<{ id: string; status: string }>(graph(`${waba}/message_templates`), { token, corpo }).catch(falhaMeta("o modelo"));
  await db.$transaction((tx) => auditar(tx, usuarioId, "whatsapp_modelo_criar", "configuracao", "whatsapp", { nome: p.nome, categoria: p.categoria, status: r.status }));
  return r;
}

export async function apagarModelo(nome: string, usuarioId: string) {
  const { token, waba } = await conta();
  await meta(graph(`${waba}/message_templates?${new URLSearchParams({ name: nome })}`), { token, metodo: "DELETE" }).catch(falhaMeta("apagar o modelo"));
  await db.$transaction((tx) => auditar(tx, usuarioId, "whatsapp_modelo_apagar", "configuracao", "whatsapp", { nome }));
}
