"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

type Link = { href: string; rotulo: string };
/** Uma aba = uma secao do painel (link de prefixo mais longo); guarda a ultima subpagina e a rolagem. */
type Aba = { base: string; caminho: string; rolagem: number; uso: number };

const LIMITE = 8;

/** Link de prefixo mais longo que casa com a rota (ex.: /indicadores/barbeiro/x -> /indicadores). */
function linkDaRota(links: Link[], rota: string): Link | null {
  let melhor: Link | null = null;
  for (const l of links) {
    const casa = rota === l.href || rota.startsWith(l.href.endsWith("/") ? l.href : `${l.href}/`);
    if (casa && (!melhor || l.href.length > melhor.href.length)) melhor = l;
  }
  return melhor;
}

function rotuloDe(links: Link[], base: string) {
  const l = links.find((x) => x.href === base);
  if (l) return l.rotulo;
  const seg = base.split("/").filter(Boolean)[0] ?? "Início";
  return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ");
}

function ler(chave: string): Aba[] {
  try {
    const bruto = JSON.parse(localStorage.getItem(chave) ?? "[]");
    if (!Array.isArray(bruto)) return [];
    return bruto
      .filter((a) => a && typeof a.base === "string" && typeof a.caminho === "string" && a.caminho.startsWith("/"))
      .map((a) => ({ base: a.base, caminho: a.caminho, rolagem: Number(a.rolagem) || 0, uso: Number(a.uso) || 0 }))
      .slice(0, LIMITE);
  } catch {
    return [];
  }
}

function gravar(chave: string, abas: Aba[]) {
  try { localStorage.setItem(chave, JSON.stringify(abas)); } catch { /* sem localStorage: abas so na memoria */ }
}

