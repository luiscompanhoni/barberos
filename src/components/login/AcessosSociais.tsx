"use client";

type Provedor = { id: "google" | "facebook" | "apple"; disponivel: boolean };
const nomes = { google: "Google", facebook: "Facebook", apple: "Apple" };
export function AcessosSociais({ provedores }: { provedores: Provedor[] }) {
  return <div className="mt-6 space-y-3">
    <p className="text-center text-xs text-zinc-500">Ou continue com sua conta</p>
    <div className="grid gap-2 sm:grid-cols-3">
      {provedores.map((p) => <form key={p.id} action={`/api/auth/social/${p.id}`} method="POST">
        <button type="submit" className="btn w-full" disabled={!p.disponivel} aria-label={`Continuar com ${nomes[p.id]}${p.disponivel ? "" : " — indisponível"}`}>
          {nomes[p.id]}
        </button>
      </form>)}
    </div>
    {provedores.some((p) => !p.disponivel) && <p className="text-center text-xs text-zinc-500">Os acessos desabilitados estarão disponíveis em breve.</p>}
  </div>;
}
