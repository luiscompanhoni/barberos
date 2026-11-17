export function confirmouTrocaNoWhatsApp(texto: string | null | undefined) {
  return !!texto && !texto.includes("?") && !/\b(?:não|nao|talvez|vou pensar|só olhando|so olhando)\b/i.test(texto)
    && /\b(?:confirmo|pode (?:trocar|mudar|alterar)|fecha a troca)\b/i.test(texto)
    && !/\b(?:como|quando|onde|se|queria saber)\b/i.test(texto);
}

export function propostaDeTrocaConferida(proposta: string, entrada: unknown) {
  const e = entrada as { nome_conferido?: unknown; preco_conferido_centavos?: unknown; renovacao_conferida?: unknown } | null;
  if (typeof e?.nome_conferido !== "string" || typeof e.preco_conferido_centavos !== "number" || typeof e.renovacao_conferida !== "string") return false;
  const nome = e.nome_conferido.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nomeInteiro = nome && new RegExp(`(?<![\\p{L}\\p{N}])${nome}(?![\\p{L}\\p{N}])`, "iu").test(proposta);
  const precos = new Set([...proposta.matchAll(/R\$\s*(\d+(?:\.\d{3})*),(\d{2})(?!\d)/gi)]
    .map(m => Number(m[1].replaceAll(".", "")) * 100 + Number(m[2])));
  const [ano, mes, dia] = e.renovacao_conferida.split("-");
  const datas = [...proposta.matchAll(/(?<![\d/])(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?)(?![\d/])/g)];
  const aceitas = [e.renovacao_conferida, `${dia}/${mes}/${ano}`, `${dia}/${mes}`, `${Number(dia)}/${Number(mes)}/${ano}`, `${Number(dia)}/${Number(mes)}`];
  return !!nomeInteiro && precos.size === 1 && precos.has(e.preco_conferido_centavos) &&
    datas.length > 0 && datas.every(([data]) => aceitas.includes(data));
}
