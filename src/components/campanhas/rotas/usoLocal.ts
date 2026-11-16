import { useMemo, useState, useSyncExternalStore } from "react";
import { lerDadosRotas, type DadosRotas } from "@/lib/campanhas/rotas-demo";
import { DADOS_DEMO_ROTAS } from "@/lib/campanhas/rotas-demo-semente";

const ATUALIZOU = "barberos-rotas-demo-alteracao";
const lerServidor = () => null;

function observar(atualizar: () => void) {
  window.addEventListener("storage", atualizar);
  window.addEventListener(ATUALIZOU, atualizar);
  return () => {
    window.removeEventListener("storage", atualizar);
    window.removeEventListener(ATUALIZOU, atualizar);
  };
}

function ler(chave: string) {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

export function useRotasLocais(conta: string) {
  const chave = `barberos:rotas-demo:v1:${conta}`;
  const json = useSyncExternalStore(observar, () => ler(chave), lerServidor);
  const locais = useMemo(() => lerDadosRotas(json) ?? DADOS_DEMO_ROTAS, [json]);
  const [temporarios, setTemporarios] = useState<DadosRotas | null>(null);

  function salvar(alterar: (dados: DadosRotas) => DadosRotas) {
    const dados = alterar(temporarios ?? lerDadosRotas(ler(chave)) ?? DADOS_DEMO_ROTAS);
    try {
      window.localStorage.setItem(chave, JSON.stringify(dados));
      setTemporarios(null);
      window.dispatchEvent(new Event(ATUALIZOU));
    } catch {
      setTemporarios(dados);
    }
  }

  return { dados: temporarios ?? locais, salvar, temporario: temporarios !== null };
}
