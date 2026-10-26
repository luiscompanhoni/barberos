import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/campanhas-equipe/route";
const m = vi.hoisted(() => ({ sessao:vi.fn(), campanha:vi.fn(), contar:vi.fn(), criar:vi.fn(), vendas:vi.fn(), lock:vi.fn(), criarCampanha:vi.fn() }));
vi.mock("@/lib/auth/sessao",()=>({exigirSessao:m.sessao,GESTAO:["DONO","GERENTE"]}));
vi.mock("@/lib/auditoria",()=>({auditar:vi.fn()}));
vi.mock("@/lib/campanha-equipe",()=>({vendasDaCampanha:m.vendas,painelCampanhas:vi.fn()}));
vi.mock("@/lib/db",()=>{const tx={$queryRaw:m.lock,campanhaEquipe:{findUniqueOrThrow:m.campanha,create:m.criarCampanha},bonusEquipe:{count:m.contar,create:m.criar}};return{db:{$transaction:(fn:(t:typeof tx)=>unknown)=>fn(tx)}};});
const req=(b:unknown)=>new Request("http://localhost/api/campanhas-equipe",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});
describe("rodadas adicionais à comissão",()=>{
  beforeEach(()=>{vi.clearAllMocks();m.sessao.mockResolvedValue({usuarioId:"u",papel:"BARBEIRO",barbeiroId:"b"});m.campanha.mockResolvedValue({id:"c",inicio:new Date(0),premios:[500,1000]});m.vendas.mockResolvedValue({ciclos:1});m.contar.mockResolvedValue(0);m.criar.mockResolvedValue({id:"bonus",ciclo:1,valorCentavos:500});});
  it("barbeiro não cria campanha",async()=>{const b={acao:"criar",nome:"Vendas",inicio:"2026-10-01T00:00:00.000Z",fim:"2099-10-31T00:00:00.000Z",metaQuantidade:10,metaCentavos:30000,premios:[500]};expect((await POST(req(b))).status).toBe(403);expect(m.criarCampanha).not.toHaveBeenCalled();});
  it("sem vínculo com barbeiro não gira em nome de outro",async()=>{m.sessao.mockResolvedValue({usuarioId:"r",papel:"RECEPCAO",barbeiroId:null});expect((await POST(req({acao:"girar",campanhaId:"c",barbeiroId:"b"}))).status).toBe(403);expect(m.criar).not.toHaveBeenCalled();});
  it("não permite gastar a mesma rodada novamente",async()=>{m.contar.mockResolvedValue(1);expect((await POST(req({acao:"girar",campanhaId:"c"}))).status).toBe(422);expect(m.criar).not.toHaveBeenCalled();expect(m.lock).toHaveBeenCalledOnce();});
  it("sorteia no servidor e vincula ao barbeiro da sessão",async()=>{expect((await POST(req({acao:"girar",campanhaId:"c",barbeiroId:"outro",valorCentavos:99999}))).status).toBe(200);expect(m.criar.mock.calls[0][0].data).toMatchObject({campanhaId:"c",barbeiroId:"b",ciclo:1});expect([500,1000]).toContain(m.criar.mock.calls[0][0].data.valorCentavos);});
});
