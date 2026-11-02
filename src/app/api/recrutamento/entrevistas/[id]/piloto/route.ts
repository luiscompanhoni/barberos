import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota, ErroNegocio } from "@/lib/erros";
import { estadoPiloto, reservarConvitePiloto } from "@/lib/whatsapp/piloto";
import { permitePiloto } from "@/lib/whatsapp/piloto-regras";
import { obterConversa, enviarNaConversa } from "@/lib/whatsapp/conversas";
import { porTokenEntrevista } from "@/lib/recrutamento/entrevistas";
import { tokenEntrevista } from "@/lib/recrutamento/entrevistas-token";
import { auditar } from "@/lib/auditoria";
export const POST = rota(async (_req:Request,ctx:{params:Promise<{id:string}>})=>{
 const s=await exigirSessao(["DONO"]);const id=(await ctx.params).id;
 const e=await db.entrevistaRecrutamento.findUnique({where:{id},include:{candidatura:{select:{candidato:{select:{telefone:true}}}}}});
 const p=await estadoPiloto();
 if(p?.usuarioId!==s.usuarioId||!e||e.donoId!==s.usuarioId||e.estado!=="CONVIDADO"||!permitePiloto(p,e.candidatura.candidato.telefone,"ENTREVISTA_PILOTO"))throw new ErroNegocio("Convite não autorizado para este piloto.",403);
 // Conferir geração/expiração e preservar tokens fora da auditoria.
 await db.$transaction(tx=>porTokenEntrevista(tx,tokenEntrevista(e),Date.now()));
 const c=await obterConversa(e.candidatura.candidato.telefone);
 if(!await reservarConvitePiloto(`${e.id}:${e.geracao}`,p!.versao)) return NextResponse.json({ok:true,reutilizado:true},{headers:{"Cache-Control":"no-store"}});
 // O token vai somente ao próprio destinatário autorizado pelo dono.
 const r=await enviarNaConversa(c.id,`[Teste de entrevista ${e.id}] Teste autorizado da Black, sem IA. Para iniciar, responda INICIAR ENTREVISTA. Não é uma entrevista real nem uma campanha.`,"SISTEMA",{entrevistaPiloto:true});
 await auditar(db,s.usuarioId,"recrutamento.piloto.convite", "EntrevistaRecrutamento",e.id,{enviado:r.ok});
 if(!r.ok)throw new ErroNegocio("O canal não confirmou envio. Confira a conexão e o registro na conversa antes de tentar novamente.",502);
 return NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}});
});
