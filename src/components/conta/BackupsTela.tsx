"use client";

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, DatabaseBackup } from "lucide-react";
import { api } from "@/lib/cliente-api";

type Backup = { id: string; tipo: string; arquivo: string; bytes: number; restaurado: boolean; conferencia: string | null; foraDoServidor: boolean; erro: string | null; criadoEm: string };
const TIPO: Record<string, string> = { DIARIO: "diário", DEPLOY: "antes do deploy", MANUAL: "manual" };
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const mb = (b: number) => `${(b / 1_048_576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

/** Backups do banco (so o dono): cada copia, se a restauracao de teste conferiu e se foi para fora do servidor. */
export function BackupsTela() {
  const [d, setD] = useState<{ foraLigada: boolean; backups: Backup[] } | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    api<{ foraLigada: boolean; backups: Backup[] }>("/api/backups").then(setD).catch((e) => setErro(e.message));
  }, []);

  return (
    <section id="backups" className="cartao space-y-3">
      <div className="flex items-center gap-2">
        <DatabaseBackup size={18} className="text-ouro" />
        <h2 className="font-semibold">Backups</h2>
      </div>
      <p className="text-sm text-zinc-500">
        Todo dia às 03h (e antes de cada atualização) o sistema copia o banco, restaura a cópia num banco separado e
        confere se está tudo lá. As cópias ficam 14 dias no servidor.
        {d && (d.foraLigada ? " Uma cópia criptografada vai para fora do servidor." : " A cópia fora do servidor está desligada: veja no README como ligar.")}
      </p>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      {d && d.backups.length === 0 && <p className="text-sm text-zinc-500">Nenhum backup registrado ainda.</p>}
      {d && d.backups.length > 0 && (
        <ul className="divide-y divide-zinc-200 text-sm">
          {d.backups.map((b) => (
            <li key={b.id} className="flex items-start gap-2 py-2">
              {b.erro || !b.restaurado
                ? <CircleAlert size={16} className="mt-0.5 shrink-0 text-red-500" />
                : <CircleCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" />}
              <div className="min-w-0 flex-1">
                <p>
                  <b>{quando(b.criadoEm)}</b> <span className="text-xs text-zinc-500">· {TIPO[b.tipo] ?? b.tipo} · {mb(b.bytes)}{b.foraDoServidor ? " · cópia fora ✓" : ""}</span>
                </p>
                <p className="text-xs text-zinc-500">
                  {b.erro ? <span className="text-red-600">{b.erro}</span> : b.restaurado ? `Restaurado e conferido: ${b.conferencia}` : "Sem restauração de teste (cópia rápida antes do deploy)."}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
