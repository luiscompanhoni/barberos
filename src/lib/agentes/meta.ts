import { z } from "zod";
import { ErroNegocio } from "@/lib/erros";
import { hashAgente } from "./regras";

type AmbienteMeta = Readonly<Record<string, string | undefined>>;
type DependenciasMeta = { env?: AmbienteMeta; fetch?: typeof fetch; agora?: Date };
const ORIGEM = "https://graph.facebook.com";
const MAX_PAGINAS = 10;
const MAX_BYTES = 2_000_000;
const campos = "account_id,account_currency,campaign_id,adset_id,ad_id,ad_name,date_start,date_stop,spend,impressions,clicks,actions,action_values";
const id = z.string().regex(/^\d{1,30}$/);
const decimal = z.string().regex(/^\d+(?:\.\d{1,6})?$/).max(30);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(v + "T00:00:00Z");
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v;
}, "Data inexistente.");
const periodoSchema = z.object({ de: data, ate: data }).strict().refine(p => {
  const dias = (+new Date(p.ate) - +new Date(p.de)) / 86_400_000;
  return dias >= 0 && dias <= 92;
}, "Consulte um período de até 93 dias.");
const acaoSchema = z.object({ action_type: z.string().min(1).max(160), value: decimal });
const linhaSchema = z.object({
  account_id: id, account_currency: z.literal("BRL"), campaign_id: id, adset_id: id, ad_id: id,
  ad_name: z.string().max(1000), date_start: data, date_stop: data, spend: decimal,
  impressions: z.string().regex(/^\d+$/), clicks: z.string().regex(/^\d+$/),
  actions: z.array(acaoSchema).max(500).optional(), action_values: z.array(acaoSchema).max(500).optional(),
});
const paginaSchema = z.object({
  data: z.array(linhaSchema).max(200),
  paging: z.object({ next: z.string().max(10_000).optional() }).optional(),
});

export type InsightMeta = {
  chave: string; campanhaId: string; conjuntoId: string; anuncioId: string; nome: string; dia: string;
  gastoCentavos: number; impressoes: number; cliques: number;
  acoes: Record<string, number>; valoresAcoesCentavos: Record<string, number>;
};
export type RelatorioMeta = {
  fonte: "META_ADS"; contaId: string; moeda: "BRL"; fuso: string; periodo: { de: string; ate: string };
  consultadoEm: string; atribuicao: "configuracao_conjunto"; linhas: InsightMeta[];
};

export function configurarMeta(env: AmbienteMeta = process.env) {
  const pendencias: string[] = [];
  if (!/^v\d{1,3}\.0$/.test(env.META_ADS_API_VERSION ?? "")) pendencias.push("Definir META_ADS_API_VERSION com uma versão suportada e validada da API.");
  if (!/^act_\d{1,30}$/.test(env.META_ADS_ACCOUNT_ID ?? "")) pendencias.push("Definir META_ADS_ACCOUNT_ID da conta autorizada (act_ seguido do ID).");
  if (!env.META_ADS_TOKEN || /\s/.test(env.META_ADS_TOKEN)) pendencias.push("Configurar token Meta protegido com permissão de leitura da conta.");
  return { disponivel: pendencias.length === 0, pendencias };
}

function falha(codigo = "meta_resposta", status = 502): never {
  const mensagens: Record<string, string> = {
    meta_resposta: "A resposta da Meta não pôde ser validada. Nenhum resultado parcial foi utilizado.",
    meta_limite: "Limite da consulta Meta atingido. Aguarde antes de consultar novamente ou reduza o período.",
    meta_conexao: "Não foi possível concluir a leitura da Meta. Confira a conexão e tente novamente.",
    meta_acesso: "A Meta recusou a leitura. Confira o token e as permissões da conta.",
    meta_moeda: "A conta Meta precisa estar em BRL. Conversão automática de moeda não está habilitada.",
  };
  throw new ErroNegocio(mensagens[codigo], status, codigo);
}

