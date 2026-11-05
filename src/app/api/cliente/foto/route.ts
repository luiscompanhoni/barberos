import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";
import { db } from "@/lib/db";
import { atualizarFotoTitular } from "@/lib/clientes/perfil-mutacao";
import { ErroNegocio, naoEncontrado, rota } from "@/lib/erros";
import { lerFotoChecklist } from "@/lib/checklist/foto-validacao";

export const GET = rota(async () => {
  const s = await exigirCliente();
  const c = await db.cliente.findUnique({ where: { id: s.clienteId }, select: { fotoDados: true, fotoTipo: true } });
  if (!c?.fotoDados || !c.fotoTipo) throw naoEncontrado("Foto");
  return new Response(new Uint8Array(c.fotoDados), { headers: { "Content-Type": c.fotoTipo,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
});

export const PUT = rota(async (req: Request) => {
  const s = await exigirCliente(); exigirOrigemCliente(req);
  const reader = req.body?.getReader(); if (!reader) throw new ErroNegocio("Selecione uma foto.");
  const partes: Uint8Array[] = []; let tamanho = 0;
  try { for (;;) { const r = await reader.read(); if (r.done) break; tamanho += r.value.length;
    if (tamanho > 550_000) { await reader.cancel(); throw new ErroNegocio("A foto passou do limite.", 413); } partes.push(r.value); } }
  finally { reader.releaseLock(); }
  let valor: unknown;
  try { valor = JSON.parse(Buffer.concat(partes).toString("utf8")); } catch { throw new ErroNegocio("Foto inválida."); }
  if (!valor || typeof valor !== "object" || !("dataUrl" in valor) || typeof valor.dataUrl !== "string") throw new ErroNegocio("Foto inválida.");
  const { dados, tipo } = lerFotoChecklist(valor.dataUrl);
  const c = await atualizarFotoTitular(s, { dados, tipo });
  return NextResponse.json(c);
});
export const DELETE = rota(async (req: Request) => {
  const s = await exigirCliente(); exigirOrigemCliente(req);
  const c = await atualizarFotoTitular(s, null);
  return NextResponse.json(c);
});
