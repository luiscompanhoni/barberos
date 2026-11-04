/** Controle externo ao banco para iniciar uma cópia restaurada sem tarefas automáticas. */
export function quarentenaRestauracao() {
  const valor = process.env.BARBEROS_QUARENTENA_RESTAURACAO?.trim().toLowerCase();
  // Valor não reconhecido mantém a proteção em vez de liberá-la por erro de digitação.
  return !!valor && valor !== "false";
}