/** Valores monetários do provedor são decimais; não usar ponto flutuante para convertê-los. */
function centavos(v: string) {
  const [inteiro, frac = ""] = v.split(".");
  if (/[1-9]/.test(frac.slice(2))) falha();
  const n = Number(inteiro) * 100 + Number(frac.slice(0, 2).padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n < 0) falha();
  return n;
}
function numero(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) falha();
  return n;
}
function acoes(xs: z.infer<typeof acaoSchema>[] = [], dinheiro = false) {
  const mapa: Record<string, number> = Object.create(null);
  for (const x of xs) {
    if (Object.hasOwn(mapa, x.action_type)) falha();
    mapa[x.action_type] = dinheiro ? centavos(x.value) : numero(x.value);
  }
  return mapa;
}

function quotaAlta(headers: Headers) {
  const usoAlto = (v: unknown): boolean => {
    if (!v || typeof v !== "object") return false;
    return Object.entries(v).some(([k, x]) =>
      (["call_count", "total_time", "total_cputime", "acc_id_util_pct"].includes(k) && typeof x === "number" && x >= 90) || usoAlto(x));
  };
  return ["x-app-usage", "x-ad-account-usage", "x-business-use-case-usage"].some(k => {
    try { return usoAlto(JSON.parse(headers.get(k) ?? "null")); } catch { return false; }
  });
}

async function jsonLimitado(r: Response): Promise<unknown> {
  if (!r.body || Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) falha();
  const leitor = r.body.getReader();
  const chunks: Uint8Array[] = []; let tamanho = 0;
  try {
    while (true) {
      const p = await leitor.read(); if (p.done) break;
      tamanho += p.value.byteLength;
      if (tamanho > MAX_BYTES) { await leitor.cancel(); falha(); }
      chunks.push(p.value);
    }
  } finally { leitor.releaseLock(); }
  const bytes = new Uint8Array(tamanho); let pos = 0;
  for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return falha(); }
}

