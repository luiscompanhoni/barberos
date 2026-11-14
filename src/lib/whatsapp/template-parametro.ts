/**
 * A API oficial recusa parâmetro de modelo com quebra de linha, tab ou mais de 4 espaços seguidos
 * (erro 132018). Avisos e campanhas fora da janela de 24 h vão inteiros no {{2}} do modelo de aviso,
 * então as quebras viram " · " em vez de derrubar o envio.
 */
export function textoParametroTemplate(texto: string) {
  return texto
    .split(/\s*[\r\n]+\s*/)
    .filter(Boolean)
    .join(" · ")
    .replace(/\t/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}
