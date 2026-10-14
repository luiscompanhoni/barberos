import { TelaJogo } from "@/components/jogos/TelaJogo";

export const dynamic = "force-dynamic";

/** Um jogo: "roleta", "raspadinha" (ou outro id) ou "caixas" (os niveis de caixa juntos). */
export default async function Jogo({ params }: PageProps<"/c/jogos/[id]">) {
  const { id } = await params;
  return <TelaJogo id={id} />;
}
