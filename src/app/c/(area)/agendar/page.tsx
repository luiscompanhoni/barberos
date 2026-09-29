import { Suspense } from "react";
import { AgendarTela } from "@/components/cliente/AgendarTela";

export default function Agendar() {
  return (
    <Suspense>
      <AgendarTela />
    </Suspense>
  );
}
