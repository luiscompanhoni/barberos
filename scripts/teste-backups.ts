// Teste do aviso de backup do painel (atrasado, com erro, nenhum conferido), contra o banco de DESENVOLVIMENTO.
// O backup em si (deploy/backup.sh) roda no container; aqui so a leitura da tabela "backups". Rodar: npm run teste:backups
import { alertaBackup, listarBackups } from "@/lib/backups";
import { db } from "@/lib/db";

const ok = (c: boolean, msg: string) => { console.log(`${c ? "OK  " : "FALHOU"} ${msg}`); if (!c) process.exitCode = 1; };
const H = 3_600_000;
const PREFIXO = "teste-backup-";

async function main() {
  const env = { NODE_ENV: process.env.NODE_ENV, AMBIENTE: process.env.AMBIENTE };
  const antes = await db.backupRegistro.findMany();
  await db.backupRegistro.deleteMany({});
  const agora = Date.now();
  const novo = (id: string, horasAtras: number, x: { restaurado?: boolean; erro?: string | null; tipo?: string } = {}) =>
    db.backupRegistro.create({ data: { id: PREFIXO + id, tipo: x.tipo ?? "DIARIO", arquivo: `${id}.sql.gz`, bytes: 1000, restaurado: x.restaurado ?? true, conferencia: "60 tabelas", foraDoServidor: false, erro: x.erro ?? null, criadoEm: new Date(agora - horasAtras * H) } });
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.AMBIENTE;
    ok((await alertaBackup(agora))?.titulo === "Nenhum backup conferido ainda", "sem backup: avisa");
    await novo("deploy", 1, { restaurado: false, tipo: "DEPLOY" });
    ok((await alertaBackup(agora))?.titulo === "Nenhum backup conferido ainda", "cópia de antes do deploy não conta como conferida");
    await novo("ontem", 20);
    ok((await alertaBackup(agora)) === null, "backup conferido há 20 h: tudo certo");
    await db.backupRegistro.update({ where: { id: PREFIXO + "ontem" }, data: { criadoEm: new Date(agora - 30 * H) } });
    await db.backupRegistro.update({ where: { id: PREFIXO + "deploy" }, data: { criadoEm: new Date(agora - 31 * H) } });
    ok((await alertaBackup(agora))?.titulo === "Backup atrasado", "último conferido há 30 h: atrasado");
    await novo("falhou", 0.5, { restaurado: false, erro: "Restauração de teste falhou: x" });
    const a = await alertaBackup(agora);
    ok(a?.titulo === "O último backup teve problema" && a.detalhe.includes("Restauração"), "último com erro: mostra o erro");
    process.env.AMBIENTE = "homologacao";
    ok((await alertaBackup(agora)) === null, "homologação não avisa de backup");
    const l = await listarBackups();
    ok(l.backups.length === 3 && typeof l.backups[0].bytes === "number" && l.backups[0].id === PREFIXO + "falhou", "lista do painel: mais recente primeiro");
  } finally {
    Object.assign(process.env, env);
    if (env.AMBIENTE === undefined) delete process.env.AMBIENTE;
    await db.backupRegistro.deleteMany({ where: { id: { startsWith: PREFIXO } } });
    if (antes.length) await db.backupRegistro.createMany({ data: antes, skipDuplicates: true });
  }
  console.log(process.exitCode ? "\nAlgum teste FALHOU." : "\nTodos os testes passaram.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
