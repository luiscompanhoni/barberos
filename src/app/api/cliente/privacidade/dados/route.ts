import { exigirCliente } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { limitar } from "@/lib/limite";
import { exportarDados } from "@/lib/lgpd/titular";

/** Copia dos dados do cliente em arquivo JSON (direito de acesso e portabilidade). */
export const GET = rota(async () => {
  const s = await exigirCliente();
  limitar(`lgpd-dados:${s.clienteId}`, 5, 3_600_000);
  const dados = await exportarDados(s.clienteId);
  return new Response(JSON.stringify(dados, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="meus-dados-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
});
