import { cookies } from "next/headers";
import type { Papel } from "@prisma/client";
import { COOKIE_INDICACAO, registrarIndicacao } from "@/lib/crescimento/indicacao";
import { criarSessao } from "./sessao";

type UsuarioLogin = {
  id: string; papel: Papel; nome: string; senhaHash: string | null; trocarSenha: boolean;
  barbeiro: { id: string; ativo: boolean } | null; cliente: { id: string } | null;
};

/** Abre a sessao e diz o que a tela precisa fazer em seguida (criar senha, trocar a temporaria, informar o nome). */
export async function abrirSessao(u: UsuarioLogin) {
  await criarSessao({
    usuarioId: u.id,
    papel: u.papel,
    nome: u.nome,
    barbeiroId: u.barbeiro?.ativo ? u.barbeiro.id : null,
    clienteId: u.cliente?.id ?? null,
  });
  // Veio por um link de indicacao: liga ao amigo (so vale para cliente novo).
  const jar = await cookies();
  const codigo = jar.get(COOKIE_INDICACAO)?.value;
  if (codigo && u.papel === "CLIENTE" && u.cliente) {
    await registrarIndicacao(u.cliente.id, codigo, "SITE").catch(() => {});
    jar.delete(COOKIE_INDICACAO);
  }
  return {
    ok: true,
    papel: u.papel,
    precisaNome: u.papel === "CLIENTE" && !u.nome.trim(),
    // Entrou por codigo e ainda nao tem senha, ou recebeu senha temporaria do dono.
    definirSenha: !u.senhaHash || u.trocarSenha,
  };
}
