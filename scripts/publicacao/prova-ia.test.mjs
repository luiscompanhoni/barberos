import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";

test("bundle executa sem SDK externo e valida GET, mensagem sintética e autenticação recusada", async () => {
  const pasta = mkdtempSync(join(tmpdir(), "prova-sdk-")), arquivo = join(pasta, "probe.cjs");
  let recusar = false;
  const chamadas = [];
  const servidor = createServer((req, res) => {
    chamadas.push(req.method);
    assert.equal(req.headers['x-api-key'], 'chave-sintetica-nao-expor');
    res.setHeader('content-type', 'application/json');
    if (recusar) { res.statusCode = 401; res.end(JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } })); return; }
    if (req.method === 'GET') { res.end(JSON.stringify({ id: 'modelo-sintetico', type: 'model' })); return; }
    let corpo = '';
    req.on('data', b => { corpo += b; });
    req.on('end', () => {
      const b = JSON.parse(corpo);
      assert.equal(b.model, 'modelo-sintetico'); assert.equal(b.max_tokens, 32);
      assert.equal(b.messages[0].content, 'Teste técnico interno. Responda somente OK.');
      res.end(JSON.stringify({ id: 'mensagem-sintetica', type: 'message', content: [{ type: 'text', text: 'OK' }] }));
    });
  });
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  try {
    await build({ entryPoints: ['scripts/publicacao/prova-ia.cjs'], outfile: arquivo,
      bundle: true, platform: 'node', format: 'cjs', minify: true, logLevel: 'error' });
    const rodar = acao => new Promise((resolve, reject) => {
      const filho = spawn(process.execPath, [arquivo], { cwd: pasta, env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        ANTHROPIC_API_KEY: 'chave-sintetica-nao-expor', ANTHROPIC_BASE_URL: `http://127.0.0.1:${servidor.address().port}`,
        BOT_MODELO: 'modelo-sintetico', BARBEROS_PROVA_IA: acao,
      }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      filho.stdout.on('data', b => { texto += b; });
      filho.on('error', reject);
      filho.on('close', code => {
        try { assert.equal(code, 0); assert.ok(!texto.includes('chave-sintetica-nao-expor')); resolve(JSON.parse(texto)); }
        catch (e) { reject(e); }
      });
    });
    const consulta = await rodar('consulta');
    assert.equal(consulta.disponivel, true); assert.equal(consulta.sdkExternalizado, false);
    const mensagem = await rodar('mensagem'); assert.equal(mensagem.modeloRespondeu, true);
    recusar = true;
    const recusada = await rodar('consulta');
    assert.equal(recusada.status, 401); assert.equal(recusada.motivo, 'chave_invalida');
    assert.deepEqual(chamadas, ['GET', 'POST', 'GET']);
  } finally {
    await new Promise(resolve => servidor.close(resolve));
    rmSync(pasta, { recursive: true, force: true });
  }
});
