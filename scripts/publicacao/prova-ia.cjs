/** Prova técnica sintética, com o mesmo SDK, modelo e autenticação do bot. */
const Anthropic = require('@anthropic-ai/sdk');
const { createRequire } = require('node:module');
(async () => {
  const modelo = process.env.BOT_MODELO || 'claude-opus-5-5';
  const mensagem = process.env.BARBEROS_PROVA_IA === 'mensagem';
  const r = { somenteConsulta: !mensagem, modelo, apiKeyConfigurada: !!process.env.ANTHROPIC_API_KEY,
    authTokenConfigurado: !!process.env.ANTHROPIC_AUTH_TOKEN, endpointCustomizado: !!process.env.ANTHROPIC_BASE_URL };
  try { createRequire('/app/server.js').resolve('@anthropic-ai/sdk'); r.sdkExternalizado = true; }
  catch { r.sdkExternalizado = false; }
  try {
    const c = new Anthropic.default({ timeout: 30000, maxRetries: 0 });
    if (mensagem) {
      const m = await c.beta.messages.create({ model: modelo, max_tokens: 32,
        messages: [{ role: 'user', content: 'Teste técnico interno. Responda somente OK.' }] });
      r.modeloRespondeu = m.content.some(x => x.type === 'text' && x.text.trim());
    } else {
      const m = await c.models.retrieve(modelo);
      r.disponivel = m.id === modelo; r.modeloRetornado = m.id;
    }
  } catch (e) {
    r.disponivel = false; r.modeloRespondeu = false; r.status = Number.isInteger(e.status) ? e.status : null;
    const t = e.error?.error?.type || e.error?.type;
    r.tipo = ['authentication_error', 'permission_error', 'not_found_error', 'invalid_request_error',
      'rate_limit_error', 'overloaded_error', 'api_error'].includes(t) ? t : 'indefinido';
    const texto = String(e.error?.error?.message || e.message || '');
    r.motivo = /credit balance|billing|payment required/i.test(texto) ? 'saldo_ou_faturamento'
      : /expired|expirado/i.test(texto) ? 'credencial_expirada' : /invalid.*api.?key/i.test(texto) ? 'chave_invalida'
      : /not found|does not exist/i.test(texto) ? 'modelo_indisponivel' : /timeout|timed out/i.test(texto) ? 'tempo_limite'
      : /connection|ECONN|fetch failed/i.test(texto) ? 'conexao' : 'nao_classificado';
  }
  console.log(JSON.stringify(r));
})().catch(() => process.exit(1));
