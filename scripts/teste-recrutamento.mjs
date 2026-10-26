// Executar somente no container/banco descartáveis criados para este teste.
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(process.env.AMBIENTE, 'homologacao');
  assert.equal(process.env.RECRUTAMENTO_TESTE_ISOLADO, '1');
  assert.equal(url.hostname, 'recrutamento-test-db');
  assert.equal(url.pathname, '/recrutamento_teste');
  const db = new PrismaClient();
  const base = 'http://127.0.0.1:3000';
  const cookie = async (u) => {
    const now=Math.floor(Date.now()/1000);
    const header=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url');
    const body=Buffer.from(JSON.stringify({usuarioId:u.id,papel:u.papel,nome:u.nome,barbeiroId:null,clienteId:null,iat:now,exp:now+900})).toString('base64url');
    const signature=createHmac('sha256',process.env.SESSION_SECRET).update(header+'.'+body).digest('base64url');
    return 'barberos_sessao='+header+'.'+body+'.'+signature;
  };
  const call = async (path, opts={}) => {
    const r=await fetch(base+path,{...opts,redirect:'manual',headers:{'content-type':'application/json',...opts.headers}});
    const text=await r.text(); let body;try { body=JSON.parse(text); }catch { body=text; }
    return {status:r.status,body,headers:r.headers};
  };
  let checks=0;
  try {
    const roles=['DONO','GERENTE','RECEPCAO','BARBEIRO','CLIENTE']; const cookies={};
    for(let i=0;i<roles.length;i++){
      const u=await db.usuario.create({data:{nome:'Teste '+roles[i],telefone:'55000000000'+String(i),papel:roles[i]}});
      cookies[roles[i]]=await cookie(u);
    }
    assert.equal((await call('/api/recrutamento/vagas')).status,401);checks++;
    for(const role of ['RECEPCAO','BARBEIRO','CLIENTE']) { assert.equal((await call('/api/recrutamento/candidaturas',{headers:{cookie:cookies[role]}})).status,403);checks++; }
    const h={cookie:cookies.DONO};
    let r=await call('/api/recrutamento/vagas',{method:'POST',headers:h,body:JSON.stringify({titulo:'TESTE ISOLADO — Barbeiro',cidade:'Rio do Sul',descricao:'Vaga fictícia para validação, sem seleção real.',privacidade:'Dados fictícios usados exclusivamente neste teste.'})});
    assert.equal(r.status,201); const vaga=r.body;assert.equal(vaga.ativa,false);checks++;
    assert.equal((await call('/vagas/'+vaga.id)).status,404);checks++;
    await call('/api/recrutamento/vagas',{method:'PATCH',headers:h,body:JSON.stringify({id:vaga.id,ativa:true})});
    r=await call('/vagas/'+vaga.id+'?utm_source=instagram');assert.equal(r.status,200);assert.ok(r.body.includes('Sua candidatura'));checks++;
    const form={envioId:randomUUID(),nome:'Pessoa fictícia de teste',telefone:'11999998888',cidade:'Rio do Sul',experienciaMeses:0,servicos:['Barba'],disponibilidade:'Segunda a sexta',portfolio:'',instagram:'',cienciaPrivacidade:true,futurasOportunidades:false,origem:{utm_source:'instagram',utm_campaign:'teste-isolado'}};
    const send=(b)=>call('/api/recrutamento/publico/'+vaga.id,{method:'POST',body:JSON.stringify(b)});
    assert.equal((await send(form)).status,201); assert.equal((await send(form)).status,201);
    assert.equal(await db.candidaturaRecrutamento.count(),1);assert.equal(await db.candidatoRecrutamento.count(),1);checks++;
    r=await call('/api/recrutamento/candidaturas',{headers:h});assert.equal(r.body.total,1);let c=r.body.candidaturas[0];assert.equal(c.origem.utm_source,'instagram');checks++;
    assert.equal((await send({...form,nome:'Conteúdo alterado'})).status,409);checks++;
    const p='/api/recrutamento/candidaturas/'+c.id;
    r=await call(p,{method:'PATCH',headers:h,body:JSON.stringify({etapa:'BANCO',versao:0,motivo:'Teste de consentimento'})});assert.equal(r.status,422);checks++;
    r=await call(p,{method:'PATCH',headers:h,body:JSON.stringify({etapa:'ENTREVISTA',versao:0,motivo:'Portfólio a revisar na entrevista'})});assert.equal(r.status,200);checks++;
    r=await call(p,{method:'PATCH',headers:h,body:JSON.stringify({etapa:'TESTE',versao:0,motivo:'Versão desatualizada'})});assert.equal(r.status,409);checks++;
    assert.equal(await db.historicoRecrutamento.count(),1);checks++;
    const termo=await db.candidaturaRecrutamento.findUnique({where:{id:c.id}});assert.equal(termo.avisoPrivacidade,vaga.privacidade);assert.equal(termo.formularioVersao,'2026-10-v1');checks++;
    const concurrent={...form,envioId:randomUUID()};let rs=await Promise.all([send(concurrent),send(concurrent)]);
    for(const rr of rs) assert.ok([201,409].includes(rr.status));
    if(rs.some(x=>x.status===409)) assert.equal((await send(concurrent)).status,201);
    assert.equal(await db.candidaturaRecrutamento.count(),2);assert.equal(await db.candidatoRecrutamento.count(),2);checks++;
    assert.equal((await call('/recrutamento',{headers:h})).status,200);checks++;
    r=await call('/api/recrutamento/vagas',{headers:{cookie:cookies.GERENTE}});assert.equal(r.status,200);checks++;
    await call('/api/recrutamento/vagas',{method:'PATCH',headers:h,body:JSON.stringify({id:vaga.id,ativa:false})});
    assert.equal((await send({...form,envioId:randomUUID()})).status,404);assert.equal((await call('/vagas/'+vaga.id)).status,404);checks++;
    const audit=await db.auditoria.findMany({where:{entidade:'CandidaturaRecrutamento'}});assert.ok(audit.length>=3);assert.ok(!JSON.stringify(audit).includes('11999998888'));checks++;
    console.log('RECRUTAMENTO_INTEGRACAO_OK: '+checks+' verificações; banco isolado; nenhum dado operacional utilizado.');
  } finally { await db.$disconnect(); }
}
main().catch((e)=>{console.error(e.message);process.exit(1)});
