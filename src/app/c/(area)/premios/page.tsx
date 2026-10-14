import { Suspense } from "react";
import { MeusPremios } from "@/components/jogos/MeusPremios";

export const dynamic = "force-dynamic";

export default function Premios() {
  return <Suspense><MeusPremios /></Suspense>;
}
