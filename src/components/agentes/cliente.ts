import { ErroApi } from "@/lib/cliente-api";

export async function apiAgentes<T>(caminho = "", method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(`/api/agentes${caminho}`, {
    method, cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const resposta = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) window.location.replace("/entrar?voltar=%2Fagentes");
    throw new ErroApi(resposta.erro ?? "Não foi possível concluir. Atualize os dados e tente novamente.", r.status, resposta.codigo);
  }
  return resposta as T;
}

export const dataAgente = (valor: string) => new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short",
}).format(new Date(valor));

export const GRUPOS = { crescimento: "Crescimento", operacao: "Operação", gestao: "Gestão" };
export const ESTADOS: Record<string, string> = {
  PENDENTE: "Na fila", EXECUTANDO: "Em execução", AGUARDA_APROVACAO: "Aguardando revisão",
  CONCLUIDO: "Concluído", BLOQUEADO: "Requer atenção", FALHOU: "Falhou", CANCELADO: "Cancelado",
};
