"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Erro inesperado numa pagina do site ou do painel. O codigo (digest) liga a tela ao log do servidor
 * (linha "[erro] codigo=..." no `docker compose logs app`), sem mostrar detalhes internos para quem esta usando.
 */
export default function Erro({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-12">
      <section className="entrar-suave w-full max-w-md text-center">
        <p className="text-5xl font-black text-ouro">Ops</p>
        <h1 className="mt-3 text-xl font-bold">Algo deu errado nesta página</h1>
        <p className="mt-3 text-sm text-zinc-600">
          Não foi culpa sua. Tente de novo; se continuar, avise a barbearia{error.digest ? " com o código abaixo" : ""}.
        </p>
        {error.digest && <p className="mt-3 font-mono text-xs text-zinc-500">Código: {error.digest}</p>}
        <div className="mt-8 space-y-3">
          <button className="btn-primario w-full py-3" onClick={() => retry()}>Tentar de novo</button>
          <Link className="btn w-full py-3" href="/">Ir para o início</Link>
        </div>
      </section>
    </main>
  );
}
