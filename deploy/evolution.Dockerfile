# A Evolution 2.3.7 descarta o cartão inteiro quando falha o envio da miniatura HD.
FROM evoapicloud/evolution-api:v2.3.7

RUN node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from "node:fs";

const path = "/evolution/node_modules/baileys/lib/Utils/link-preview.js";
const source = readFileSync(path, "utf8");
const original = [
  "            if (opts.uploadImage) {",
  "                const { imageMessage } = await prepareWAMessageMedia({ image: { url: image } }, {",
  "                    upload: opts.uploadImage,",
  "                    mediaTypeOverride: 'thumbnail-link',",
  "                    options: opts.fetchOpts",
  "                });",
  "                urlInfo.jpegThumbnail = imageMessage?.jpegThumbnail ? Buffer.from(imageMessage.jpegThumbnail) : undefined;",
  "                urlInfo.highQualityThumbnail = imageMessage || undefined;",
  "            }",
  "            else {",
].join("\n");

const fallback = [
  "            if (opts.uploadImage && image) {",
  "                try {",
  "                    const { imageMessage } = await prepareWAMessageMedia({ image: { url: image } }, {",
  "                        upload: opts.uploadImage,",
  "                        mediaTypeOverride: 'thumbnail-link',",
  "                        options: opts.fetchOpts",
  "                    });",
  "                    urlInfo.jpegThumbnail = imageMessage?.jpegThumbnail ? Buffer.from(imageMessage.jpegThumbnail) : undefined;",
  "                    urlInfo.highQualityThumbnail = imageMessage || undefined;",
  "                } catch {",
  "                    opts.logger?.debug('Miniatura HD indisponível, usando prévia compacta');",
  "                }",
  "            }",
  "            if (!urlInfo.highQualityThumbnail && !urlInfo.jpegThumbnail) {",
].join("\n");

if (source.split(original).length !== 2) {
  throw new Error("Implementação de prévia diferente da versão homologada da Evolution");
}
writeFileSync(path, source.replace(original, fallback));
JS
