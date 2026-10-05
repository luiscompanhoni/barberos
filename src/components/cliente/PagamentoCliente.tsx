"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Copy, LoaderCircle } from "lucide-react";

export function CopiarTexto({ rotulo, texto }: { rotulo: string; texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="space-y-2 text-left">
      <p className="rotulo">{rotulo}</p>
      <input className="campo font-mono text-xs" readOnly value={texto} onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className={`btn w-full py-2.5 ${copiado ? "border-ouro text-ouro" : ""}`}
        onClick={async () => {
          await navigator.clipboard?.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        }}
      >
        {copiado ? <><Check size={16} /> Código copiado</> : <><Copy size={16} /> Copiar código</>}
      </button>
    </div>
  );
}

/** Confere o status a cada 5 s e recarrega a pagina quando o Pix cair. */
export function EsperarPagamento({ token }: { token: string }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch(`/api/pagamentos/cobranca/${token}`).then((x) => x.json()).catch(() => null);
      if (r?.status === "PAGA") {
        clearInterval(t);
        router.refresh();
      }
    }, 5000);
    return () => clearInterval(t);
  }, [token, router]);
  return (
    <p className="flex items-center justify-center gap-3 pt-2 text-sm text-zinc-500">
      <LoaderCircle className="animate-spin text-ouro" size={18} />
      Aguardando pagamento… esta página atualiza sozinha.
    </p>
  );
}
