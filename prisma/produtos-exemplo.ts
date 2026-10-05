/**
 * Produtos de exemplo do bar e da loja (desenvolvimento). Rodar: npm run db:produtos
 * Cria so se ainda nao houver produto; o saldo inicial entra como movimento de ENTRADA.
 */
import { PrismaClient, type CategoriaProduto } from "@prisma/client";

const EXEMPLOS: { nome: string; categoria: CategoriaProduto; preco: number; custo: number; saldo: number; minimo: number; unidade?: string }[] = [
  { nome: "Cerveja long neck", categoria: "BAR", preco: 1200, custo: 550, saldo: 48, minimo: 12 },
  { nome: "Chopp 300 ml", categoria: "BAR", preco: 1400, custo: 500, saldo: 60, minimo: 15, unidade: "copo" },
  { nome: "Refrigerante lata", categoria: "BAR", preco: 700, custo: 320, saldo: 24, minimo: 6 },
  { nome: "Água sem gás", categoria: "BAR", preco: 500, custo: 150, saldo: 30, minimo: 8 },
  { nome: "Energético", categoria: "BAR", preco: 1500, custo: 780, saldo: 4, minimo: 6 },
  { nome: "Dose de whisky", categoria: "BAR", preco: 2500, custo: 900, saldo: 20, minimo: 5, unidade: "dose" },
  { nome: "Pomada modeladora", categoria: "LOJA", preco: 4500, custo: 2100, saldo: 8, minimo: 3 },
  { nome: "Óleo para barba", categoria: "LOJA", preco: 5900, custo: 2600, saldo: 5, minimo: 2 },
  { nome: "Shampoo anticaspa", categoria: "LOJA", preco: 3900, custo: 1700, saldo: 2, minimo: 3 },
  { nome: "Lâmina descartável", categoria: "USO_INTERNO", preco: 0, custo: 90, saldo: 200, minimo: 50 },
  { nome: "Pós-barba (uso interno)", categoria: "USO_INTERNO", preco: 0, custo: 3500, saldo: 3, minimo: 1, unidade: "frasco" },
];

export async function criarProdutosExemplo(db: PrismaClient) {
  if (await db.produto.count()) return 0;
  for (const e of EXEMPLOS) {
    await db.produto.create({
      data: {
        nome: e.nome, categoria: e.categoria, precoCentavos: e.preco, custoCentavos: e.custo,
        estoque: e.saldo, estoqueMinimo: e.minimo, unidade: e.unidade ?? "un",
        movimentos: { create: { tipo: "ENTRADA", quantidade: e.saldo, saldoApos: e.saldo, custoUnitarioCentavos: e.custo, motivo: "Estoque inicial (exemplo)" } },
      },
    });
  }
  return EXEMPLOS.length;
}

if (process.argv[1]?.endsWith("produtos-exemplo.ts")) {
  const db = new PrismaClient();
  criarProdutosExemplo(db)
    .then((n) => console.log(n ? `${n} produtos criados.` : "Já existem produtos: nada feito."))
    .finally(() => db.$disconnect());
}
