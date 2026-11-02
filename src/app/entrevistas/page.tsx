import type { Metadata } from "next";
import { ConfirmarEntrevista } from "@/components/recrutamento/ConfirmarEntrevista";
export const metadata: Metadata = { title: "Confirme sua entrevista — Black Barber", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function Pagina() { return <ConfirmarEntrevista />; }
