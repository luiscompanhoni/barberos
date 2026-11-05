"use client";

export type DadosCadastroForm = { nome: string; telefone: string; cpf: string; email: string; endereco: string; dataNascimento: string };
export const CADASTRO_VAZIO: DadosCadastroForm = { nome: "", telefone: "", cpf: "", email: "", endereco: "", dataNascimento: "" };

export function CamposCadastroCompleto({ valor, mudar, identidade = true, cpfExistente = false, obrigatorios = true }: {
  valor: DadosCadastroForm; mudar: (chave: keyof DadosCadastroForm, valor: string) => void; identidade?: boolean; cpfExistente?: boolean; obrigatorios?: boolean;
}) {
  const campo = (chave: keyof DadosCadastroForm, rotulo: string, tipo = "text", autoComplete?: string) => (
    <div key={chave}>
      <label className="rotulo" htmlFor={`cadastro-${chave}`}>{rotulo}</label>
      <input id={`cadastro-${chave}`} type={tipo} className="campo-linha" autoComplete={autoComplete}
        required={obrigatorios && (chave !== "cpf" || !cpfExistente)} maxLength={chave === "endereco" ? 300 : chave === "email" ? 254 : 60}
        inputMode={chave === "cpf" ? "numeric" : chave === "telefone" ? "tel" : undefined}
        value={valor[chave]} onChange={(e) => mudar(chave, e.target.value)} />
    </div>
  );
  return <>
    {identidade && campo("nome", "Nome completo", "text", "name")}
    {identidade && campo("telefone", "Celular com DDD", "tel", "tel")}
    {campo("cpf", cpfExistente ? "CPF — preencha somente para corrigir" : "CPF")}
    {campo("email", "E-mail", "email", "email")}
    {campo("endereco", "Endereço completo", "text", "street-address")}
    {campo("dataNascimento", "Data de nascimento", "date", "bday")}
  </>;
}
