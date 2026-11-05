import { z } from "zod";
import { NextResponse } from "next/server";
import { rota } from "@/lib/erros";
import { json } from "@/lib/estudio/http";
import { exigirCliente } from "@/lib/auth/sessao";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";
import { concluirCadastroSocial, vincularSocialDaSessao } from "@/lib/auth/social";
import { identidadePendente } from "@/lib/auth/social-cookies";
import { zDadosCadastroCliente } from "@/lib/clientes/perfil-cadastro";

export const GET = rota(async () => {
  const p = await identidadePendente();
  return NextResponse.json({ pendente: Boolean(p), provedor: p?.provedor, nome: p?.nome, email: p?.email }, { headers: { "Cache-Control": "private, no-store" } });
});
export const POST = rota(async (req: Request) => {
  exigirOrigemCliente(req);
  const b = await json(req, zDadosCadastroCliente.extend({ codigo: z.string().regex(/^\d{6}$/), aceiteTermos: z.literal(true) }));
  return NextResponse.json(await concluirCadastroSocial(zDadosCadastroCliente.parse(b), b.codigo));
});
export const PATCH = rota(async (req: Request) => {
  exigirOrigemCliente(req);
  const s = await exigirCliente();
  await json(req, z.object({ confirmar: z.literal(true) }));
  await vincularSocialDaSessao(s.usuarioId, s.sessaoVersao ?? 0);
  return NextResponse.json({ ok: true });
});
