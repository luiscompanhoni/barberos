import type { painelDesempenho } from "@/lib/desempenho/consultas";

type Json<T> = T extends Date ? string : T extends (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
export type PainelDesempenho = Json<Awaited<ReturnType<typeof painelDesempenho>>>;
export type ResumoDesempenho = NonNullable<PainelDesempenho["resumo"]>;
export type Acao = (dados: Record<string, unknown>) => Promise<boolean>;
