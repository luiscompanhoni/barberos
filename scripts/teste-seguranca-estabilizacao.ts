import { randomBytes } from "node:crypto";

function destinoLocal() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.port !== "55439" || url.pathname !== "/barberos_ci_local_seguranca_estabilizacao") {
    throw new Error("Teste restrito ao PostgreSQL local descartável barberos_ci_local_seguranca_estabilizacao em 55439.");
  }
}

async function main() {
  destinoLocal();
  process.env.AMBIENTE = "homologacao"; process.env.WHATSAPP_PROVIDER = "simulador"; process.env.OTP_PROVIDER = "console";
  process.env.WHATSAPP_ENVIOS_BLOQUEADOS = "true"; process.env.WHATSAPP_ATENDIMENTO_IA_PAGA = "false";
  globalThis.fetch = async () => { throw new Error("Rede externa bloqueada no teste de segurança."); };
  const { db } = await import("@/lib/db");
  const { entrarComSenha, trocarPropriaSenha, redefinirSenhaTemporaria } = await import("@/lib/auth/acesso");
  const { gerarHash, conferirSenha } = await import("@/lib/auth/senha");
  let verificacoes = 0;
  const ok = (condicao: unknown, descricao: string) => { if (!condicao) throw new Error(descricao); verificacoes++; console.log(`OK ${descricao}`); };
  const codigo = randomBytes(6).toString("hex"), login = `seguranca.${codigo}`;
  try {
    const u = await db.usuario.create({ data: { nome: "Profissional sintético de teste", telefone: `sintetico-auth-${codigo}`, login, papel: "DONO", senhaHash: await gerarHash("Fixture-senha-atual-927") } });
    const tentativas = await Promise.allSettled(Array.from({ length: 5 }, () => entrarComSenha(login, "Fixture-senha-errada", "equipe")));
    ok(tentativas.every(t => t.status === "rejected"), "cinco falhas concorrentes não autenticam");
    const bloqueado = await db.usuario.findUniqueOrThrow({ where: { id: u.id } });
    ok(bloqueado.bloqueadoAte && bloqueado.bloqueadoAte > new Date() && bloqueado.senhaFalhas === 0, "bloqueio persistido sob concorrência real no PostgreSQL");
    const recusado = await entrarComSenha(login, "Fixture-senha-atual-927", "equipe").then(() => null, (e: unknown) => e);
    ok(recusado && typeof recusado === "object" && "status" in recusado && recusado.status === 429, "senha correta respeita bloqueio vigente");
    await db.usuario.update({ where: { id: u.id }, data: { bloqueadoAte: new Date(Date.now() - 60_000) } });
    ok((await entrarComSenha(login, "Fixture-senha-atual-927", "equipe")).id === u.id, "login legítimo volta após o prazo");
    const novo = await trocarPropriaSenha(u.id, { atual: "Fixture-senha-atual-927", nova: "Fixture-senha-nova-928" }, 0);
    ok(novo.sessaoVersao === 1 && await conferirSenha("Fixture-senha-nova-928", novo.senhaHash), "troca incrementa versão e grava senha nova");
    const auditoriaTroca = await db.auditoria.count({ where: { entidadeId: u.id, acao: "trocar_senha" } });
    ok(auditoriaTroca === 1, "troca é auditada na transação");
    const reset = await redefinirSenhaTemporaria(u.id, { usuarioId: u.id, sessaoVersao: 1 });
    ok(reset.usuario.sessaoVersao === 2 && reset.usuario.trocarSenha && await conferirSenha(reset.senha, reset.usuario.senhaHash), "reset temporário revoga sessões anteriores");
    const antes = await db.auditoria.count({ where: { entidadeId: u.id, acao: "senha_temporaria" } });
    await redefinirSenhaTemporaria(u.id, { usuarioId: u.id, sessaoVersao: 1 }).then(() => { throw new Error("Reset aceitou versão revogada"); }, () => {});
    ok((await db.usuario.findUniqueOrThrow({ where: { id: u.id } })).sessaoVersao === 2
      && (await db.auditoria.count({ where: { entidadeId: u.id, acao: "senha_temporaria" } })) === antes, "reset com sessão antiga não grava nem audita sucesso");
    console.log(JSON.stringify({ verificacoes, resultado: "PASSOU", ambiente: "local_descartavel", redeExterna: "bloqueada" }));
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Falha no teste local de segurança; consulte o último cenário OK, sem exportar credenciais ou dados pessoais."); process.exitCode = 1; });