async function ler(url: URL, token: string, fetcher: typeof fetch) {
  try {
    const r = await fetcher(url, { method: "GET", headers: { Authorization: `Bearer ${token}` },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (r.status === 429 || quotaAlta(r.headers)) falha("meta_limite", 429);
    if (r.status === 401 || r.status === 403) falha("meta_acesso", 503);
    if (!r.ok) falha("meta_conexao", 503);
    const json = await jsonLimitado(r);
    if (json && typeof json === "object" && "error" in json) {
      const erro = z.object({ code: z.number().optional() }).safeParse(json.error);
      if (erro.success && [4, 17, 32, 613, 80000].includes(erro.data.code ?? 0)) falha("meta_limite", 429);
      if (erro.success && [10, 190, 200].includes(erro.data.code ?? 0)) falha("meta_acesso", 503);
      falha();
    }
    return json;
  } catch (err) {
    if (err instanceof ErroNegocio) throw err;
    return falha("meta_conexao", 503);
  }
}

/** O cursor é reaproveitado; URL, parâmetros e credenciais devolvidos pelo provedor nunca são executados. */
function proxima(next: string, base: URL) {
  let url: URL;
  try { url = new URL(next); } catch { return falha(); }
  if (url.origin !== ORIGEM || url.pathname !== base.pathname || url.username || url.password || url.hash) falha();
  const cursor = url.searchParams.get("after");
  if (!cursor || cursor.length > 2048 || /[\u0000-\u001f]/.test(cursor)) falha();
  const segura = new URL(base); segura.searchParams.set("after", cursor);
  return segura;
}

/** Somente leitura. Nenhum endpoint de publicação/ativação ou conversão financeira é chamado. */
export async function consultarInsights(periodo: { de: string; ate: string }, deps: DependenciasMeta = {}): Promise<RelatorioMeta> {
  const p = periodoSchema.parse(periodo); const env = deps.env ?? process.env;
  const config = configurarMeta(env);
  if (!config.disponivel) throw new ErroNegocio("Integração Meta Ads ainda não configurada.", 409, "meta_configuracao", config.pendencias);
  const contaId = env.META_ADS_ACCOUNT_ID!;
  const token = env.META_ADS_TOKEN!;
  const fetcher = deps.fetch ?? fetch;
  const contaUrl = new URL(`${ORIGEM}/${env.META_ADS_API_VERSION}/${contaId}`);
  contaUrl.searchParams.set("fields", "id,currency,timezone_name");
  const conta = z.object({ id: z.literal(contaId), currency: z.string(), timezone_name: z.string().max(100) }).safeParse(await ler(contaUrl, token, fetcher));
  if (!conta.success) falha();
  if (conta.data.currency !== "BRL") falha("meta_moeda", 409);
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: conta.data.timezone_name }).format(); } catch { falha(); }
  const base = new URL(`${ORIGEM}/${env.META_ADS_API_VERSION}/${contaId}/insights`);
  for (const [k, v] of Object.entries({ fields: campos, level: "ad", time_increment: "1", limit: "200",
    time_range: JSON.stringify({ since: p.de, until: p.ate }), use_unified_attribution_setting: "true", action_report_time: "mixed" })) base.searchParams.set(k, v);
  let url: URL | null = base;
  const paginas = new Set<string>(); const linhas = new Map<string, InsightMeta>();
  while (url) {
    if (paginas.size >= MAX_PAGINAS || paginas.has(url.href)) falha("meta_limite", 429);
    paginas.add(url.href);
    const pagina = paginaSchema.safeParse(await ler(url, token, fetcher));
    if (!pagina.success) falha();
    for (const x of pagina.data.data) {
      if (x.account_id !== contaId.slice(4) || x.date_start !== x.date_stop || x.date_start < p.de || x.date_stop > p.ate) falha();
      const chave = `${contaId}:${x.ad_id}:${x.date_start}`;
      const linha: InsightMeta = { chave, campanhaId: x.campaign_id, conjuntoId: x.adset_id, anuncioId: x.ad_id,
        nome: x.ad_name, dia: x.date_start, gastoCentavos: centavos(x.spend), impressoes: numero(x.impressions),
        cliques: numero(x.clicks), acoes: acoes(x.actions), valoresAcoesCentavos: acoes(x.action_values, true) };
      const anterior = linhas.get(chave);
      if (anterior && hashAgente(anterior) !== hashAgente(linha)) falha();
      linhas.set(chave, linha);
    }
    url = pagina.data.paging?.next ? proxima(pagina.data.paging.next, base) : null;
  }
  return { fonte: "META_ADS", contaId, moeda: "BRL", fuso: conta.data.timezone_name, periodo: p,
    consultadoEm: (deps.agora ?? new Date()).toISOString(), atribuicao: "configuracao_conjunto", linhas: [...linhas.values()] };
}

export const planoPublicacaoMetaSchema = z.object({
  nome: z.string().trim().min(3).max(150), contaId: z.string().regex(/^act_\d{1,30}$/),
  objetivo: z.enum(["OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_TRAFFIC", "OUTCOME_SALES"]),
  moeda: z.literal("BRL"), orcamentoDiarioCentavos: z.number().int().min(1).max(100_000_000),
  orcamentoTotalCentavos: z.number().int().min(1).max(100_000_000),
  conteudoRevisaoHash: z.string().regex(/^[a-f0-9]{64}$/), publico: z.string().trim().min(3).max(1000),
}).strict().refine(p => p.orcamentoDiarioCentavos <= p.orcamentoTotalCentavos, "Orçamento diário excede o total aprovado.");

/** Prévia local incompleta para revisão; não é autorização nem payload pronto para ativar anúncios. */
export function planejarPublicacaoMeta(entrada: unknown) {
  const plano = planoPublicacaoMetaSchema.parse(entrada);
  return { estado: "RASCUNHO_SEM_ENVIO" as const, permiteGasto: false as const, plano,
    campanha: { name: plano.nome, objective: plano.objetivo, status: "PAUSED" as const },
    pendencias: ["Aprovar a versão do conteúdo e o orçamento.", "Validar conta, público, destino, período e recursos do anúncio na Meta.",
      "Configurar publicação e autorização de ativação. Este adaptador faz somente leitura."] };
}
