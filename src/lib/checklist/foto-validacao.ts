import { ErroNegocio } from "@/lib/erros";

export const MAX_FOTOS_TAREFA = 3;
export const MAX_FOTO_BYTES = 400 * 1024;

/** Aceita somente imagens raster com cabeçalho compatível, sem SVG/HTML. */
export function lerFotoChecklist(dataUrl: string) {
  const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) throw new ErroNegocio("Envie uma foto JPEG, PNG ou WebP.");
  const dados = Buffer.from(m[2], "base64");
  if (!dados.length || dados.length > MAX_FOTO_BYTES) throw new ErroNegocio("A foto deve ter até 400 KB.", 413);
  const tipo = m[1];
  const assinatura = tipo === "image/jpeg" ? dados.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    : tipo === "image/png" ? dados.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : dados.subarray(0, 4).toString() === "RIFF" && dados.subarray(8, 12).toString() === "WEBP";
  if (!assinatura) throw new ErroNegocio("O arquivo não corresponde ao formato de imagem informado.");
  return { dados, tipo };
}
