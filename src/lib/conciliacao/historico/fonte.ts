import { z } from "zod";
import { ErroNegocio } from "@/lib/erros";
import { zTransacaoId, type TransacaoHistorica } from "./schemas";

const zCliente = z.object({
  name: z.string().default(""), document: z.string().nullish(),
  phones: z.array(z.union([z.string(), z.number()])).nullish(),
});
const zTransacao = z.object({
  galaxPayId: z.number().int().positive().safe(), value: z.number().int().positive().max(2_147_483_647),
  payday: z.iso.date(), status: z.string(), subscriptionGalaxPayId: z.number().int().positive().nullish(),
  Subscription: z.object({ galaxPayId: z.number().int().positive(), Customer: zCliente.nullish() }).nullish(),
  Charge: z.object({ Customer: zCliente.nullish() }).nullish(),
});

export function lerTransacaoHistorica(json: unknown, id: string): TransacaoHistorica {
  const dados = z.object({ Transactions: z.array(zTransacao) }).safeParse(json);
  const encontrados = dados.success ? dados.data.Transactions.filter((t) => String(t.galaxPayId) === id) : [];
  if (encontrados.length !== 1) throw new ErroNegocio("A Celcash não retornou o detalhe esperado. Nenhuma alteração foi feita.", 502);
  const t = encontrados[0];
  if (t.Subscription && t.subscriptionGalaxPayId && t.Subscription.galaxPayId !== t.subscriptionGalaxPayId) {
    throw new ErroNegocio("A Celcash retornou contratos conflitantes. Nenhuma alteração foi feita.", 502);
  }
  // Cliente de cobrança avulsa não comprova o titular de uma assinatura.
  const c = t.Subscription?.Customer;
  const contrato = t.Subscription?.galaxPayId ?? t.subscriptionGalaxPayId;
  return {
    id, contratoId: contrato ? String(contrato) : null, valorCentavos: t.value, vencimento: t.payday, status: t.status,
    cliente: { nome: c?.name ?? "", cpf: c?.document ?? "", telefones: (c?.phones ?? []).map(String) },
  };
}

/** Credencial exclusiva de leitura. Este modulo nunca chama operacoes de cobranca/estorno. */
export async function buscarTransacaoHistorica(id: string): Promise<TransacaoHistorica> {
  zTransacaoId.parse(id);
  const galaxId = process.env.CELCASH_GALAX_ID;
  const hash = process.env.CELCASH_GALAX_HASH;
  if (!galaxId || !hash) throw new ErroNegocio("A integração de leitura da Celcash não está configurada.", 503);
  const base = process.env.CELCASH_AMBIENTE === "producao" ? "https://api-celcash.celcoin.com.br/v2" : "https://api.sandbox.cel.cash/v2";
  const auth = await fetch(`${base}/token`, {
    method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${galaxId}:${hash}`).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", scope: "transactions.read" }), signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  const token = z.object({ access_token: z.string().min(1) }).safeParse(await auth.json().catch(() => null));
  if (!auth.ok || !token.success) throw new ErroNegocio("Não foi possível consultar a Celcash. Tente novamente.", 502);
  const r = await fetch(`${base}/transactions?galaxPayIds=${id}&startAt=0&limit=1`, {
    headers: { Authorization: `Bearer ${token.data.access_token}` }, signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  if (!r.ok) throw new ErroNegocio("A consulta da transação Celcash falhou. Nenhuma alteração foi feita.", 502);
  return lerTransacaoHistorica(await r.json().catch(() => null), id);
}
