import { test } from "node:test";
import assert from "node:assert/strict";
import { ambienteRender, composicao } from "../render.mjs";
test("texto vira conteúdo, nunca script, URL ou markup executável", () => {
  const html = composicao([{ inicio: 1, fim: 4, texto: '<img src="https://evil.test" onerror="x()">', audio: true }, { inicio: 0, fim: 2, texto: "Final", audio: false }]);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes('data-duration="5"'));
  assert.ok(html.includes('data-start="3"'));
  assert.ok(html.includes('data-has-audio="true"'));
  assert.ok(html.includes('muted'));
  assert.ok(!html.includes("<script"));
});
test("subprocessos não herdam credenciais ou plugins do aplicativo", () => {
  process.env.DATABASE_URL = "sentinel"; process.env.ESTUDIO_WORKER_TOKEN = "sentinel"; process.env.ANTHROPIC_API_KEY = "sentinel"; process.env.NODE_OPTIONS = "--inspect";
  const env = ambienteRender();
  for (const name of ["DATABASE_URL", "ESTUDIO_WORKER_TOKEN", "ANTHROPIC_API_KEY", "NODE_OPTIONS"]) { assert.equal(env[name], undefined); delete process.env[name]; }
  assert.equal(env.HYPERFRAMES_NO_TELEMETRY, "1");
  assert.equal(env.HYPERFRAMES_NO_AUTO_INSTALL, "1");
});
