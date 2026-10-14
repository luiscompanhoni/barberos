/**
 * Icones dos premios: desenhos originais em traco (dourado por padrao), 24x24.
 * Lista em lib/jogos/tipos.ts (ICONES). Icone desconhecido vira "presente".
 */
type Props = { icone: string; tamanho?: number; cor?: string; className?: string; traco?: number };

const D: Record<string, React.ReactNode> = {
  dinheiro: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="6" opacity=".55" />
      <path d="M14.4 9.3c-.5-.8-1.4-1.2-2.4-1.2-1.4 0-2.4.8-2.4 1.9 0 2.5 4.9 1.4 4.9 3.9 0 1.1-1.1 2-2.5 2-1.1 0-2-.5-2.5-1.3M12 6.8v1.3M12 15.9v1.3" />
    </>
  ),
  presente: (
    <>
      <rect x="3.5" y="9" width="17" height="11.5" rx="1.2" />
      <path d="M2.5 9h19V6.5h-19zM12 6.5v14M12 6.5C10.5 3 7 3 7 5s3 1.5 5 1.5c2 0 5 .5 5-1.5s-3.5-2-5 1.5" />
    </>
  ),
  tesoura: (
    <>
      <circle cx="6.5" cy="17.5" r="2.8" />
      <circle cx="17.5" cy="17.5" r="2.8" />
      <path d="M8.4 15.4 18 3.5M15.6 15.4 6 3.5M12 10.5l.01.01" />
    </>
  ),
  navalha: (
    <>
      <path d="M3 15.5 14 4.5c1.3-1.3 3.4-1.3 4.7 0L20 5.8 7.5 18.3z" />
      <path d="M7.5 18.3 5.6 20.2c-.6.6-1.6.6-2.2 0l-.1-.1c-.6-.6-.6-1.6 0-2.2L5.2 16M10 12.5l1.5 1.5" />
    </>
  ),
  pomada: (
    <>
      <path d="M4.5 10h15v8.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
      <path d="M3.5 7.5h17V10h-17zM5 6c1.8-1.6 12.2-1.6 14 0M8 14.5h8" />
    </>
  ),
  bebida: (
    <>
      <path d="M6 3.5h12l-1.5 16.2a1.5 1.5 0 0 1-1.5 1.3H9a1.5 1.5 0 0 1-1.5-1.3z" />
      <path d="M6.6 9.5h10.8M10 13l.01.01M13.5 15.5l.01.01M11.5 17.5l.01.01" />
    </>
  ),
  coroa: (
    <>
      <path d="M3 8l4.5 4L12 4.5 16.5 12 21 8l-2 10.5H5z" />
      <path d="M5.5 21h13" />
    </>
  ),
  barba: (
    <>
      <path d="M4 7c0 7 3.5 13.5 8 13.5S20 14 20 7" />
      <path d="M8 13.5c1.5-1.4 6.5-1.4 8 0M9 17c1.6 1 4.4 1 6 0M4 7c2 1.5 4 2 5.5 1.3M20 7c-2 1.5-4 2-5.5 1.3" />
    </>
  ),
  desconto: (
    <>
      <path d="M12 2.5l2.3 2 3-.4.8 2.9 2.6 1.6-1 2.8 1 2.8-2.6 1.6-.8 2.9-3-.4-2.3 2-2.3-2-3 .4-.8-2.9L3.3 14l1-2.8-1-2.8 2.6-1.6.8-2.9 3 .4z" />
      <path d="M9 15l6-6M9.5 9.5l.01.01M14.5 14.5l.01.01" />
    </>
  ),
  estrela: <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" />,
  pente: (
    <>
      <rect x="3" y="5" width="18" height="4" rx="1" />
      <path d="M5 9v9M7.5 9v10M10 9v9M12.5 9v10M15 9v9M17.5 9v10M20 9v6" />
    </>
  ),
  poste: (
    <>
      <rect x="8" y="5" width="8" height="14" rx="1.5" />
      <path d="M8 9l8-3M8 13l8-3M8 17l8-3M10 3h4v2h-4zM10 19h4v2h-4z" />
    </>
  ),
  bigode: <path d="M12 10.5c-1.2-2.3-4.5-3-6.3-1.3-1.6 1.5-1.5 4-3.2 4.8 2.4 1.3 6.1.9 9.5-1.6 3.4 2.5 7.1 2.9 9.5 1.6-1.7-.8-1.6-3.3-3.2-4.8-1.8-1.7-5.1-1-6.3 1.3z" />,
  nada: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14.5c1.8-1.3 5.2-1.3 7 0M9 9.5l.01.01M15 9.5l.01.01" />
    </>
  ),
};

export function IconePremio({ icone, tamanho = 24, cor = "currentColor", className, traco = 1.6 }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={tamanho} height={tamanho} fill="none" stroke={cor} strokeWidth={traco} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {D[icone] ?? D.presente}
    </svg>
  );
}

/** Monograma "BB" dourado (ate a logo oficial da Black entrar em /public/marca). */
export function Monograma({ tamanho = 48, className }: { tamanho?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={tamanho} height={tamanho} className={className} aria-label="Black Barber">
      <defs>
        <linearGradient id="bb-ouro" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFF3C4" />
          <stop offset=".45" stopColor="#D4AF37" />
          <stop offset="1" stopColor="#7A5A1E" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="#0B0B0C" stroke="url(#bb-ouro)" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="25.5" fill="none" stroke="url(#bb-ouro)" strokeWidth=".8" opacity=".6" />
      <text x="32" y="40" textAnchor="middle" fontSize="23" fontWeight="900" fontFamily="Georgia, 'Times New Roman', serif" fill="url(#bb-ouro)" letterSpacing="-1.5">BB</text>
    </svg>
  );
}
