import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { parametros } from "@/lib/validacao";
import { corpoCobrancaEquipe } from "@/lib/pagamentos/http-equipe";
import { cadastrarCliente, listarClientes } from "@/lib/clientes/gestao";
import { zClienteGestao, zConsultaClientes } from "@/lib/clientes/gestao-regras";

export const GET = rota(async (req: Request) => {
  await exigirSessao(BALCAO);
  return NextResponse.json(await listarClientes(parametros(req, zConsultaClientes)), { headers: { "Cache-Control": "private, no-store" } });
});
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(BALCAO);
  return NextResponse.json(await cadastrarCliente(await corpoCobrancaEquipe(req, zClienteGestao), s.usuarioId), { status: 201 });
});
