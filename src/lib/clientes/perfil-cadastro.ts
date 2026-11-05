import { z } from "zod";
import { cpfValido } from "@/lib/assinaturas/regras";
import { normalizarTelefone } from "@/lib/telefone";
import { zNascimento } from "@/lib/validacao-cliente";

export const zCpfCadastro = z.string().trim().max(20).transform((v) => v.replace(/\D/g, ""))
  .refine(cpfValido, "Informe um CPF válido.");
export const zTelefoneCadastro = z.string().max(30).transform(normalizarTelefone)
  .refine((v): v is string => Boolean(v), "Informe um celular com DDD.").transform((v) => v!);
export const zDadosCadastroCliente = z.object({
  nome: z.string().trim().min(2, "Informe seu nome.").max(60),
  telefone: zTelefoneCadastro,
  cpf: zCpfCadastro,
  email: z.string().trim().max(254).pipe(z.email("Informe um e-mail válido.")).transform((v) => v.toLowerCase()),
  endereco: z.string().trim().min(8, "Informe seu endereço completo.").max(300),
  dataNascimento: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v,
  "Informe uma data de nascimento válida.").pipe(zNascimento.unwrap()),
});
export const zAtualizacaoCadastroCliente = zDadosCadastroCliente.omit({ telefone: true }).partial();

export const seletorPerfilCliente = {
  nome: true, telefone: true, cpf: true, email: true, endereco: true, dataNascimento: true,
  observacoes: true, origem: true, origemDetalhe: true, fotoVersao: true, perfilCompletoEm: true,
} as const;

export function cadastroCompleto(c: { nome: string; telefone: string; cpf: string | null; email: string | null; endereco: string | null; dataNascimento: Date | null }) {
  return zDadosCadastroCliente.safeParse({ ...c, dataNascimento: c.dataNascimento?.toISOString().slice(0, 10) }).success;
}