/** Barra de abas no topo do painel: troca de tela sem abrir abas do navegador. */
export function AbasPainel({ links, chave }: { links: Link[]; chave: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const chaveLs = `barberos:abas:${chave}`;
  const [abas, setAbas] = useState<Aba[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [menu, setMenu] = useState(false);
  const base = linkDaRota(links, pathname)?.href ?? pathname;
  const ativaRef = useRef(base);
  const restaurandoRef = useRef(false);
  const abasRef = useRef(abas);
  const barraRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => { ativaRef.current = base; }, [base]);
  useEffect(() => { abasRef.current = abas; }, [abas]);

  // Abre (ou atualiza) a aba da rota atual e aplica o limite.
  useEffect(() => {
    const caminho = pathname + window.location.search;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza com a URL e o localStorage
    setAbas((prev) => {
      const lista = carregado ? prev : ler(chaveLs);
      const agora = Date.now();
      let nova = lista.some((a) => a.base === base)
        ? lista.map((a) => (a.base === base ? { ...a, caminho, uso: agora } : a))
        : [...lista, { base, caminho, rolagem: 0, uso: agora }];
      while (nova.length > LIMITE) {
        const velha = nova.filter((a) => a.base !== base).sort((a, b) => a.uso - b.uso)[0];
        nova = nova.filter((a) => a !== velha);
      }
      return nova;
    });
    setCarregado(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- so quando muda a rota
  }, [pathname, base, chaveLs]);

  useEffect(() => {
    if (carregado) gravar(chaveLs, abas);
  }, [abas, carregado, chaveLs]);

  // Restaura a rolagem da aba (tenta por ~1,5 s enquanto a pagina carrega os dados).
  useEffect(() => {
    if (!carregado) return;
    const alvo = abasRef.current.find((a) => a.base === base)?.rolagem ?? 0;
    if (alvo <= 0) return;
    restaurandoRef.current = true;
    let tentativas = 0;
    let timer: ReturnType<typeof setTimeout>;
    const parar = () => { restaurandoRef.current = false; clearTimeout(timer); };
    const tentar = () => {
      window.scrollTo(0, alvo);
      if (Math.abs(window.scrollY - alvo) > 2 && ++tentativas < 30) timer = setTimeout(tentar, 50);
      else parar();
    };
    timer = setTimeout(tentar, 0);
    // Usuario mexeu: desiste de restaurar.
    const eventos = ["wheel", "touchstart", "keydown"] as const;
    eventos.forEach((e) => window.addEventListener(e, parar, { passive: true }));
    return () => {
      parar();
      eventos.forEach((e) => window.removeEventListener(e, parar));
    };
  }, [base, carregado]);

  // Guarda a rolagem da aba ativa quando a pagina para de rolar.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const rolou = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (restaurandoRef.current) return;
        const y = Math.round(window.scrollY);
        const ativa = ativaRef.current;
        setAbas((prev) => prev.map((a) => (a.base === ativa && a.rolagem !== y ? { ...a, rolagem: y } : a)));
      }, 200);
    };
    window.addEventListener("scroll", rolou, { passive: true });
    return () => { window.removeEventListener("scroll", rolou); clearTimeout(timer); };
  }, []);

  // Fecha o menu "+" com clique fora ou Esc.
  useEffect(() => {
    if (!menu) return;
    const fora = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [menu]);

  // Mantem a aba ativa visivel na rolagem horizontal (celular).
  useEffect(() => {
    barraRef.current?.querySelector<HTMLElement>("[data-ativa=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [base, abas.length]);

  const irPara = useCallback((caminho: string) => router.push(caminho, { scroll: false }), [router]);

  const abrir = (l: Link) => {
    setMenu(false);
    const existente = abas.find((a) => a.base === l.href);
    irPara(existente?.caminho ?? l.href);
  };

  const fechar = (alvo: Aba) => {
    if (abas.length <= 1) return;
    const i = abas.findIndex((a) => a.base === alvo.base);
    const resto = abas.filter((a) => a.base !== alvo.base);
    setAbas(resto);
    if (alvo.base === base) irPara((resto[i] ?? resto[i - 1]).caminho);
  };

  // Antes de ler o localStorage (SSR/hidratacao), mostra so a aba atual.
  const lista = carregado ? abas : [{ base, caminho: pathname, rolagem: 0, uso: 0 }];

  return (
    <div className="relative -mt-1 mb-3 flex h-9 items-end gap-1 border-b border-zinc-200 sm:mb-4">
      <div ref={barraRef} role="tablist" aria-label="Telas abertas"
        className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {lista.map((a) => {
          const ativa = a.base === base;
          return (
            <div key={a.base} data-ativa={ativa}
              className={`group flex h-8 max-w-[180px] shrink-0 items-center rounded-t-lg border border-b-0 text-xs transition ${
                ativa ? "border-zinc-200 bg-white font-semibold text-zinc-900" : "border-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              }`}>
              <button role="tab" aria-selected={ativa} onClick={() => !ativa && irPara(a.caminho)} title={rotuloDe(links, a.base)}
                className={`flex h-full min-w-0 items-center gap-1.5 pl-3 ${lista.length > 1 ? "pr-1" : "pr-3"}`}>
                {ativa && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ouro" />}
                <span className="truncate">{rotuloDe(links, a.base)}</span>
              </button>
              {lista.length > 1 && (
                <button onClick={() => fechar(a)} aria-label={`Fechar ${rotuloDe(links, a.base)}`}
                  className={`mr-1 grid h-5 w-5 shrink-0 place-items-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-900 ${ativa ? "" : "sm:opacity-0 sm:group-hover:opacity-100"}`}>
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div ref={menuRef} className="relative shrink-0 self-center">
        <button onClick={() => setMenu(!menu)} aria-label="Abrir outra tela" aria-expanded={menu} title="Abrir outra tela"
          className={`grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 ${menu ? "bg-zinc-100 text-zinc-900" : ""}`}>
          <Plus size={15} />
        </button>
        {menu && (
          <div className="entrar-suave absolute top-9 right-0 z-40 max-h-[60vh] w-56 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl">
            {links.map((l) => {
              const aberta = abas.some((a) => a.base === l.href);
              return (
                <button key={l.href} onClick={() => abrir(l)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">
                  {l.rotulo}
                  {aberta && <span className="text-[10px] text-zinc-400">aberta</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
