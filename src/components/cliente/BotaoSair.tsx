"use client";

import { useRouter } from "next/navigation";
import { desativarPushLocal } from "@/lib/pwa/push-cliente";

export function BotaoSair() {
  const router = useRouter();
  return (
    <button
      className="rounded-lg px-3 py-1.5 text-zinc-600 hover:bg-zinc-100"
      onClick={async () => {
        const resposta = await fetch("/api/auth/sair", { method: "POST" });
        if (!resposta.ok) return;
        await desativarPushLocal({ servidor: false }).catch(() => {});
        router.replace("/c/entrar");
        router.refresh();
      }}
    >
      Sair
    </button>
  );
}
