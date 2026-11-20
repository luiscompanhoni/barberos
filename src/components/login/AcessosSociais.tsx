"use client";

type Provedor = { id: "google" | "facebook" | "apple"; disponivel: boolean };
const nomes = { google: "Google", facebook: "Facebook", apple: "Apple" };
/** Só mostra os acessos ligados: botão desabilitado na tela de entrar parece sistema inacabado. */
export function AcessosSociais({ provedores, voltar }: { provedores: Provedor[]; voltar?: string }) {
  const ligados = provedores.filter((p) => p.disponivel);
  if (!ligados.length) return null;
  return <div className="mt-6 space-y-3">
    <p className="text-center text-xs text-zinc-500">Ou continue com sua conta</p>
    <div className="grid gap-2 sm:grid-cols-3">
      {ligados.map((p) => <form key={p.id} action={`/api/auth/social/${p.id}${voltar ? "?voltar=" + encodeURIComponent(voltar) : ""}`} method="POST">
        <button type="submit" className="btn w-full" aria-label={`Continuar com ${nomes[p.id]}`}>
          {nomes[p.id]}
        </button>
      </form>)}
    </div>
  </div>;
}
