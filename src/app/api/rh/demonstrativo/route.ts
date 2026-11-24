import { permissoesDoUsuario } from "@/lib/auth/permissoes";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { proibido, rota } from "@/lib/erros";
import { lerDemonstrativo, podeVerDemonstrativo } from "@/lib/rh/demonstrativo";

export const dynamic = "force-dynamic";

export const GET = rota(async () => {
  const sessao = await exigirSessao(GESTAO);
  if (!podeVerDemonstrativo(sessao.papel, await permissoesDoUsuario(sessao))) throw proibido();
  const arquivo = await lerDemonstrativo();
  return new Response(arquivo, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="demonstrativo-cashbarber-celcoin.xlsx"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
