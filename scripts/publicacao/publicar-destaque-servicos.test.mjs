import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('publicação do destaque fecha revisão, escopo, CI e instalação antes de qualquer acesso à VPS', () => {
  const y = readFileSync(new URL('../../.github/workflows/publicar-destaque-servicos.yml', import.meta.url), 'utf8');
  const alvo = '28e5266888ad87078cecd046dca73bb3888c0548';
  assert.ok(y.includes('ref: ' + alvo));
  assert.ok(y.includes("git('rev-parse','HEAD^') !== pai"));
  assert.ok(y.includes("git('diff','--name-only',pai,alvo)"));
  assert.ok(y.includes("['docs/design.md','src/app/black-app.css','src/components/cliente/AgendarTela.tsx']"));
  assert.ok(y.includes('new Set([process.env.GITHUB_SHA, alvo])'));
  assert.ok(y.includes("r.headBranch === 'main' && r.event === 'push'"));
  assert.ok(y.includes('process.env.IMAGEM_ANTERIOR !=='));
  assert.ok(y.indexOf('Escopo da publicação divergente.') < y.indexOf('VPS_SSH_KEY:'));
  assert.ok(y.includes('run: GITHUB_SHA="$REVISAO_PUBLICACAO" node scripts/publicacao/publicar-vps.mjs'));
  assert.ok(!y.includes('$GITHUB_SHA'));
  assert.ok(!y.includes('ref: ${{ github.sha }}'));
  for (const s of ["github.ref == 'refs/heads/main'", 'persist-credentials: false', 'fetch-depth: 2',
    'group: publicacao-producao', 'cancel-in-progress: false', 'npm ci --ignore-scripts --no-audit --no-fund',
    'npm run check:publicacao:servidor', 'teste-backup-container.py', 'tests/smoke-templates.mjs',
    'retention-days: 1', 'if-no-files-found: ignore']) assert.ok(y.includes(s), s);
  assert.ok(y.indexOf('Conferir restauração e render') < y.indexOf('Publicar com backup e recuperação'));
  const paths = [...y.matchAll(/^          path: (.+)$/gm)].map(m => m[1]);
  assert.deepEqual(paths, ['${{ runner.temp }}/publicacao.cifrada.json']);
});
