"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/cliente-api";

/** Faixa para quem ainda nao aceitou a versao atual dos Termos e da Politica de privacidade. */
export function AvisoTermos() {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  async function aceitar() {
    setEnviando(true); setErro("");
    try { await api("/api/cliente/privacidade", { method: "POST", body: { acao: "aceitar" } }); router.refresh(); }
    catch (e) { setErro((e as Error).message); setEnviando(false); }
  }
  return (
    <div role="status" className="cartao mb-5 space-y-3 border-ouro/40">
      <p className="text-sm text-zinc-600">
        Atualizamos a <Link href="/privacidade" className="text-ouro underline">Política de privacidade</Link> e os{" "}
        <Link href="/termos" className="text-ouro underline">Termos de uso</Link>, com o que fazemos com seus dados e os seus direitos pela LGPD.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primario" disabled={enviando} onClick={aceitar}>{enviando ? "Salvando..." : "Li e aceito"}</button>
        <Link href="/c/privacidade" className="text-sm text-zinc-500 underline">Meus dados</Link>
      </div>
      {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
    </div>
  );
}
