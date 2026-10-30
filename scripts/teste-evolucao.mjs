/** Fluxos isolados da evolução da equipe. Nunca usa os dados do banco de desenvolvimento. */
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const origem = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(origem.hostname)) throw new Error('Os fluxos de evolução exigem PostgreSQL local.');
const casos = [
  ['acessos', 'tests/acessos.fluxo.ts'],
  ['agenda', 'scripts/teste-agenda-evolucao.ts'],
  [`reunioes_${Date.now()}`, 'tests/reunioes.fluxo.ts'],
  ['qualidade', 'tests/avaliacoes.fluxo.ts'],
  ['recompras', 'scripts/teste-recompras.ts'],
  ['desempenho', 'tests/desempenho.fluxo.ts'],
  ['notificacoes', 'tests/notificacoes.fluxo.ts'],
  ['notificacoes_geracao', 'tests/notificacoes-geracao.fluxo.ts'],
];
const admin = new PrismaClient();
let falhas = 0;
try {
  for (const [nome, arquivo] of casos) {
    const banco = `barberos_test_${nome}`;
    const existe = await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname = ${banco}`;
    if (!existe.length) {
      if (!/^barberos_test_[a-z0-9_]+$/.test(banco)) throw new Error('Nome de banco de teste inválido.');
      await admin.$executeRawUnsafe(`CREATE DATABASE "${banco}"`);
    }
    const url = new URL(origem); url.pathname = `/${banco}`;
    const env = { ...process.env, DATABASE_URL: url.href, OTP_PROVIDER: 'console', WHATSAPP_PROVIDER: 'simulador', PAGAMENTOS_PROVIDER: 'simulado', PUSH_PROVIDER: 'simulado' };
    const migrate = spawnSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], { env, encoding: 'utf8', shell: process.platform === 'win32' });
    if (migrate.status !== 0) { console.error(`FALHOU migração ${nome}\n${migrate.stderr}`); falhas++; continue; }
    const resultado = spawnSync('npx', ['--no-install', 'tsx', '--env-file=.env', arquivo], { env, stdio: 'inherit', shell: process.platform === 'win32' });
    if (resultado.status !== 0) { console.error(`FALHOU evolução ${nome}`); falhas++; }
    else console.log(`OK evolução ${nome.replace(/_\d+$/, '')}`);
  }
} finally { await admin.$disconnect(); }
if (falhas) process.exitCode = 1;
