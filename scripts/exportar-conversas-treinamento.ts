/** Exportação privada de leitura. Não chama bot, gateway, webhook nem transporte WhatsApp. */
import { PrismaClient } from "@prisma/client";
import { mkdir, open } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";

async function main() {
  const destino = process.argv[2];
  if (!destino) throw new Error("Uso: npx tsx --env-file=.env scripts/exportar-conversas-treinamento.ts .data/conversas.jsonl");
  const raizPrivada = resolve(".data");
  const caminho = resolve(destino);
  const rel = relative(raizPrivada, caminho);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("O destino deve ficar dentro de .data/ (ignorado pelo Git).");
  await mkdir(dirname(caminho), { recursive: true });
  const arquivo = await open(caminho, "wx", 0o600); // nunca sobrescreve arquivo anterior
  const db = new PrismaClient();
  const ate = new Date();
  let cursor: string | undefined;
  let total = 0;
  const conversas = new Set<string>();
  try {
    await arquivo.write(JSON.stringify({ tipo: "manifesto", ate: ate.toISOString(), fonte: "BarberOS.mensagens", cobertura: "Só registros do BarberOS; mídia original não armazenada não é recuperável aqui", privado: true }) + "\n");
    for (;;) {
      const pagina = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return tx.mensagem.findMany({
          where: { criadoEm: { lte: ate } }, orderBy: { id: "asc" }, take: 500,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true, conversaId: true, autor: true, texto: true, erro: true, criadoEm: true, entregueEm: true, lidaEm: true },
        });
      });
      if (!pagina.length) break;
      for (const m of pagina) {
        conversas.add(m.conversaId);
        await arquivo.write(JSON.stringify({ tipo: "mensagem", ...m }) + "\n");
      }
      total += pagina.length;
      cursor = pagina.at(-1)!.id;
    }
    await arquivo.write(JSON.stringify({ tipo: "fim", mensagens: total, conversas: conversas.size, concluido: true }) + "\n");
    console.log(`Exportação concluída: ${total} mensagens em ${conversas.size} conversas. Conteúdo privado salvo em .data/.`);
  } finally {
    await arquivo.close();
    await db.$disconnect();
  }
}
main().catch(() => { console.error("Exportação não concluída. Confira acesso de leitura ao banco e o arquivo parcial privado; nenhum envio foi feito."); process.exitCode = 1; });
