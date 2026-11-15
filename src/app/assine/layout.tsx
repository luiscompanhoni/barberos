import { TransicaoCrm } from "@/components/visual/TransicaoCrm";

export default function LayoutVitrine({ children }: { children: React.ReactNode }) {
  return <div className="black-app black-sereno black-vitrine-shell flex min-h-full flex-1 flex-col"><TransicaoCrm>{children}</TransicaoCrm></div>;
}
