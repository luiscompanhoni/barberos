/**
 * Situacao dos backups do banco (a tabela "backups" e escrita pelo container de backup, deploy/backup.sh).
 * Backup que nunca foi restaurado nao conta: o "ultimo bom" e o que passou na restauracao de teste.
 */
import { db } from "@/lib/db";

const HORA = 3_600_000;
/** Um por dia: passou de 26 h sem backup conferido, avisa. */
const LIMITE_HORAS = 26;

const emProducao = () => process.env.NODE_ENV === "production" && process.env.AMBIENTE !== "homologacao";
export const copiaForaLigada = () => !!process.env.BACKUP_S3_BUCKET;

export async function listarBackups() {
  const bs = await db.backupRegistro.findMany({ orderBy: { criadoEm: "desc" }, take: 15 });
  return {
    foraLigada: copiaForaLigada(),
    backups: bs.map((b) => ({ ...b, bytes: Number(b.bytes) })),
  };
}

/** Aviso para o painel do dono (null = tudo certo, ou fora da producao). */
export async function alertaBackup(agora = Date.now()) {
  if (!emProducao()) return null;
  const [ultimo, ultimoBom] = await Promise.all([
    db.backupRegistro.findFirst({ orderBy: { criadoEm: "desc" } }),
    db.backupRegistro.findFirst({ where: { restaurado: true, erro: null }, orderBy: { criadoEm: "desc" } }),
  ]);
  if (ultimo?.erro) return { titulo: "O último backup teve problema", detalhe: ultimo.erro };
  if (!ultimoBom) return { titulo: "Nenhum backup conferido ainda", detalhe: "O backup roda todo dia às 03h e assim que o servidor sobe. Veja em Configurações → Backups." };
  const horas = Math.floor((agora - +ultimoBom.criadoEm) / HORA);
  if (horas > LIMITE_HORAS) return { titulo: "Backup atrasado", detalhe: `O último backup conferido foi há ${horas} horas.` };
  return null;
}
