export type MidiaRecebida = {
  provedor: "cloud" | "evolution";
  id: string;
  tipo: "audio" | "imagem" | "figurinha";
  mime?: string;
  tamanho?: number;
  segundos?: number;
};

type Arquivo = { id?: string; mime_type?: string; mimetype?: string; fileLength?: number | string; seconds?: number; caption?: string };
export type ConteudoMidiaEvolution = {
  imageMessage?: Arquivo;
  audioMessage?: Arquivo;
  stickerMessage?: Arquivo;
  ephemeralMessage?: { message?: ConteudoMidiaEvolution };
  viewOnceMessage?: { message?: ConteudoMidiaEvolution };
  viewOnceMessageV2?: { message?: ConteudoMidiaEvolution };
};

/** Só metadados; URLs, chaves de mídia e base64 do webhook não entram na sessão. */
export function midiaEvolution(conteudo: ConteudoMidiaEvolution, id: string) {
  let m = conteudo;
  for (let n = 0; n < 4; n++) {
    const interna = m.ephemeralMessage?.message ?? m.viewOnceMessage?.message ?? m.viewOnceMessageV2?.message;
    if (!interna) break;
    m = interna;
  }
  const tipo = m.audioMessage ? "audio" : m.imageMessage ? "imagem" : m.stickerMessage ? "figurinha" : null;
  const a = m.audioMessage ?? m.imageMessage ?? m.stickerMessage;
  if (!tipo || !a) return null;
  const tamanho = Number(a.fileLength);
  return {
    midia: { provedor: "evolution", id, tipo, mime: a.mimetype, ...(Number.isFinite(tamanho) ? { tamanho } : {}), segundos: a.seconds } as MidiaRecebida,
    legenda: a.caption?.trim() || null,
  };
}

export function midiaCloud(tipo: string | undefined, a: Arquivo | undefined): MidiaRecebida | undefined {
  if (!a?.id || !["audio", "image", "sticker"].includes(tipo ?? "")) return;
  return { provedor: "cloud", id: a.id, tipo: tipo === "audio" ? "audio" : tipo === "image" ? "imagem" : "figurinha", mime: a.mime_type };
}
