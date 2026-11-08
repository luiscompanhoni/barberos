const nome = (comanda: string, servico: string, barbeiro: string) => `black:adicional:${comanda}:${servico}:${barbeiro}`;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type StorageAdicional = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A mesma tentativa sobrevive a timeout e reload. Uma inclusão confirmada libera uma nova intenção. */
export function solicitacaoAdicional(memoria: Map<string, string>, comanda: string, servico: string, barbeiro: string, storage?: StorageAdicional) {
  const chave = nome(comanda, servico, barbeiro);
  let id = memoria.get(chave);
  if (!id) { try { id = storage?.getItem(chave) ?? undefined; } catch { /* Navegador sem armazenamento: a memória ainda protege a repetição. */ } }
  if (!id || !uuid.test(id)) id = crypto.randomUUID();
  memoria.set(chave, id);
  try { storage?.setItem(chave, id); } catch { /* Não impede a inclusão em modo privado. */ }
  return id;
}

export function encerrarSolicitacaoAdicional(memoria: Map<string, string>, comanda: string, servico: string, barbeiro: string, storage?: StorageAdicional) {
  const chave = nome(comanda, servico, barbeiro);
  memoria.delete(chave);
  try { storage?.removeItem(chave); } catch { /* Sem armazenamento persistente. */ }
}

export function armazenamentoAdicional() {
  try { return window.sessionStorage; } catch { return undefined; }
}
