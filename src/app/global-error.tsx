"use client";

import "./globals.css";

/** Erro no layout raiz (a pagina inteira caiu): substitui o layout, por isso tem html e body proprios. */
export default function ErroGeral({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <title>Algo deu errado</title>
        <main className="flex flex-1 items-center justify-center px-5 py-12">
          <section className="w-full max-w-md text-center">
            <p className="text-5xl font-black text-ouro">Ops</p>
            <h1 className="mt-3 text-xl font-bold">O sistema teve um problema</h1>
            <p className="mt-3 text-sm text-zinc-600">Tente de novo em instantes. Se continuar, avise a barbearia{error.digest ? " com o código abaixo" : ""}.</p>
            {error.digest && <p className="mt-3 font-mono text-xs text-zinc-500">Código: {error.digest}</p>}
            <div className="mt-8 space-y-3">
              <button className="btn-primario w-full py-3" onClick={() => retry()}>Tentar de novo</button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- o layout caiu: recarrega a pagina inteira */}
              <a className="btn w-full py-3" href="/">Ir para o início</a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
