import { beforeEach, expect, it, vi } from "vitest";
import { vendasDaCampanha } from "@/lib/campanha-equipe";
import { db } from "@/lib/db";
vi.mock("@/lib/db",()=>({db:{comanda:{findMany:vi.fn()}}}));
const listar=vi.mocked(db.comanda.findMany);
beforeEach(()=>vi.clearAllMocks());
it("exclui comandas não quitadas e estornadas e rateia desconto",async()=>{
  const item={barbeiroId:"b",produtoId:"p",quantidade:10,precoUnitCentavos:4000};
  const comanda=(valor:number,estornado=0)=>({itens:[item],descontoCentavos:10000,pagamentos:[{status:"PAGO",valorCentavos:valor,estornadoCentavos:estornado}]});
  listar.mockResolvedValue([comanda(30000),comanda(29999),comanda(40000,1000)] as never);
  expect(await vendasDaCampanha(db,{inicio:new Date(0),fim:new Date(),metaQuantidade:10,metaCentavos:30000},"b")).toEqual({quantidade:10,receita:30000,ciclos:1});
  expect(listar.mock.calls[0][0]?.where).toMatchObject({status:"FECHADA",itens:{some:{barbeiroId:"b",produtoId:{not:null}}}});
});
