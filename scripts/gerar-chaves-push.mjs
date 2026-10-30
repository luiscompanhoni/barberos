/** Gera credenciais VAPID em arquivo privado; nunca imprime os valores nem altera o .env existente. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import webpush from "web-push";

const destino = resolve(process.argv[2] || ".env.push");
const chaves = webpush.generateVAPIDKeys();
const conteudo = [
  "# Copie estas variáveis para a configuração privada do servidor. Não versione este arquivo.",
  "# Preencha um contato real em VAPID_SUBJECT e ative PUSH_PROVIDER=webpush somente após configurar HTTPS.",
  'PUSH_PROVIDER="desativado"',
  `VAPID_PUBLIC_KEY="${chaves.publicKey}"`,
  `VAPID_PRIVATE_KEY="${chaves.privateKey}"`,
  'VAPID_SUBJECT=""',
  "",
].join("\n");
try {
  writeFileSync(destino, conteudo, { flag: "wx", mode: 0o600 });
  console.log(`Chaves gravadas em ${destino}. O arquivo existente da aplicação não foi alterado.`);
} catch (erro) {
  console.error(erro?.code === "EEXIST" ? "O arquivo de destino já existe. Preserve as chaves em uso ou escolha outro destino." : "Não foi possível gravar o arquivo privado de chaves.");
  process.exitCode = 1;
}
