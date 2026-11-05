import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { zCpfCadastro, zDadosCadastroCliente, zTelefoneCadastro } from "./perfil-cadastro";

export const zConsultaClientes = z.object({
  busca: z.string().trim().max(100).default(""),
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
  plano: z.enum(["todos", "com_plano", "sem_plano"]).default("todos"),
});
export const zClienteGestao = z.object({
  nome: zDadosCadastroCliente.shape.nome,
  telefone: zTelefoneCadastro,
  cpf: zCpfCadastro.nullable().optional(),
  email: zDadosCadastroCliente.shape.email.nullable().optional(),
  endereco: zDadosCadastroCliente.shape.endereco.nullable().optional(),
  dataNascimento: zDadosCadastroCliente.shape.dataNascimento.nullable().optional(),
  observacoes: z.string().trim().max(1000).nullable().optional(),
}).strict();
export const zEditarClienteGestao = zClienteGestao.partial().refine((v) => Object.keys(v).length > 0, "Informe uma alteração.");
export type ConsultaClientes = z.infer<typeof zConsultaClientes>;
export type DadosClienteGestao = z.infer<typeof zClienteGestao>;
export const TAMANHO_PAGINA_CLIENTES = 20;
export const cpfMascarado = (cpf: string | null) => cpf ? `***.***.${cpf.replace(/\D/g, "").slice(-5, -2)}-**` : null;

export function filtroClientes({ busca, plano }: ConsultaClientes): Prisma.ClienteWhereInput {
  const digitos = busca.replace(/\D/g, "");
  const assinatura: Prisma.AssinaturaWhereInput = { status: { in: ["ATIVA", "ATRASADA"] } };
  return {
    excluidoEm: null,
    ...(plano === "com_plano" ? { assinaturas: { some: assinatura } } : {}),
    ...(plano === "sem_plano" ? { assinaturas: { none: assinatura } } : {}),
    ...(busca ? { OR: [
      { nome: { contains: busca, mode: "insensitive" } },
      { email: { contains: busca, mode: "insensitive" } },
      ...(digitos.length >= 4 ? [{ telefone: { contains: digitos } }] : []),
      ...(digitos.length === 11 ? [{ cpf: digitos }] : []),
    ] } : {}),
  };
}
