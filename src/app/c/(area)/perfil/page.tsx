import { PerfilTela } from "@/components/cliente/PerfilTela";

export default async function Perfil({ searchParams }: PageProps<"/c/perfil">) {
  const { voltar, social } = await searchParams;
  return <PerfilTela confirmarSocial={social === "pendente"} voltar={typeof voltar === "string" ? voltar : undefined} />;
}
