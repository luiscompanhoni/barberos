import { redirect } from "next/navigation";

/** Endereco antigo da roleta (links ja enviados): vai para a Roleta Black. */
export default function Roleta() {
  redirect("/c/jogos/roleta");
}
