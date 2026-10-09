/** Iniciais do nome (ate 2 letras) para quando o barbeiro nao tem foto. */
function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** Foto redonda do barbeiro; sem foto (versao <= 0), circulo com as iniciais na cor dele. */
export function FotoBarbeiro({ id, nome, cor, versao, tamanho = 32, className = "" }: {
  id: string;
  nome: string;
  cor: string;
  versao: number;
  tamanho?: number;
  className?: string;
}) {
  const estilo = { width: tamanho, height: tamanho, borderColor: cor };
  if (versao > 0) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- foto pequena servida pela propria API, com cache por versao
      <img src={`/api/barbeiros/${id}/foto?v=${versao}`} alt={nome} width={tamanho} height={tamanho} loading="lazy"
        className={`shrink-0 rounded-full border-2 bg-zinc-100 object-cover ${className}`} style={estilo} />
    );
  }
  return (
    <span aria-label={nome} role="img"
      className={`grid shrink-0 place-items-center rounded-full border-2 font-bold text-zinc-900 ${className}`}
      style={{ ...estilo, background: `${cor}33`, fontSize: Math.max(9, Math.round(tamanho * 0.36)) }}>
      {iniciais(nome)}
    </span>
  );
}
