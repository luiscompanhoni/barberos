// Somente banco local descartável, modelo falso e fontes sintéticas; nenhum efeito externo.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Modelo } from "@/lib/bot/agente";
import { criarExecucao, decidirExecucao, configurarAgentes, painelAgentes } from "@/lib/agentes/servico";
import { processarUmaExecucao } from "@/lib/agentes/processar";
import { criarRotinaAgente, enfileirarRotinasAgentes } from "@/lib/agentes/rotinas";
import { hashAgente } from "@/lib/agentes/regras";
import { prepararPreservacaoAgentes, testarRevisaoAgentes } from "./teste-agentes-revisao";

const url = new URL(process.env.DATABASE_URL ?? "http://invalido");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/barberos_agentes_teste") throw new Error("Use somente o banco local descartável barberos_agentes_teste.");
process.env.AGENTES_HABILITADOS = "true";
process.env.AGENTES_EXECUCAO_ATIVA = "true";
process.env.ANTHROPIC_API_KEY = "fixture-sem-provedor-real";
globalThis.fetch = async () => { throw new Error("Rede externa proibida neste teste"); };
const lote = randomUUID();
const contexto = async () => ({ fontes: [{ nome: "Fixture sintética", consultadoEm: new Date().toISOString(), dados: { atendimentos: 4 } }], integracoes: [], limites: [], anterior: null });
const resultado = { resumo: "Rascunho sintético para revisão", entregaveis: ["Roteiro local"], alertas: [], proximosPassos: [{ agenteId: "conteudo", tarefa: "Produzir roteiro com base na estratégia aprovada" }] };
function modelo(r = resultado): Modelo {
  return { criar: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(r) }], usage: { input_tokens: 5, output_tokens: 9 } }) as Awaited<ReturnType<Modelo["criar"]>> };
}
let ok = 0;
function passou(nome: string) { ok++; console.log(`OK ${nome}`); }

