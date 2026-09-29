/**
 * Primeiro acesso em producao: cria (ou reativa) o usuario dono.
 * Uso: npm run criar-dono -- "(11) 99999-8888" "Nome do Dono" "Nome da Barbearia"
 */
import { PrismaClient } from "@prisma/client";
import { normalizarTelefone } from "../src/lib/telefone";

const db = new PrismaClient();

async function main() {
  const [telBruto, nome, barbearia] = process.argv.slice(2);
  const telefone = normalizarTelefone(telBruto ?? "");
  if (!telefone || !nome?.trim()) {
    console.error('Uso: npm run criar-dono -- "(11) 99999-8888" "Nome do Dono" "Nome da Barbearia"');
    process.exit(1);
  }
  const u = await db.usuario.upsert({
    where: { telefone },
    create: { telefone, nome: nome.trim(), papel: "DONO" },
    update: { papel: "DONO", ativo: true, nome: nome.trim() },
  });
  await db.configuracao.upsert({
    where: { id: 1 },
    create: { id: 1, ...(barbearia ? { nomeBarbearia: barbearia.trim() } : {}) },
    update: barbearia ? { nomeBarbearia: barbearia.trim() } : {},
  });
  console.log(`Dono pronto: ${u.nome} (${u.telefone}). Entre em /entrar com esse celular.`);
}

main().finally(() => db.$disconnect());
