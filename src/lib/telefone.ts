/**
 * Normaliza telefone brasileiro para o formato usado pelo WhatsApp: so digitos,
 * com DDI 55. Ex.: "(11) 99999-8888" -> "5511999998888".
 */
export function normalizarTelefone(entrada: string): string | null {
  let d = entrada.replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55\d{10,11}$/.test(d)) return null;
  return d;
}

/** "5511999998888" -> "(11) 99999-8888" */
export function formatarTelefone(tel: string): string {
  const d = tel.replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel;
}
