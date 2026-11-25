import { after } from "next/server";
import { concluirEntradaInstagram, encaminharEntradaInstagram, registrarEntradaInstagram, registrarRemocaoInstagram, type EntradaRegistradaInstagram } from "@/lib/instagram/persistencia";
import { processarEntradaInstagram } from "@/lib/instagram/processar";
import { assinaturaInstagramValida, desafioInstagram, lerEntradasInstagram, lerRemocoesInstagram, zIdInstagram } from "@/lib/instagram/protocolo";

export const runtime = "nodejs";

export function GET(req: Request) {
  const desafio = desafioInstagram(new URL(req.url), process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN);
  return new Response(desafio ?? "Verificação recusada.", { status: desafio === null ? 403 : 200 });
}

export async function POST(req: Request) {
  const segredo = process.env.INSTAGRAM_APP_SECRET;
  const perfil = zIdInstagram.safeParse(process.env.INSTAGRAM_PROFESSIONAL_ACCOUNT_ID);
  if (!segredo || !perfil.success) return new Response("Webhook indisponível.", { status: 503 });
  const assinatura = req.headers.get("x-hub-signature-256");
  if (!assinatura) return new Response("Assinatura inválida.", { status: 401 });
  const leitor = req.body?.getReader();
  if (!leitor) return new Response("Corpo ausente.", { status: 400 });
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > 1_048_576) {
        await leitor.cancel();
        return new Response("Corpo acima do limite.", { status: 413 });
      }
      partes.push(value);
    }
  } finally { leitor.releaseLock(); }
  const bytes = Buffer.concat(partes);
  if (!assinaturaInstagramValida(bytes, assinatura, segredo)) return new Response("Assinatura inválida.", { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return new Response("Corpo inválido.", { status: 400 });
  }
  const registradas: EntradaRegistradaInstagram[] = [];
  let falha = false;
  for (const remocao of lerRemocoesInstagram(payload, perfil.data)) {
    try {
      await registrarRemocaoInstagram(remocao);
    } catch {
      falha = true;
      console.error("[instagram] Falha ao registrar remoção de mensagem.");
    }
  }
  for (const entrada of lerEntradasInstagram(payload, perfil.data)) {
    try {
      const registrada = await registrarEntradaInstagram(entrada);
      if (registrada) registradas.push(registrada);
    } catch {
      falha = true;
      console.error("[instagram] Falha ao registrar entrada.");
    }
  }
  if (registradas.length) after(async () => {
    for (const entrada of registradas) {
      try {
        await processarEntradaInstagram(entrada).catch(async () => {
          console.error("[instagram] Falha no atendimento; mensagem já registrada na caixa.");
          await encaminharEntradaInstagram(entrada, "O atendimento automático do Direct falhou. A equipe pode continuar por aqui.");
        });
        await concluirEntradaInstagram(entrada);
      } catch {
        console.error("[instagram] Falha ao concluir o turno. A entrada permanece na caixa.");
      }
    }
  });
  return new Response(falha ? "Registro incompleto." : "OK", { status: falha ? 500 : 200 });
}
