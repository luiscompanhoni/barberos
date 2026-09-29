import { redirect } from "next/navigation";
import { ConversasTela } from "@/components/conversas/ConversasTela";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function Conversas() {
  const s = (await sessaoAtual())!;
  if (s.papel === "BARBEIRO") redirect("/");
  return <ConversasTela />;
}
