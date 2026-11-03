/** Identidade própria da Black em login, área privada e links do cliente. */
export default function LayoutClientePublico({ children }: { children: React.ReactNode }) {
  return <div className="black-app black-sereno flex min-h-full flex-1 flex-col">{children}</div>;
}
