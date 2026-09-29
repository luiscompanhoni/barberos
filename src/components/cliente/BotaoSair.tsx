"use client";

import { useRouter } from "next/navigation";

export function BotaoSair() {
  const router = useRouter();
  return (
    <button
      className="rounded-lg px-3 py-1.5 text-zinc-600 hover:bg-zinc-100"
      onClick={async () => {
        await fetch("/api/auth/sair", { method: "POST" });
        router.replace("/c/entrar");
        router.refresh();
      }}
    >
      Sair
    </button>
  );
}
