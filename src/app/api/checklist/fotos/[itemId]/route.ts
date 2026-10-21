import { NextResponse } from "next/server";
import { z } from "zod";
import { auditar } from "@/lib/auditoria";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { lerFotoChecklist, MAX_FOTOS_TAREFA } from "@/lib/checklist/foto-validacao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

async function acesso(req: Request, itemId: string) {
  const token = new URL(req.url).searchParams.get("token");
  if (token) {
    const pessoa = await db.checklistPessoa.findUnique({ where: { token }, select: { id: true, ativo: true } });
    if (!pessoa?.ativo) throw naoEncontrado("Link");
    const item = await db.checklistItem.findFirst({ where: { id: itemId, pessoaId: pessoa.id } });
    if (!item) throw naoEncontrado("Tarefa");
    return { item, usuarioId: null };
  }
  const s = await exigirSessao(BALCAO);
  const item = await db.checklistItem.findUnique({ where: { id: itemId } });
  if (!item) throw naoEncontrado("Tarefa");
  return { item, usuarioId: s.usuarioId };
}

export const GET = rota(async (req: Request, ctx: RouteContext<"/api/checklist/fotos/[itemId]">) => {
  const { itemId } = await ctx.params;
  await acesso(req, itemId);
  const fotos = await db.checklistFoto.findMany({ where: { itemId }, orderBy: { criadoEm: "asc" } });
  return NextResponse.json({ fotos: fotos.map((f) => ({ id: f.id, criadoEm: f.criadoEm, dataUrl: `data:${f.tipo};base64,${Buffer.from(f.dados).toString("base64")}` })) },
    { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = rota(async (req: Request, ctx: RouteContext<"/api/checklist/fotos/[itemId]">) => {
  const { itemId } = await ctx.params;
  const { usuarioId } = await acesso(req, itemId);
  const b = await corpo(req, z.object({ dataUrl: z.string().max(560_000) }));
  const foto = lerFotoChecklist(b.dataUrl);
  await db.$transaction(async (tx) => {
    // Serializa anexos concorrentes e preserva evidências já validadas.
    await tx.$queryRaw`SELECT id FROM checklist_itens WHERE id = ${itemId} FOR UPDATE`;
    const item = await tx.checklistItem.findUniqueOrThrow({ where: { id: itemId } });
    if (item.avaliacao === "VALIDADO") throw new ErroNegocio("A tarefa já foi validada. Desfaça a validação antes de anexar outra foto.", 409);
    if (await tx.checklistFoto.count({ where: { itemId } }) >= MAX_FOTOS_TAREFA) throw new ErroNegocio("Cada tarefa aceita até 3 fotos.", 409);
    await tx.checklistFoto.create({ data: { itemId, ...foto } });
    await auditar(tx, usuarioId, "checklist_foto", "checklist_item", itemId, { bytes: foto.dados.length, tipo: foto.tipo });
  });
  return NextResponse.json({ ok: true }, { status: 201 });
});
