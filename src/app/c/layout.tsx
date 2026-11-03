import { TransicaoCrm } from "@/components/visual/TransicaoCrm";

/** Mantém a mesma superfície visual em login, área privada e links de pagamento. */
export default function LayoutClientePublico({ children }: { children: React.ReactNode }) {
  return <div className="crm-surface crm-client flex min-h-full flex-1 flex-col"><TransicaoCrm>{children}</TransicaoCrm></div>;
}
