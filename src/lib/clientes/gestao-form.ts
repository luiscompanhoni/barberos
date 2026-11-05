type CadastroBase = {
  nome: string; telefone: string; email: string | null; endereco: string | null;
  dataNascimento: string | null; observacoes: string | null;
};
const normalizar = (valor: string) => valor.replace(/\r\n?/g, "\n").trim() || null;

/** Edição de importados preserva campos intocados, mesmo fora da validação atual. */
export function dadosFormularioCliente(form: Pick<FormData, "get">, base?: CadastroBase) {
  const corpo: Record<string, string | null> = {};
  for (const campo of ["nome", "telefone", "email", "endereco", "dataNascimento", "observacoes"] as const) {
    const valor = normalizar(String(form.get(campo) ?? ""));
    if (!base || valor !== normalizar(base[campo] ?? "")) corpo[campo] = valor;
  }
  // O CPF vem mascarado; vazio não apaga o existente nem reenvia a máscara.
  const cpf = String(form.get("cpf") ?? "").trim();
  if (cpf) corpo.cpf = cpf;
  return corpo;
}
