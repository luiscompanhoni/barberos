import Link from "next/link";
import { Landmark, LockKeyhole, Wallet } from "lucide-react";

export function FinanceiroContexto({ pessoal, podeEmpresa, children }: { pessoal: boolean; podeEmpresa: boolean; children: React.ReactNode }) {
  return <div>
    <div className="black-finance-context">
      <nav aria-label="Contexto financeiro">
        {podeEmpresa && <Link href="/financeiro?area=empresa" aria-current={!pessoal ? "page" : undefined}><Landmark size={18} aria-hidden="true" />Barbearia</Link>}
        <Link href="/financeiro?area=pessoal" aria-current={pessoal ? "page" : undefined}><Wallet size={18} aria-hidden="true" />Pessoal</Link>
      </nav>
      <p><LockKeyhole size={15} aria-hidden="true" />{pessoal ? "Seus lançamentos · somente você" : "Dados da barbearia · conforme seu acesso"}</p>
    </div>
    {children}
  </div>;
}
