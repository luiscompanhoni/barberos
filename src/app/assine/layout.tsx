import { TransicaoCrm } from "@/components/visual/TransicaoCrm";

export default function LayoutVitrine({ children }: { children: React.ReactNode }) {
  return <div className="crm-surface crm-public flex min-h-full flex-1 flex-col"><TransicaoCrm>{children}</TransicaoCrm></div>;
}
