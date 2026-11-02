import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota, ErroNegocio } from "@/lib/erros";
import { estadoPiloto, configurarPiloto } from "@/lib/whatsapp/piloto";
import { recursoPiloto } from "@/lib/whatsapp/piloto-regras";
import { estadoEvolution } from "@/lib/whatsapp/evolution";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";
import { corpoEntrevista } from "@/lib/recrutamento/entrevistas-http";
const headers = { "Cache-Control": "no-store" };
export const GET = rota(async () => {
  await exigirSessao(["DONO"]); return NextResponse.json({ disponivel: recursoPiloto(), piloto: await estadoPiloto() }, { headers });
});
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpoEntrevista(req,z.discriminatedUnion("acao",[
    z.object({acao:z.literal("INICIAR"),versao:z.number().int().min(0),telefone:z.string().min(10).max(30),minutos:z.number().int().min(1).max(60)}).strict(),
    z.object({acao:z.literal("ENCERRAR"),versao:z.number().int().min(0)}).strict(),
  ]));
  if (b.acao === "INICIAR" && (provedorWhatsApp() !== "evolution" || await estadoEvolution() !== "conectado")) throw new ErroNegocio("O piloto exige o WhatsApp Evolution já conectado; não ativa conexão ou API paga.",409);
  return NextResponse.json({piloto:await configurarPiloto(s.usuarioId,b.versao,b.acao==="INICIAR"?b.telefone:null,b.acao==="INICIAR"?b.minutos:30)}, {headers});
});
