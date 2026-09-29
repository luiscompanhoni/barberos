import { EventEmitter } from "node:events";

/**
 * Barramento de eventos em memoria para atualizar as telas em tempo real (SSE).
 * Serve para uma unica instancia do servidor; com mais instancias, trocar por
 * Postgres LISTEN/NOTIFY ou Redis pub/sub mantendo a mesma interface.
 */
export type EventoAgenda =
  | { tipo: "agenda"; barbeiroIds: string[]; datas: string[] }
  | { tipo: "conversa"; conversaId: string };

const g = globalThis as unknown as { barramento?: EventEmitter };
const barramento = g.barramento ?? new EventEmitter();
barramento.setMaxListeners(1000);
g.barramento = barramento;

export function publicar(evento: EventoAgenda) {
  barramento.emit("evento", evento);
}

export function assinar(fn: (evento: EventoAgenda) => void): () => void {
  barramento.on("evento", fn);
  return () => barramento.off("evento", fn);
}
