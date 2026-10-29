"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { useAcesso } from "@/components/AcessoContexto";
import { FotoBarbeiro } from "@/components/FotoBarbeiro";
import { formatarTelefone } from "@/lib/telefone";
import type { ServicoApi } from "@/components/agenda/EncaixeModal";

type BarbeiroApi = { id: string; nome: string; cor: string; ativo: boolean; fotoVersao: number; usuario: { telefone: string } };
const LADO_FOTO = 320;

/** Recorte central quadrado, redimensionado no navegador e exportado em webp (jpeg se nao houver webp). */
async function prepararFoto(arquivo: File): Promise<string> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const lado = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = LADO_FOTO;
    const ctx = canvas.getContext("2d");
    if (!ctx || !lado) throw new Error("Não foi possível ler a imagem.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, LADO_FOTO, LADO_FOTO);
    const webp = canvas.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
  } catch (e) {
    throw e instanceof Error && e.message.startsWith("Não") ? e : new Error("Não foi possível ler a imagem. Use JPG, PNG ou WebP.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const CORES = ["#378ADD", "#1D9E75", "#D85A30", "#7F77DD", "#D4537E", "#BA7517", "#639922"];

/** Painel do dono: cadastro de barbeiros e servicos (quem faz o que). */
export function EquipeTela() {
  // Desativar corta o login: só o dono (o servidor confere).
  const souDono = useAcesso().papel === "DONO";
  const [barbeiros, setBarbeiros] = useState<BarbeiroApi[]>([]);
  const [servicos, setServicos] = useState<ServicoApi[]>([]);
  const [erro, setErro] = useState("");
  const [nb, setNb] = useState({ nome: "", telefone: "" });
  const [ns, setNs] = useState({ nome: "", duracaoMin: "30", preco: "" });
  const [fotoAlvo, setFotoAlvo] = useState<string | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(() => {
    api<BarbeiroApi[]>("/api/barbeiros").then(setBarbeiros).catch((e) => setErro(e.message));
    api<ServicoApi[]>("/api/servicos").then(setServicos).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  async function acao(fn: () => Promise<unknown>) {
    setErro("");
    try { await fn(); carregar(); } catch (e) { setErro((e as Error).message); }
  }

  const escolherFoto = (id: string) => {
    setFotoAlvo(id);
    arquivoRef.current?.click();
  };

  const enviarFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    const id = fotoAlvo;
    if (!arquivo || !id) return;
    setEnviandoFoto(id);
    await acao(async () => {
      const dataUrl = await prepararFoto(arquivo);
      await api(`/api/barbeiros/${id}/foto`, { method: "PUT", body: { dataUrl } });
    });
    setEnviandoFoto(null);
  };

  const removerFoto = (b: BarbeiroApi) => {
    if (!confirm(`Remover a foto de ${b.nome}?`)) return;
    acao(() => api(`/api/barbeiros/${b.id}/foto`, { method: "DELETE" }));
  };

  const novoBarbeiro = (e: React.FormEvent) => {
    e.preventDefault();
    if (nb.nome.trim().length < 2 || nb.telefone.replace(/\D/g, "").length < 10) return setErro("Informe nome e celular com DDD.");
    acao(async () => {
      await api("/api/barbeiros", { method: "POST", body: { ...nb, cor: CORES[barbeiros.length % CORES.length] } });
      setNb({ nome: "", telefone: "" });
    });
  };

  const novoServico = (e: React.FormEvent) => {
    e.preventDefault();
    const preco = Math.round(Number(ns.preco.replace(",", ".")) * 100);
    const dur = Number(ns.duracaoMin);
    if (ns.nome.trim().length < 2 || !Number.isFinite(preco) || preco < 0 || !dur) return setErro("Preencha nome, duração e preço do serviço.");
    acao(async () => {
      await api("/api/servicos", { method: "POST", body: { nome: ns.nome, duracaoMin: dur, precoCentavos: preco, barbeiroIds: barbeiros.filter((b) => b.ativo).map((b) => b.id) } });
      setNs({ nome: "", duracaoMin: "30", preco: "" });
    });
  };

  const alternarFaz = (s: ServicoApi, barbeiroId: string) => {
    const ids = s.barbeiros.map((b) => b.barbeiroId);
    const novos = ids.includes(barbeiroId) ? ids.filter((i) => i !== barbeiroId) : [...ids, barbeiroId];
    acao(() => api(`/api/servicos/${s.id}`, { method: "PATCH", body: { barbeiroIds: novos } }));
  };

  const ativos = barbeiros.filter((b) => b.ativo);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <section className="cartao space-y-3">
        <h2 className="font-semibold">Barbeiros</h2>
        <ul className="divide-y divide-zinc-100 text-sm">
          {barbeiros.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 py-2">
              <button type="button" className="group relative rounded-full" onClick={() => escolherFoto(b.id)} disabled={enviandoFoto === b.id}
                title={b.fotoVersao > 0 ? "Trocar foto" : "Adicionar foto"} aria-label={`${b.fotoVersao > 0 ? "Trocar" : "Adicionar"} foto de ${b.nome}`}>
                <FotoBarbeiro id={b.id} nome={b.nome} cor={b.cor} versao={b.fotoVersao} tamanho={44} className={enviandoFoto === b.id ? "opacity-40" : ""} />
                <span className="absolute -right-1 -bottom-1 grid h-5 w-5 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-600 group-hover:text-ouro">
                  <Camera size={11} />
                </span>
              </button>
              <span className={`font-medium ${b.ativo ? "" : "text-zinc-400 line-through"}`}>{b.nome}</span>
              <span className="text-zinc-500">{formatarTelefone(b.usuario.telefone)}</span>
              {enviandoFoto === b.id && <span className="text-xs text-zinc-500">Enviando foto...</span>}
              {b.fotoVersao > 0 && enviandoFoto !== b.id && (
                <button className="ml-auto inline-flex items-center gap-1 text-xs text-zinc-600 underline" onClick={() => removerFoto(b)}>
                  <Trash2 size={12} /> remover foto
                </button>
              )}
              {souDono && (
                <button className={`${b.fotoVersao > 0 && enviandoFoto !== b.id ? "" : "ml-auto "}text-xs text-zinc-600 underline`} onClick={() => acao(() => api(`/api/barbeiros/${b.id}`, { method: "PATCH", body: { ativo: !b.ativo } }))}>
                  {b.ativo ? "desativar" : "reativar"}
                </button>
              )}
            </li>
          ))}
        </ul>
        <input ref={arquivoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={enviarFoto} />
        <form onSubmit={novoBarbeiro} className="flex flex-wrap gap-2">
          <input className="campo max-w-48" placeholder="Nome" value={nb.nome} onChange={(e) => setNb({ ...nb, nome: e.target.value })} />
          <input className="campo max-w-48" placeholder="Celular (login)" inputMode="tel" value={nb.telefone} onChange={(e) => setNb({ ...nb, telefone: e.target.value })} />
          <button className="btn-primario">Adicionar barbeiro</button>
        </form>
        <p className="text-xs text-zinc-500">Toque na foto para trocar. O barbeiro entra no sistema com esse celular. Depois de cadastrar, configure os horários dele em Horários da equipe.</p>
      </section>

      <section className="cartao space-y-3">
        <h2 className="font-semibold">Serviços</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-2 font-medium">Serviço</th>
                <th className="py-1 pr-2 font-medium">Duração</th>
                <th className="py-1 pr-2 font-medium">Preço</th>
                {ativos.map((b) => <th key={b.id} className="py-1 pr-2 text-center font-medium">{b.nome}</th>)}
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {servicos.map((s) => (
                <tr key={s.id} className={s.ativo ? "" : "text-zinc-400"}>
                  <td className="py-2 pr-2 font-medium">{s.nome}</td>
                  <td className="py-2 pr-2">{s.duracaoMin} min</td>
                  <td className="py-2 pr-2">{reais(s.precoCentavos)}</td>
                  {ativos.map((b) => (
                    <td key={b.id} className="py-2 pr-2 text-center">
                      <input type="checkbox" aria-label={`${b.nome} faz ${s.nome}`} className="h-4 w-4"
                        checked={s.barbeiros.some((x) => x.barbeiroId === b.id)} onChange={() => alternarFaz(s, b.id)} />
                    </td>
                  ))}
                  <td className="py-2 text-right">
                    <button className="text-xs text-zinc-600 underline" onClick={() => acao(() => api(`/api/servicos/${s.id}`, { method: "PATCH", body: { ativo: !s.ativo } }))}>
                      {s.ativo ? "desativar" : "reativar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={novoServico} className="flex flex-wrap gap-2">
          <input className="campo max-w-48" placeholder="Nome do serviço" value={ns.nome} onChange={(e) => setNs({ ...ns, nome: e.target.value })} />
          <select className="campo w-auto" value={ns.duracaoMin} onChange={(e) => setNs({ ...ns, duracaoMin: e.target.value })}>
            {[15, 30, 45, 60, 75, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
          <input className="campo max-w-32" placeholder="Preço (R$)" inputMode="decimal" value={ns.preco} onChange={(e) => setNs({ ...ns, preco: e.target.value })} />
          <button className="btn-primario">Adicionar serviço</button>
        </form>
      </section>
    </div>
  );
}
