import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Erro de regra de negocio com mensagem pronta para mostrar ao usuario. */
export class ErroNegocio extends Error {
  constructor(
    message: string,
    public status = 422,
    public codigo = "regra",
    public detalhes?: unknown,
  ) {
    super(message);
  }
}

export const naoAutorizado = () => new ErroNegocio("Entre no sistema para continuar.", 401, "nao_autenticado");
export const proibido = () => new ErroNegocio("Você não tem permissão para isso.", 403, "proibido");
export const naoEncontrado = (o = "Registro") => new ErroNegocio(`${o} não encontrado.`, 404, "nao_encontrado");

/** Envolve um route handler traduzindo erros conhecidos em JSON. */
export function rota<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ErroNegocio) {
        return NextResponse.json(
          { erro: e.message, codigo: e.codigo, detalhes: e.detalhes },
          { status: e.status },
        );
      }
      if (e instanceof ZodError) {
        return NextResponse.json(
          { erro: "Dados inválidos.", codigo: "validacao", detalhes: e.issues },
          { status: 400 },
        );
      }
      console.error(e);
      return NextResponse.json({ erro: "Erro interno.", codigo: "interno" }, { status: 500 });
    }
  };
}
