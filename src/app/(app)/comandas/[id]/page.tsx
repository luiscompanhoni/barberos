import { ComandaTela } from "@/components/comandas/ComandaTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Comanda(props: PageProps<"/comandas/[id]">) {
  const { id } = await props.params;
  const s = (await sessaoAtual())!;
  return <ComandaTela id={id} papel={s.papel} />;
}
