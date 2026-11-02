import { NextResponse } from "next/server";
import { z } from "zod";
import { rota } from "@/lib/erros";
import { limitar } from "@/lib/limite";
import { candidatoEntrevista } from "@/lib/recrutamento/entrevistas";
import { zAcaoEntrevista } from "@/lib/recrutamento/entrevistas-regras";
import { corpoEntrevista } from "@/lib/recrutamento/entrevistas-http";
import { hashTokenEntrevista } from "@/lib/recrutamento/entrevistas-token";
export const dynamic = "force-dynamic";
const confirmar = rota(async (req: Request) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.slice(0, 64) ?? "sem-ip";
  limitar(`entrevista:${ip}`, 40, 60_000);
  const b = await corpoEntrevista(req, z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), pedido: zAcaoEntrevista }).strict());
  limitar(`entrevista-token:${hashTokenEntrevista(b.token)}`, 60, 60_000);
  return NextResponse.json(await candidatoEntrevista(b.token, b.pedido), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
});

export async function POST(req: Request) {
  const resposta = await confirmar(req);
  resposta.headers.set("Cache-Control", "no-store");
  resposta.headers.set("Referrer-Policy", "no-referrer");
  return resposta;
}
