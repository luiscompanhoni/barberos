import { z } from "zod";
import { ehHomologacao } from "@/lib/ambiente";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";
import { zIdInstagram, zMidInstagram } from "./protocolo";

const LIMITE_BYTES = 1_000;
const zConfirmacao = z.object({ recipient_id: zIdInstagram, message_id: zMidInstagram });

export function dentroJanelaInstagram(ultimaEntradaEm: Date | null, agora = Date.now()) {
  if (!ultimaEntradaEm) return false;
  const idade = agora - +ultimaEntradaEm;
  return idade >= 0 && idade < 24 * 3_600_000;
}

/** O limite da Meta conta bytes UTF-8. Preferir um espaço e preservar o texto e os caracteres. */
export function partesInstagram(texto: string) {
  const partes: string[] = [];
  let parte = "";
  let bytes = 0;
  let quebra = 0;
  for (const caractere of texto) {
    const tamanho = Buffer.byteLength(caractere);
    if (bytes + tamanho > LIMITE_BYTES) {
      const corte = quebra && Buffer.byteLength(parte.slice(quebra)) + tamanho <= LIMITE_BYTES ? quebra : parte.length;
      partes.push(parte.slice(0, corte));
      parte = parte.slice(corte);
      bytes = Buffer.byteLength(parte);
      quebra = 0;
    }
    parte += caractere;
    bytes += tamanho;
    if (/\s/u.test(caractere)) quebra = parte.length;
  }
  if (parte) partes.push(parte);
  return partes;
}

export function instagramEmSimulacao() {
  return process.env.INSTAGRAM_ENVIOS_BLOQUEADOS !== "false" || ehHomologacao() || quarentenaRestauracao();
}

export async function enviarTextoInstagram(p: { igsid: string; texto: string; sinal: AbortSignal }, rede = fetch) {
  if (instagramEmSimulacao()) return { simulado: true, mid: null } as const;
  const perfil = zIdInstagram.safeParse(process.env.INSTAGRAM_PROFESSIONAL_ACCOUNT_ID);
  const token = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  const versao = process.env.INSTAGRAM_GRAPH_API_VERSION?.trim();
  if (!perfil.success || !token || !versao || !/^v[1-9]\d?\.0$/.test(versao)) {
    throw new Error("Credenciais ou versão da API do Instagram indisponíveis.");
  }
  if (!zIdInstagram.safeParse(p.igsid).success || !p.texto.trim() || Buffer.byteLength(p.texto) > LIMITE_BYTES) {
    throw new Error("Texto ou destinatário inválido para o Instagram.");
  }
  try {
    const resposta = await rede(`https://graph.instagram.com/${versao}/${perfil.data}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: p.igsid }, message: { text: p.texto } }),
      redirect: "error",
      signal: p.sinal,
    });
    if (!resposta.ok) throw new Error();
    const confirmacao = zConfirmacao.parse(await resposta.json());
    if (confirmacao.recipient_id !== p.igsid) throw new Error();
    return { simulado: false, mid: confirmacao.message_id } as const;
  } catch {
    // Mensagens da Meta podem incluir tokens, destinatários e partes do conteúdo.
    throw new Error("O Instagram não confirmou o envio. Confira no Direct antes de reenviar.");
  }
}
