/**
 * Integração real em banco e servidor locais isolados. Nunca usa a base operacional.
 * DATABASE_URL deve apontar a estudo_test em loopback; ver docs/estudio-black.md.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { db } from "../src/lib/db";
import { gerarHash } from "../src/lib/auth/senha";

const banco = new URL(process.env.DATABASE_URL || "http://invalido");
const origin = process.env.APP_URL || "";
if (!["127.0.0.1", "localhost"].includes(banco.hostname) || banco.pathname !== "/estudio_test" || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error("Teste exige servidor e banco estudio_test locais.");
const base = origin + "/api/estudio/projetos";
let checks = 0;
const check = (ok: unknown, mensagem: string) => { assert.ok(ok, mensagem); checks++; console.log("OK " + mensagem); };
async function command(bin: string, args: string[]) {
  await new Promise<void>((ok, bad) => {
    const p = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); let output = "";
    p.stderr.on("data", b => output += b);
    p.on("error", bad); p.on("close", c => c === 0 ? ok() : bad(new Error(output)));
  });
}
async function request(path: string, cookie = "", method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const raw = body instanceof Uint8Array;
  return fetch(path.startsWith("http") ? path : base + path, { method, headers: { cookie, origin, ...(body === undefined ? {} : { "Content-Type": raw ? "video/mp4" : "application/json" }), ...headers }, body: body === undefined ? undefined : raw ? Buffer.from(body) : JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
}
async function data(r: Response) { const d = await r.json(); assert.ok(r.ok, JSON.stringify(d)); return d; }
async function login(identificador: string, senha: string, area = "equipe") {
  const r = await request(origin + "/api/auth/senha", "", "POST", { identificador, senha, area });
  assert.ok(r.ok, await r.clone().text()); return r.headers.get("set-cookie")!.split(";")[0];
}
async function main() {
  const senha = process.env.ESTUDIO_TEST_PASSWORD || randomBytes(24).toString("base64url");
  for (const [i, papel] of ["BARBEIRO", "BARBEIRO", "CLIENTE"].entries()) {
    const id = "teste_estudio_" + i;
    await db.usuario.upsert({ where: { id }, create: { id, telefone: "55000000900" + i, login: "estudio-local-" + i, nome: "Teste Estúdio " + i, papel: papel as "BARBEIRO" | "CLIENTE", senhaHash: await gerarHash(senha) }, update: { senhaHash: await gerarHash(senha), ativo: true } });
  }
  await db.configuracao.upsert({ where: { id: 1 }, create: { id: 1, nomeBarbearia: "Black Barber · Desenvolvimento", botAtivo: false }, update: {} });
  await db.estudioProjeto.deleteMany({ where: { usuarioId: { in: ["teste_estudio_0", "teste_estudio_1", "teste_estudio_2"] } } });
  await db.estudioWorker.deleteMany();
  const a = await login("estudio-local-0", senha); const b = await login("estudio-local-1", senha);
  const cliente = await login("550000009002", senha, "cliente");
  check((await request("")).status === 401, "sem sessão não entra");
  check((await request("", cliente)).status === 403, "cliente não acessa Estúdio");
  check((await request("", a, "POST", { nome: "Origem maliciosa" }, { origin: "https://evil.example" })).status === 403, "CSRF bloqueado");
  const p = await data(await request("", a, "POST", { nome: "Demonstração · Estúdio Black" }));
  const get = async () => data(await request("/" + p.id, a));
  check((await request("/" + p.id, b)).status === 404, "outro barbeiro não lê projeto");
  check((await data(await request("", b))).projetos.length === 0, "lista isolada por usuário");
  check((await request("/" + p.id + "/versoes", a, "POST", { revisao: 0 })).status === 503, "fila recusa render com processador offline");
  await mkdir(".test-estudio/fixtures", { recursive: true });
  const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH!;
  for (const [i, cor] of ["0xa52b35", "0x1c657a"].entries()) {
    await command(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=" + cor + ":s=360x640:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=" + (440 + 440 * i) + ":duration=3", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", ".test-estudio/fixtures/video-" + i + ".mp4"]);
  }
  // Reserva concorrente usa a mesma revisão: só uma ganha.
  let atual = await get(); const buf0 = await readFile(".test-estudio/fixtures/video-0.mp4");
  const reserve = { nome: "Cena 1.mp4", bytes: buf0.length, mime: "video/mp4", duracao: 3, revisao: atual.revisao };
  const reservas = await Promise.all([request("/" + p.id + "/clipes", a, "POST", reserve), request("/" + p.id + "/clipes", a, "POST", reserve)]);
  check(reservas.map(r => r.status).sort().join() === "201,409", "reserva concorrente protege revisão e quota");
  const c0 = await data(reservas.find(r => r.status === 201)!);
  const clipUrl = "/" + p.id + "/clipes/" + c0.id;
  check((await request(clipUrl, b, "PUT", buf0)).status === 404, "outro barbeiro não envia no projeto");
  check((await request(clipUrl, a, "PUT", Buffer.alloc(buf0.length, 65))).status === 400, "arquivo falso rejeitado");
  check((await request(clipUrl, a, "PUT", buf0)).ok, "upload real aceito após falha");
  check((await request(clipUrl, a, "PUT", buf0)).status === 409, "original não pode ser sobrescrito");
  check((await request(clipUrl, b)).status === 404, "URL de vídeo exige proprietário");
  const range = await request(clipUrl, a, "GET", undefined, { range: "bytes=0-15" });
  check(range.status === 206 && (await range.arrayBuffer()).byteLength === 16 && range.headers.get("cache-control")?.includes("no-store"), "vídeo privado suporta Range sem cache");
  const buf1 = await readFile(".test-estudio/fixtures/video-1.mp4"); atual = await get();
  const c1 = await data(await request("/" + p.id + "/clipes", a, "POST", { ...reserve, nome: "Cena 2.mp4", bytes: buf1.length, revisao: atual.revisao }));
  await data(await request("/" + p.id + "/clipes/" + c1.id, a, "PUT", buf1));
  atual = await get();
  const edit = { nome: atual.nome, revisao: atual.revisao, clipes: [{ id: c0.id, inicio: 0.5, fim: 2, texto: "Seu estilo. Sua assinatura." }, { id: c1.id, inicio: 0, fim: 1.5, texto: "Estúdio Black" }] };
  const edits = await Promise.all([request("/" + p.id, a, "PATCH", edit), request("/" + p.id, a, "PATCH", edit)]);
  check(edits.map(r => r.status).sort().join() === "200,409", "edições concorrentes não se atropelam");
  await db.estudioWorker.create({ data: { id: "principal", vistoEm: new Date(), versao: "teste" } });
  atual = await get();
  const queues = await Promise.all([request("/" + p.id + "/versoes", a, "POST", { revisao: atual.revisao }), request("/" + p.id + "/versoes", a, "POST", { revisao: atual.revisao })]);
  check(queues.map(r => r.status).sort().join() === "202,409", "duplo clique não duplica trabalho");
  const workerUrl = origin + "/api/estudio/worker";
  const wh = { authorization: "Bearer " + process.env.ESTUDIO_WORKER_TOKEN };
  const claim = async () => data(await request(workerUrl, "", "POST", { acao: "claim", versao: "teste" }, wh));
  check((await request(workerUrl, a, "POST", { acao: "claim", versao: "teste" })).status === 401, "sessão de equipe não autentica worker");
  const job1 = (await claim()).trabalho;
  check((await request(workerUrl + "/" + job1.id + "/" + c0.id, "", "GET", undefined, wh)).status === 409, "download de worker exige lease válido");
  check((await request(workerUrl + "/" + job1.id + "/clipe-alheio", "", "GET", undefined, { ...wh, "x-estudio-lease": job1.lease })).status === 404, "worker acessa apenas clipes do trabalho");
  check((await request("/" + p.id, a, "PATCH", { ...edit, revisao: atual.revisao })).status === 409, "montagem em andamento congela edição");
  await data(await request("/" + p.id + "/versoes/" + job1.id, a, "POST", { acao: "cancelar", revisao: atual.revisao }));
  check((await request(workerUrl + "/" + job1.id, "", "PUT", buf0, { ...wh, "x-estudio-lease": job1.lease })).status === 409, "resultado cancelado não ressuscita versão");
  await data(await request("/" + p.id + "/versoes", a, "POST", { revisao: atual.revisao }));
  const job2 = (await claim()).trabalho;
  await db.estudioVersao.update({ where: { id: job2.id }, data: { leaseAte: new Date(Date.now() - 1) } });
  await claim();
  check((await db.estudioVersao.findUnique({ where: { id: job2.id } }))?.estado === "FALHOU", "lease expirado vira falha recuperável");
  const render = await data(await request("/" + p.id + "/versoes", a, "POST", { revisao: atual.revisao }));
  const workerEnv = { ...process.env }; delete workerEnv.DATABASE_URL; delete workerEnv.SESSION_SECRET;
  const worker = spawn(process.execPath, ["workers/video/index.mjs"], { env: workerEnv, windowsHide: true, stdio: "inherit" });
  try {
    const prazo = Date.now() + 20 * 60_000; let ultimo = "";
    for (;;) {
      await new Promise(r => setTimeout(r, 2000)); atual = await get();
      const v = atual.versoes.find((v: { id: string }) => v.id === render.id);
      if (v.estado !== ultimo) { console.log("Render real: " + v.estado); ultimo = v.estado; }
      if (v.estado === "REVISAO") break;
      assert.notEqual(v.estado, "FALHOU", v.erro);
      assert.ok(Date.now() < prazo, "Tempo limite da renderização");
    }
    const output = await request("/" + p.id + "/versoes/" + render.id + "?download=1", a);
    check(output.ok && output.headers.get("content-disposition")?.includes("attachment"), "download da exportação real disponível");
    const video = Buffer.from(await output.arrayBuffer());
    await writeFile(".test-estudio/resultado.mp4", video);
    check(video.subarray(4, 8).toString() === "ftyp" && video.length > 1000, "exportação contém MP4 real");
    check((await request("/" + p.id + "/versoes/" + render.id, b)).status === 404, "exportação permanece privada");
    const approvals = await Promise.all([request("/" + p.id + "/versoes/" + render.id, a, "POST", { acao: "aprovar", revisao: atual.revisao }), request("/" + p.id + "/versoes/" + render.id, a, "POST", { acao: "aprovar", revisao: atual.revisao })]);
    check(approvals.map(r => r.status).sort().join() === "200,409", "aprovação atômica da versão renderizada");
    const record = await db.estudioVersao.findUniqueOrThrow({ where: { id: render.id } });
    check(record.estado === "APROVADO" && !!record.aprovadaEm && !!record.sha256, "aprovação guarda data e hash do arquivo");
    await mkdir("docs/estudio-evidencias", { recursive: true });
    for (const [i, t] of [0.7, 2.2].entries()) await command(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(t), "-i", ".test-estudio/resultado.mp4", "-frames:v", "1", "docs/estudio-evidencias/quadro-" + (i + 1) + ".png"]);
    await writeFile(".test-estudio/acesso-demo.json", JSON.stringify({ login: "estudio-local-0", projetoId: p.id }));
    console.log("Integração concluída: " + checks + " verificações; projeto de demonstração preservado no banco local.");
  } finally {
    worker.kill();
  }
}
main().finally(() => db.$disconnect());
