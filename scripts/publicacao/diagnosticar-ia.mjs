/** Consulta de disponibilidade: GET ao modelo existente, sem mensagens nem dados de clientes. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parametros } from "./consultar-vps.mjs";
import { cifrar } from "./cifrar-relatorio.mjs";
const shell = v => "'" + v.replace(/'/g, "'\\''") + "'";
const programa = String.raw`
const Anthropic=require('@anthropic-ai/sdk');
(async()=>{
 const modelo=process.env.BOT_MODELO||'claude-opus-5-5';
 const r={somenteConsulta:true,modelo,apiKeyConfigurada:!!process.env.ANTHROPIC_API_KEY,authTokenConfigurado:!!process.env.ANTHROPIC_AUTH_TOKEN,endpointCustomizado:!!process.env.ANTHROPIC_BASE_URL};
 try{const c=new Anthropic.default({timeout:15000,maxRetries:0});const m=await c.models.retrieve(modelo);r.disponivel=m.id===modelo;r.modeloRetornado=m.id;}
 catch(e){r.disponivel=false;r.status=Number.isInteger(e.status)?e.status:null;
 const t=e.error?.error?.type||e.error?.type;r.tipo=['authentication_error','permission_error','not_found_error','invalid_request_error','rate_limit_error','overloaded_error','api_error'].includes(t)?t:'indefinido';
 const texto=String(e.error?.error?.message||e.message||'');r.motivo=/credit balance|billing|payment required/i.test(texto)?'saldo_ou_faturamento':/expired|expirado/i.test(texto)?'credencial_expirada':/invalid.*api.?key/i.test(texto)?'chave_invalida':/not found|does not exist/i.test(texto)?'modelo_indisponivel':/timeout|timed out/i.test(texto)?'tempo_limite':/connection|ECONN|fetch failed/i.test(texto)?'conexao':'nao_classificado';}
 console.log(JSON.stringify(r));
})().catch(()=>process.exit(1));
`;
const privado = mkdtempSync(join(tmpdir(), "barberos-ia-diagnostico-"));
try {
  cifrar(Buffer.from("validacao"), process.env.RELATORIO_CHAVE_PUBLICA);
  const p = parametros(process.env), chave = join(privado, "identity"), hosts = join(privado, "known_hosts");
  writeFileSync(chave, process.env.VPS_SSH_KEY.trimEnd() + "\n", { mode: 0o600 });
  writeFileSync(hosts, process.env.VPS_KNOWN_HOSTS.trimEnd() + "\n", { mode: 0o600 });
  const remoto = String.raw`import json,subprocess,sys
ids=subprocess.check_output(['docker','ps','-q','--filter','label=com.docker.compose.project='+sys.argv[1],'--filter','label=com.docker.compose.service=app']).decode().split()
assert len(ids)==1
r=subprocess.check_output(['docker','exec',ids[0],'node','-e',sys.argv[2]],stderr=subprocess.PIPE,timeout=25)
print(json.dumps(json.loads(r)))`;
  const args = ["-F", "none", "-T", "-p", p.porta, "-i", chave, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
    "-o", "IdentityAgent=none", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519",
    "-o", "GlobalKnownHostsFile=/dev/null", "-o", `UserKnownHostsFile=${hosts}`, "-o", "ConnectTimeout=15",
    `${p.usuario}@${p.host}`, "python3 -c " + shell(remoto) + " " + [p.projeto, programa].map(shell).join(" ")];
  const r = JSON.parse(execFileSync("ssh", args, { timeout: 45000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).toString());
  writeFileSync(process.argv[2], JSON.stringify(cifrar(Buffer.from(JSON.stringify(r)), process.env.RELATORIO_CHAVE_PUBLICA)), { mode: 0o600, flag: "wx" });
  process.stdout.write("Consulta concluída; metadados protegidos no relatório cifrado.\n");
} catch {
  process.stderr.write("Consulta não concluída; nenhuma credencial exibida.\n");
  process.exitCode = 1;
} finally { rmSync(privado, { recursive: true, force: true }); }
