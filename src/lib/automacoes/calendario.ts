/**
 * Agenda do barbeiro em formato iCalendar (.ics, RFC 5545) para assinar no Google Agenda,
 * Apple Calendario ou Outlook. So leitura: a agenda de verdade continua no BarberOS.
 */
export type EventoIcs = {
  uid: string;
  inicio: Date;
  fim: Date;
  titulo: string;
  descricao?: string;
  confirmado?: boolean;
};

/** Escapa texto do iCalendar (\\ ; , e quebra de linha). */
export function escaparIcs(t: string) {
  return t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Linhas com mais de 75 bytes sao dobradas (continuacao comeca com espaco). */
export function dobrarLinha(linha: string) {
  const partes: string[] = [];
  let atual = "";
  let bytes = 0;
  for (const ch of linha) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (partes.length ? 74 : 75)) {
      partes.push(atual);
      atual = "";
      bytes = 0;
    }
    atual += ch;
    bytes += b;
  }
  partes.push(atual);
  return partes.join("\r\n ");
}

const dataIcs = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function gerarIcs(nomeCalendario: string, eventos: EventoIcs[], agora = new Date()) {
  const linhas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BarberOS//Agenda//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escaparIcs(nomeCalendario)}`,
    "X-WR-TIMEZONE:America/Sao_Paulo",
    // Pede para o app buscar de novo a cada 15 min (o Google decide o proprio ritmo).
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];
  for (const e of eventos) {
    linhas.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${dataIcs(agora)}`,
      `DTSTART:${dataIcs(e.inicio)}`,
      `DTEND:${dataIcs(e.fim)}`,
      `SUMMARY:${escaparIcs(e.titulo)}`,
      ...(e.descricao ? [`DESCRIPTION:${escaparIcs(e.descricao)}`] : []),
      `STATUS:${e.confirmado === false ? "TENTATIVE" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }
  linhas.push("END:VCALENDAR");
  return linhas.map(dobrarLinha).join("\r\n") + "\r\n";
}
