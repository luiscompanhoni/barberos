import { z } from "zod";
import { CHAVES, type Permissao } from "./permissoes-regras";

export const zPapelEquipe = z.enum(["DONO", "GERENTE", "LIDER", "RECEPCAO", "BARBEIRO"]);
const zPermissoes = z.partialRecord(z.enum(CHAVES as [Permissao, ...Permissao[]]), z.boolean().nullable());

export const zEditarUsuario = z.object({
  nome: z.string().trim().min(2).max(60).optional(),
  telefone: z.string().trim().max(30).optional(),
  login: z.string().trim().max(30).nullable().optional(),
  papel: zPapelEquipe.optional(),
  ativo: z.boolean().optional(),
  atende: z.boolean().optional(),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  servicoIds: z.array(z.string().min(1).max(100)).max(200).optional(),
  cargo: z.string().trim().max(80).nullable().optional(),
  funcaoChecklist: z.enum(["BARBEIRO", "GERENTE", "DIARISTA"]).optional(),
  permissoes: zPermissoes.optional(),
}).strict();

export const zCriarUsuario = zEditarUsuario.extend({
  nome: z.string().trim().min(2).max(60),
  telefone: z.string().trim().min(10).max(30),
  papel: zPapelEquipe,
});

export type EdicaoUsuario = z.infer<typeof zEditarUsuario>;
