import { redirect } from "next/navigation";
/** Preserva favoritos e links antigos, sem manter uma entrada duplicada no menu. */
export default function Page() { redirect("/financeiro?area=pessoal"); }