async function main() {
  const conferirPreservacao = await prepararPreservacaoAgentes();
  // Retira apenas trabalhos de execuções anteriores deste próprio teste descartável.
  await db.agenteExecucao.updateMany({ where: { solicitante: { telefone: { startsWith: "agentes-" } } }, data: { estado: "CANCELADO", lease: null, leaseAte: null } });
  await db.agenteRotina.updateMany({ where: { usuario: { telefone: { startsWith: "agentes-" } } }, data: { ativa: false } });
  await db.agenteConfiguracao.update({ where: { id: 1 }, data: { pausada: false, limiteDiario: 200, revisao: { increment: 1 } } });
  const dono = await db.usuario.create({ data: { nome: "Dono sintético agentes", telefone: `agentes-${lote}`, papel: "DONO" } });
  const gerente = await db.usuario.create({ data: { nome: "Gerente sintético", telefone: `gerente-${lote}`, papel: "GERENTE" } });
  const p = { agenteId: "estrategia", tarefa: "Preparar estratégia para ocupar horários da Black", chave: lote };
  await assert.rejects(criarExecucao(gerente.id, p)); passou("permissão de gestão não concede acesso aos agentes");
  const [a,b] = await Promise.all([criarExecucao(dono.id, p), criarExecucao(dono.id, p)]);
  assert.equal(a.id,b.id); await assert.rejects(criarExecucao(dono.id, { ...p, tarefa: "Outra tarefa usando a mesma chave" })); passou("criação concorrente idempotente e conflito de conteúdo");
  const resultados = await Promise.all([processarUmaExecucao(dono.id,{modelo:modelo(),contexto}),processarUmaExecucao(dono.id,{modelo:modelo(),contexto})]);
  assert.equal(resultados.filter(x=>x.processado).length,1);
  const pronto = await db.agenteExecucao.findUniqueOrThrow({where:{id:a.id}});
  assert.equal(pronto.estado,"AGUARDA_APROVACAO"); assert.equal(pronto.resultadoHash,hashAgente(resultado)); passou("lease impede duas execuções simultâneas");
  const derivados = await db.agenteExecucao.findMany({where:{origemId:a.id}});
  assert.equal(derivados.length,1); assert.equal(derivados[0].agenteId,"conteudo"); passou("estratégia encaminha preparação de conteúdo sem publicar");
  await assert.rejects(decidirExecucao(dono.id,a.id,{acao:"aprovar",revisao:pronto.revisao,resultadoHash:"0".repeat(64)}));
  await Promise.all([1,2].map(()=>decidirExecucao(dono.id,a.id,{acao:"aprovar",revisao:pronto.revisao,resultadoHash:pronto.resultadoHash!})));
  assert.equal(await db.agenteExecucao.count({where:{origemId:a.id}}),1); passou("aprovação ligada ao hash e reenvio não duplica encaminhamento");
  const filho = derivados[0];
  const saidaConteudo = { ...resultado, proximosPassos: [{agenteId:"trafego",tarefa:"Preparar plano de tráfego com mídia a aprovar"}] };
  await processarUmaExecucao(dono.id,{modelo:modelo(saidaConteudo),contexto});
  assert.equal(await db.agenteExecucao.count({where:{origemId:filho.id}}),0); passou("conteúdo não libera tráfego sem aprovação");
  const atualFilho = await db.agenteExecucao.findUniqueOrThrow({where:{id:filho.id}});
  await decidirExecucao(dono.id,filho.id,{acao:"cancelar",revisao:atualFilho.revisao});
  const c = await criarExecucao(dono.id,{...p,chave:randomUUID()});
  let iniciou!:()=>void, liberar!:()=>void;
  const iniciada=new Promise<void>(r=>{iniciou=r;}), espera=new Promise<void>(r=>{liberar=r;});
  const lento:Modelo={criar:async params=>{iniciou();await espera;return modelo().criar(params);}};
  const pendente=processarUmaExecucao(dono.id,{modelo:lento,contexto}); await iniciada;
  const rodando=await db.agenteExecucao.findUniqueOrThrow({where:{id:c.id}});
  await decidirExecucao(dono.id,c.id,{acao:"cancelar",revisao:rodando.revisao}); liberar(); await pendente;
  const cancelada=await db.agenteExecucao.findUniqueOrThrow({where:{id:c.id}});
  assert.equal(cancelada.estado,"CANCELADO"); assert.equal(cancelada.resultado,null);
  assert.equal(cancelada.tokensEntrada,5); assert.equal(cancelada.tokensSaida,9);
  assert.equal(await db.agenteExecucao.count({where:{origemId:c.id}}),0);
  assert.equal(await db.auditoria.count({where:{entidadeId:c.id,acao:"agente.resultado_descartado"}}),1);
  passou("cancelamento descarta resultado e encaminhamento, preservando consumo auditado");
  const cfg = await db.agenteConfiguracao.findUniqueOrThrow({where:{id:1}});
  await configurarAgentes(dono.id,{pausada:true,limiteDiario:20,revisao:cfg.revisao});
  const d=await criarExecucao(dono.id,{...p,chave:randomUUID()});
  assert.equal((await processarUmaExecucao(dono.id,{modelo:modelo(),contexto})).processado,false); passou("pausa global impede execução");
  await configurarAgentes(dono.id,{pausada:false,limiteDiario:1,revisao:cfg.revisao+1});
  assert.equal((await processarUmaExecucao(dono.id,{modelo:modelo(),contexto})).processado,false); passou("limite diário limita chamadas inclusive após cancelamento");
  await configurarAgentes(dono.id,{pausada:false,limiteDiario:200,revisao:cfg.revisao+2});
  await db.usuario.update({where:{id:dono.id},data:{ativo:false}});
  await assert.rejects(painelAgentes(dono.id)); await processarUmaExecucao(undefined,{modelo:modelo(),contexto});
  assert.equal((await db.agenteExecucao.findUniqueOrThrow({where:{id:d.id}})).estado,"BLOQUEADO"); passou("revogação bloqueia leitura e execução pendente");
  await db.usuario.update({where:{id:dono.id},data:{ativo:true}});
  const rotina=await criarRotinaAgente(dono.id,{...p,chave:randomUUID(),nome:"Resumo sintético",cadaMinutos:60,ativa:true});
  const agora=new Date(Date.now()+3_600_001);
  await Promise.all([enfileirarRotinasAgentes(agora),enfileirarRotinasAgentes(agora)]);
  assert.equal(await db.agenteExecucao.count({where:{rotinaId:rotina.id}}),1);
  await enfileirarRotinasAgentes(new Date(+agora+10*3_600_000));
  assert.equal(await db.agenteExecucao.count({where:{rotinaId:rotina.id}}),1); passou("rotina persistente não duplica nem acumula após atraso");
  ok += await testarRevisaoAgentes();
  await conferirPreservacao();
  assert.ok(await db.auditoria.count({where:{acao:{startsWith:"agente."}}})); passou("dados financeiros preservados e decisões auditadas");
  console.log(`${ok} verificações de agentes passaram.`);
}
main().finally(()=>db.$disconnect()).catch(e=>{console.error(e);process.exitCode=1;});
