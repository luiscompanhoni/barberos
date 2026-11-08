import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dataLocal } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio } from "@/lib/erros";

type Tx = Prisma.TransactionClient;
type Leitor = Pick<Tx, "remuneracaoVersao">;
type Origem = "BASELINE_LEGADO_NAO_HOMOLOGADO" | "CONFIGURACAO_EXPLICITA";
const zCompetencia = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/);
const validarEscopo = (s: string) => z.string().min(1).max(200).parse(s);

function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canonico(x)}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

async function travar(tx: Tx, escopo: string) {
  validarEscopo(escopo);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`remuneracao:${escopo}`}))`;
}

export function competenciasRemuneracao(agora = new Date()) {
  const atual = dataLocal(agora).slice(0, 7);
  const [ano, mes] = atual.split("-").map(Number);
  return { atual, proxima: mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, "0")}` };
}

export function competenciaSalario(entrada?: string, agora = new Date()) {
  const { atual, proxima } = competenciasRemuneracao(agora);
  const escolhida = zCompetencia.parse(entrada ?? proxima);
  if (escolhida < atual) throw new ErroNegocio("Salário de competência passada exige revisão histórica específica. Os registros existentes foram preservados.", 409, "remuneracao_retroativa");
  return escolhida;
}

/** Baseline é o estado legado observado, sem afirmar que vigorou em meses antigos. */
export async function garantirBaselineRemuneracao(tx: Tx, escopo: string, conteudo: Prisma.InputJsonValue, atorId?: string | null) {
  await travar(tx, escopo);
  const existente = await tx.remuneracaoVersao.findFirst({ where: { escopo }, orderBy: [{ competencia: "asc" }, { versao: "asc" }] });
  if (existente) return existente;
  const row = await tx.remuneracaoVersao.create({ data: { escopo, competencia: "0001-01", versao: 1, conteudoJson: { conteudo, origem: "BASELINE_LEGADO_NAO_HOMOLOGADO" }, criadoPorId: atorId ?? null } });
  await auditar(tx, atorId ?? null, "remuneracao_baseline_legado", "remuneracao_versao", row.id, { escopo, competencia: row.competencia, homologado: false });
  return row;
}

/** Acrescenta versões. Nunca atualiza ou exclui uma regra usada em competência anterior. */
export async function gravarVigenciaRemuneracao(tx: Tx, d: { escopo: string; competencia: string; conteudo: Prisma.InputJsonValue; atorId?: string | null }) {
  zCompetencia.parse(d.competencia);
  if (d.competencia === "0001-01") throw new ErroNegocio("Competência reservada ao baseline legado.", 400);
  await travar(tx, d.escopo);
  const anterior = await tx.remuneracaoVersao.findFirst({ where: { escopo: d.escopo, competencia: d.competencia }, orderBy: { versao: "desc" } });
  const conteudoJson = { conteudo: d.conteudo, origem: "CONFIGURACAO_EXPLICITA" };
  if (anterior && canonico(anterior.conteudoJson) === canonico(conteudoJson)) return anterior;
  const row = await tx.remuneracaoVersao.create({ data: { escopo: d.escopo, competencia: d.competencia, versao: (anterior?.versao ?? 0) + 1, conteudoJson, criadoPorId: d.atorId ?? null } });
  await auditar(tx, d.atorId ?? null, "remuneracao_vigencia", "remuneracao_versao", row.id, { escopo: d.escopo, competencia: d.competencia, versao: row.versao });
  return row;
}

export async function lerVigenciaRemuneracao<T = Prisma.JsonValue>(leitor: Leitor, escopo: string, competencia: string): Promise<{ conteudo: T; origem: Origem; competencia: string; versao: number } | null> {
  validarEscopo(escopo); zCompetencia.parse(competencia);
  const row = await leitor.remuneracaoVersao.findFirst({ where: { escopo, competencia: { lte: competencia } }, orderBy: [{ competencia: "desc" }, { versao: "desc" }] });
  if (!row) return null;
  const envelope = row.conteudoJson;
  if (!envelope || Array.isArray(envelope) || typeof envelope !== "object" || !("conteudo" in envelope)
    || !["BASELINE_LEGADO_NAO_HOMOLOGADO", "CONFIGURACAO_EXPLICITA"].includes(String(envelope.origem))) {
    throw new ErroNegocio("Histórico de remuneração inválido. Confira a origem dos registros.", 409, "remuneracao_invalida");
  }
  return { conteudo: envelope.conteudo as T, origem: envelope.origem as Origem, competencia: row.competencia, versao: row.versao };
}
