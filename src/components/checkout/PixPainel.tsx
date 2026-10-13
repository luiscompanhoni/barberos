"use client";

import { useEffect, useState } from "react";
import { Check, Clock, Copy, ExternalLink, LoaderCircle, QrCode, RefreshCw } from "lucide-react";
import { formatarContagem, segundosRestantes } from "@/lib/pagamentos/checkout-regras";

/** QR, copia e cola com botao de copiar e a contagem da validade do Pix. */
export function PixPainel(p: {
  copiaECola: string;
  qrUrl: string | null;
  expiraEm: string | null;
  linkTeste: string | null;
  ocupado: boolean;
  onNovoPix: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!p.expiraEm) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [p.expiraEm]);
  const resta = segundosRestantes(p.expiraEm, agora);

  if (resta === 0) {
    return (
      <div className="space-y-3 text-center">
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Esse Pix expirou. Gere um novo para pagar.</p>
        <button type="button" className="btn-primario w-full py-3" disabled={p.ocupado} onClick={p.onNovoPix}>
          {p.ocupado ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />} Gerar novo Pix
        </button>
      </div>
    );
  }

  async function copiar() {
    await navigator.clipboard?.writeText(p.copiaECola).catch(() => {});
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="mx-auto w-fit rounded-2xl bg-[#f5f5f5] p-4">
        {p.qrUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagem do QR vem do meio de pagamento
          <img src={p.qrUrl} alt="QR code do Pix" className="h-52 w-52" />
        ) : (
          <div className="grid h-52 w-52 place-items-center text-center text-xs text-[#555]">
            <span><QrCode size={56} className="mx-auto mb-2 text-[#222]" />Use o código copia e cola</span>
          </div>
        )}
      </div>
      {resta !== null && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-zinc-500">
          <Clock size={13} /> Vale por mais <b className="font-mono text-zinc-800">{formatarContagem(resta)}</b>
        </p>
      )}
      <div className="space-y-2 text-left">
        <p className="rotulo">Pix copia e cola</p>
        <input className="campo font-mono text-xs" readOnly value={p.copiaECola} onFocus={(e) => e.target.select()} aria-label="Código Pix copia e cola" />
        <button type="button" className={`btn w-full py-3 ${copiado ? "border-ouro text-ouro" : ""}`} onClick={copiar}>
          {copiado ? <><Check size={16} /> Código copiado</> : <><Copy size={16} /> Copiar código Pix</>}
        </button>
      </div>
      <ol className="space-y-1 text-left text-xs text-zinc-500">
        <li>1. Abra o app do seu banco e escolha <b>Pix copia e cola</b> (ou leia o QR).</li>
        <li>2. Cole o código e confirme o pagamento.</li>
        <li>3. Pronto: esta página confirma sozinha em alguns segundos.</li>
      </ol>
      {p.linkTeste && (
        <a className="btn w-full text-xs" href={p.linkTeste} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} /> Simular o pagamento (modo de teste)
        </a>
      )}
      <p className="flex items-center justify-center gap-2 text-sm text-zinc-500">
        <LoaderCircle className="animate-spin text-ouro" size={16} /> Aguardando o pagamento…
      </p>
    </div>
  );
}
