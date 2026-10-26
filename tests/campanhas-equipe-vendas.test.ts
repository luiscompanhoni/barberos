import { beforeEach, expect, it, vi } from "vitest";
import { lancarBonusNaFolha, vendasDaCampanha } from "@/lib/campanha-equipe";
import { competenciaDoBonus } from "@/lib/equipe-regras";
import { db } from "@/lib/db";
vi.mock("@/lib/db",()=>({db:{comanda:{findMany:vi.fn()}}}));
it("bônus entra na folha do mês, ou do seguinte se a atual já fechou", async () => {
  expect(competenciaDoBonus("2026-10", false)).toBe("2026-10");
  expect(competenciaDoBonus("2026-10", true)).toBe("2026-11");
  expect(competenciaDoBonus("2026-12", true)).toBe("2027-01");
  const criar = vi.fn(async ({ data }) => ({ id: "l1", ...data }));
  const tx = { checklistPessoa: { findUnique: async () => ({ id: "p1" }) }, folhaPagamento: { findUnique: async () => null }, folhaLancamento: { create: criar } };
  const l = await lancarBonusNaFolha(tx as never, { barbeiroId: "b", valorCentavos: 5000, descricao: "Bônus", porId: "u", fuso: "America/Sao_Paulo" });
  expect(l).toMatchObject({ pessoaId: "p1", tipo: "BONUS", valorCentavos: 5000 });
  const semFolha = { ...tx, checklistPessoa: { findUnique: async () => null } };
  await expect(lancarBonusNaFolha(semFolha as never, { barbeiroId: "b", valorCentavos: 5000, descricao: "Bônus", porId: "u", fuso: "America/Sao_Paulo" })).rejects.toThrow(/folha de pagamento/);
});
const listar=vi.mocked(db.comanda.findMany);
beforeEach(()=>vi.clearAllMocks());
it("exclui comandas não quitadas e estornadas e rateia desconto",async()=>{
  const item={barbeiroId:"b",produtoId:"p",quantidade:10,precoUnitCentavos:4000};
  const comanda=(valor:number,estornado=0)=>({itens:[item],descontoCentavos:10000,pagamentos:[{status:"PAGO",valorCentavos:valor,estornadoCentavos:estornado}]});
  listar.mockResolvedValue([comanda(30000),comanda(29999),comanda(40000,1000)] as never);
  expect(await vendasDaCampanha(db,{inicio:new Date(0),fim:new Date(),metaQuantidade:10,metaCentavos:30000},"b")).toEqual({quantidade:10,receita:30000,ciclos:1});
  expect(listar.mock.calls[0][0]?.where).toMatchObject({status:"FECHADA",itens:{some:{barbeiroId:"b",produtoId:{not:null}}}});
});
