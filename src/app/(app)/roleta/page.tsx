import { redirect } from "next/navigation";

/** Endereco antigo: a roleta agora fica junto dos outros jogos. */
export default function Roleta() {
  redirect("/jogos");
}
