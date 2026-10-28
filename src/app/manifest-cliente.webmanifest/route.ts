import { manifestoApp } from "@/lib/pwa/manifesto";

export function GET() {
  return Response.json(manifestoApp("cliente"), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}
