import { TrocarSenha } from "@/components/conta/TrocarSenha";

/** Minha conta (equipe): senha e usuario de login. */
export default function Conta() {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <p className="eyebrow">Minha conta</p>
        <h1 className="titulo-marca text-2xl">Acesso</h1>
      </div>
      <TrocarSenha equipe destaque />
    </div>
  );
}
