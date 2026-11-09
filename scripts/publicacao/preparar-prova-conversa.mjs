/** Leitura limitada, sem texto de clientes, envio ou alteração de estado. Saída cifrada pelo transporte. */
import { writeFileSync } from "node:fs";
const id = process.env.CONVERSA_DIAGNOSTICO;
if (!/^c[a-z0-9]{20,32}$/.test(id ?? "")) throw new Error("ID de conversa inválido.");
const programa = `
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient();
(async()=>{
  const c=await db.conversa.findUniqueOrThrow({where:{id:${JSON.stringify(id)}},select:{telefone:true,waId:true,estado:true,recusaAutomaticas:true,ultimaEntradaEm:true,mensagens:{orderBy:{criadoEm:'desc'},take:6,select:{autor:true,erro:true,wamid:true,entregueEm:true,lidaEm:true,criadoEm:true}}}});
  const equipe=await db.usuario.findFirst({where:{telefone:c.telefone,ativo:true,papel:{in:['DONO','GERENTE']}},select:{papel:true}});
  const wa=c.waId??c.telefone;
  const elegivelWa=await db.usuario.findFirst({where:{telefone:wa,ativo:true,papel:{in:['DONO','GERENTE']}},select:{papel:true}});
  console.log(JSON.stringify({estado:c.estado,recusaAutomaticas:c.recusaAutomaticas,ultimaEntradaEm:c.ultimaEntradaEm,equipe:!!equipe,waIgualTelefone:wa===c.telefone,elegivelWa:!!elegivelWa,waDigitos:wa.replace(/\\D/g,'').length,mensagens:c.mensagens.map(m=>({...m,wamid:!!m.wamid})),flags:{testeEquipe:process.env.WHATSAPP_ATENDIMENTO_TESTE_EQUIPE,bloqueado:process.env.WHATSAPP_ENVIOS_BLOQUEADOS,provedor:process.env.WHATSAPP_PROVIDER}}));
})().catch(()=>{process.exitCode=1}).finally(()=>db.$disconnect());
`;
writeFileSync(process.argv[2], programa, { mode: 0o600, flag: "wx" });
