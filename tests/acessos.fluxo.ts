/** Fluxo real isolado: DATABASE_URL deve apontar para barberos_test_acessos. */
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { ativarBarbeiro, salvarAcesso } from "@/lib/auth/equipe";
import { permissoesDoUsuario } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/sessao";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.pathname, "/barberos_test_acessos", "Use o banco isolado de testes de acessos.");
  assert(["localhost", "127.0.0.1"].includes(url.hostname), "Use somente banco local.");
  const ids: string[] = [];
  let servicoId: string | undefined;
  try {
    const dono = await db.usuario.create({ data: { nome: "Teste Dono Acessos", telefone: "5511988800001", papel: "DONO" } }); ids.push(dono.id);
    const s: Sessao = { usuarioId: dono.id, papel: "DONO", nome: dono.nome, barbeiroId: null, clienteId: null };
    const servico = await db.servico.create({ data: { nome: "Teste Corte Acessos", precoCentavos: 6500, duracaoMin: 30 } }); servicoId = servico.id;
    const criado = await salvarAcesso(s, null, { nome: "Teste Barbeiro", telefone: "11988800002", papel: "BARBEIRO", servicoIds: [servico.id] }); ids.push(criado.id);
    const original = await db.usuario.findUniqueOrThrow({ where: { id: criado.id }, include: { barbeiro: true, checklistPessoa: true } });
    assert(original.barbeiro?.ativo && original.checklistPessoa);
    await db.checklistPonto.create({ data: { pessoaId: original.checklistPessoa.id, pontos: 77, descricao: "Pontos preservados" } });
    await db.barbeiroServico.update({ where: { barbeiroId_servicoId: { barbeiroId: original.barbeiro.id, servicoId: servico.id } }, data: { duracaoMin: 20, precoCentavos: 7000 } });
    await salvarAcesso(s, criado.id, { nome: "Teste Líder", telefone: "(11) 98880-0003", papel: "LIDER", login: "lider.teste", atende: true, servicoIds: [servico.id], permissoes: { bloquear_agenda: false } });
    const promovido = await db.usuario.findUniqueOrThrow({ where: { id: criado.id }, include: { barbeiro: { include: { servicos: true } }, checklistPessoa: { include: { pontos: true } } } });
    assert.equal(promovido.papel, "LIDER"); assert.equal(promovido.telefone, "5511988800003");
    assert.equal(promovido.barbeiro?.id, original.barbeiro.id); assert.equal(promovido.checklistPessoa?.id, original.checklistPessoa.id);
    assert.equal(promovido.checklistPessoa?.telefone, promovido.telefone); assert.equal(promovido.barbeiro?.nome, promovido.nome);
    assert.equal(promovido.checklistPessoa?.pontos[0]?.pontos, 77);
    assert.equal(promovido.barbeiro?.servicos[0]?.precoCentavos, 7000); assert.equal(promovido.barbeiro?.servicos[0]?.duracaoMin, 20);
    const lider: Sessao = { ...s, usuarioId: promovido.id, papel: "LIDER", barbeiroId: original.barbeiro.id };
    const revogado = await permissoesDoUsuario(lider);
    assert.equal(revogado.bloquear_agenda, false); assert.equal(revogado.reunioes, true); assert.equal(revogado.folha, false);
    await salvarAcesso(s, criado.id, { permissoes: { bloquear_agenda: null, comissoes_equipe: true } });
    const atual = await permissoesDoUsuario(lider);
    assert.equal(atual.bloquear_agenda, true); assert.equal(atual.comissoes_equipe, true);
    await assert.rejects(() => salvarAcesso(s, criado.id, { nome: "Não salvar", telefone: dono.telefone }), /já usado/);
    assert.equal((await db.usuario.findUniqueOrThrow({ where: { id: criado.id } })).nome, "Teste Líder");
    await assert.rejects(() => salvarAcesso(s, dono.id, { ativo: false }), /pelo menos um dono/);
    await assert.rejects(() => salvarAcesso(lider, dono.id, { papel: "LIDER" }), /permissão/);
    // Lista de barbeiros: desativar corta o login, então segue as mesmas regras de Acessos.
    const barbeiroId = original.barbeiro.id;
    await assert.rejects(() => ativarBarbeiro({ ...s, usuarioId: criado.id, papel: "GERENTE" }, barbeiroId, false), /permissão/);
    const cliente = await db.cliente.create({ data: { nome: "Teste Cliente Acessos", telefone: "5511988800009" } });
    const inicio = new Date(Date.now() + 86_400_000);
    const futuro = await db.agendamento.create({ data: { barbeiroId, clienteId: cliente.id, servicoId: servico.id, inicio, fim: new Date(inicio.getTime() + 30 * 60_000), origem: "RECEPCAO", precoCentavos: 6500 } });
    await assert.rejects(() => ativarBarbeiro(s, barbeiroId, false), /atendimentos futuros/);
    assert.equal((await db.usuario.findUniqueOrThrow({ where: { id: criado.id } })).ativo, true);
    await db.agendamento.delete({ where: { id: futuro.id } });
    await db.cliente.delete({ where: { id: cliente.id } });
    await ativarBarbeiro(s, barbeiroId, false);
    const desligado = await db.usuario.findUniqueOrThrow({ where: { id: criado.id }, include: { barbeiro: true } });
    assert.equal(desligado.ativo, false); assert.equal(desligado.barbeiro?.ativo, false);
    await ativarBarbeiro(s, barbeiroId, true);
    assert.equal((await db.usuario.findUniqueOrThrow({ where: { id: criado.id } })).ativo, true);
    // Desativar em Acessos tira o acesso todo (login, agenda e checklist); reativar devolve.
    await salvarAcesso(s, criado.id, { ativo: false });
    const semAcesso = await db.usuario.findUniqueOrThrow({ where: { id: criado.id }, include: { barbeiro: true, checklistPessoa: true } });
    assert.equal(semAcesso.ativo, false); assert.equal(semAcesso.barbeiro?.ativo, false); assert.equal(semAcesso.checklistPessoa?.ativo, false);
    await salvarAcesso(s, criado.id, { ativo: true, atende: true });
    const religado = await db.usuario.findUniqueOrThrow({ where: { id: criado.id }, include: { barbeiro: true, checklistPessoa: true } });
    assert.equal(religado.ativo, true); assert.equal(religado.barbeiro?.ativo, true); assert.equal(religado.checklistPessoa?.ativo, true);
    // Desativar um barbeiro sem ficha (cadastro antigo) não cria ficha nova de checklist.
    const semFicha = await db.barbeiro.create({ data: { nome: "Teste Sem Ficha", usuario: { create: { nome: "Teste Sem Ficha", telefone: "5511988800010", papel: "BARBEIRO" } } } }); ids.push(semFicha.usuarioId);
    await ativarBarbeiro(s, semFicha.id, false);
    assert.equal(await db.checklistPessoa.count({ where: { usuarioId: semFicha.usuarioId } }), 0);
    // Reativar quem é barbeiro (botão "reativar" de Acessos) devolve a agenda.
    await salvarAcesso(s, semFicha.usuarioId, { ativo: true });
    assert.equal((await db.barbeiro.findUniqueOrThrow({ where: { id: semFicha.id } })).ativo, true);
    await salvarAcesso(s, dono.id, { atende: true });
    const barbeiroDono = await db.barbeiro.findUniqueOrThrow({ where: { usuarioId: dono.id } });
    await assert.rejects(() => ativarBarbeiro(s, barbeiroDono.id, false), /pelo menos um dono/);
    await salvarAcesso(s, criado.id, { papel: "DONO" });
    assert.equal(await db.permissaoUsuario.count({ where: { usuarioId: criado.id } }), 0);
    const s2: Sessao = { ...lider, papel: "DONO" };
    const tentativas = await Promise.allSettled([
      salvarAcesso(s, criado.id, { ativo: false }), salvarAcesso(s2, dono.id, { ativo: false }),
    ]);
    assert.equal(tentativas.filter((t) => t.status === "fulfilled").length, 1);
    assert.equal(await db.usuario.count({ where: { papel: "DONO", ativo: true } }), 1);
    console.log("PASS acessos: promoção preserva identidade, RH, pontos e serviços; exceções e concorrência protegem a administração.");
  } finally {
    await db.checklistPessoa.deleteMany({ where: { usuarioId: { in: ids } } });
    await db.barbeiro.deleteMany({ where: { usuarioId: { in: ids } } });
    await db.usuario.deleteMany({ where: { id: { in: ids } } });
    if (servicoId) await db.servico.delete({ where: { id: servicoId } });
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
