type PerfilBase = { nome: string; email: string | null; endereco: string | null; dataNascimento: string | null;
  observacoes: string | null; origem: string | null; origemDetalhe: string | null };
type Campos = { nome: string; cpf: string; email: string; endereco: string; dataNascimento: string };
type Extras = { obs: string; origem: string; detalhe: string };

/** Perfil legado pode estar incompleto: valida e envia somente o que o cliente editou. */
export function alteracoesPerfil(base: PerfilBase, campos: Campos, extras: Extras) {
  const dados: Record<string, string | null> = {};
  for (const chave of ["nome", "email", "endereco", "dataNascimento"] as const) {
    if (campos[chave].trim() !== (base[chave] ?? "").trim()) dados[chave] = campos[chave].trim();
  }
  // O CPF existente chega mascarado; input vazio nunca apaga ou reenvia a máscara.
  if (campos.cpf.trim()) dados.cpf = campos.cpf.trim();
  if (extras.obs !== (base.observacoes ?? "")) dados.observacoes = extras.obs.trim();
  if (extras.origem !== (base.origem ?? "")) dados.origem = extras.origem || null;
  if (extras.detalhe !== (base.origemDetalhe ?? "")) dados.origemDetalhe = extras.detalhe.trim() || null;
  return dados;
}
