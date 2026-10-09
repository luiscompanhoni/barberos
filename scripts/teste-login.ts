// Teste de integracao do login com senha contra o banco de DESENVOLVIMENTO. Cria e apaga os proprios dados.
// Rodar: npm run teste:login
import { criarContaCliente, definirSenhaTemporaria, entrarComSenha, trocarPropriaSenha } from "@/lib/auth/acesso";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";

const ok = (c: boolean, msg: string) => console.log(`${c ? "OK  " : "FALHOU"} ${msg}`);
const erroDe = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e as ErroNegocio; } };
const TELS = ["5511933334001", "5511933334002", "5511933334003"];

async function limpar() {
  const cs = await db.cliente.findMany({ where: { telefone: { in: TELS } }, select: { id: true } });
  await db.agendamento.deleteMany({ where: { clienteId: { in: cs.map((c) => c.id) } } });
  await db.cliente.deleteMany({ where: { telefone: { in: TELS } } });
  await db.usuario.deleteMany({ where: { telefone: { in: TELS } } });
}

async function main() {
  await limpar();
  try {
    // ---- cliente cria conta e entra
    const u = await criarContaCliente({ nome: "Login Teste", telefone: "(11) 93333-4001", senha: "navalha-forte-1" });
    ok(u.papel === "CLIENTE" && !!u.cliente && !!u.senhaHash, "cliente cria conta (usuário + cadastro ligados)");
    const e1 = await erroDe(() => criarContaCliente({ nome: "Outro", telefone: "11933334001", senha: "outra-senha-99" }));
    ok(e1?.codigo === "ja_tem_conta", "mesmo celular não cria conta de novo");
    ok((await entrarComSenha("11 93333-4001", "navalha-forte-1", "cliente")).id === u.id, "entra com celular (qualquer formato) e senha");
    const e2 = await erroDe(() => entrarComSenha("11933334001", "errada-123", "cliente"));
    const e3 = await erroDe(() => entrarComSenha("11900009999", "errada-123", "cliente"));
    ok(e2?.message === e3?.message && e2?.status === 401, "senha errada e celular inexistente dão a mesma mensagem");
    const e4 = await erroDe(() => entrarComSenha("11933334001", "navalha-forte-1", "equipe"));
    ok(e4?.status === 403, "cliente não entra pela área da equipe");

    // ---- bloqueio por tentativas
    for (let i = 0; i < 5; i++) await erroDe(() => entrarComSenha("11933334001", `errada-${i}xx`, "cliente"));
    const e5 = await erroDe(() => entrarComSenha("11933334001", "navalha-forte-1", "cliente"));
    ok(e5?.codigo === "bloqueado", "5 erros seguidos bloqueiam por 15 min (mesmo com a senha certa)");
    await db.usuario.update({ where: { id: u.id }, data: { bloqueadoAte: null } });

    // ---- nao toma conta de quem ja tem historico na barbearia
    const existente = await db.cliente.create({ data: { telefone: TELS[1], nome: "Cliente Antigo" } });
    const barbeiro = await db.barbeiro.findFirstOrThrow({ where: { ativo: true } });
    const servico = await db.servico.findFirstOrThrow({ where: { ativo: true } });
    const ini = Date.UTC(2032, 0, 5, 9, 0);
    await db.agendamento.create({ data: { barbeiroId: barbeiro.id, servicoId: servico.id, clienteId: existente.id, inicio: new Date(ini), fim: new Date(ini + 30 * 60_000), status: "CONCLUIDO", origem: "BOT", precoCentavos: 5000 } });
    const e6 = await erroDe(() => criarContaCliente({ nome: "Invasor", telefone: TELS[1], senha: "invasor-123x" }));
    ok(e6?.codigo === "confirmar_celular", "celular com histórico exige confirmação (código ou recepção)");
    const semHistorico = await db.cliente.create({ data: { telefone: TELS[2], nome: "Só conversou" } });
    const u3 = await criarContaCliente({ nome: "Bruno", telefone: TELS[2], senha: "corte-bom-777" });
    ok(u3.cliente?.id === semHistorico.id, "cadastro sem histórico (ex.: só falou no WhatsApp) é ligado na mesma ficha");

    // ---- troca de senha e senha temporaria
    const e7 = await erroDe(() => trocarPropriaSenha(u.id, { atual: "errada", nova: "nova-senha-123" }));
    ok(e7?.codigo === "senha_atual", "trocar exige a senha atual");
    await trocarPropriaSenha(u.id, { atual: "navalha-forte-1", nova: "nova-senha-123" });
    ok(!!(await entrarComSenha(TELS[0], "nova-senha-123", "cliente")), "nova senha vale");
    const e8 = await erroDe(() => definirSenhaTemporaria(u.id));
    ok(e8?.status === 404, "senha temporária só para a equipe");
    const dono = await db.usuario.findFirstOrThrow({ where: { papel: "DONO" } });
    const senhaOriginal = dono.senhaHash;
    const trocar = dono.trocarSenha;
    const temp = await definirSenhaTemporaria(dono.id);
    const logado = await entrarComSenha(dono.telefone, temp, "equipe");
    ok(logado.trocarSenha === true, "senha temporária entra e obriga a trocar");
    await db.usuario.update({ where: { id: dono.id }, data: { senhaHash: senhaOriginal, trocarSenha: trocar } });
  } finally {
    await limpar();
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
