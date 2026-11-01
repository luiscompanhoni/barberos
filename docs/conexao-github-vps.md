# Conexão GitHub → VPS

O workflow **Verificar conexão com a VPS** testa o acesso configurado no ambiente `produção`, restrito
à branch `main`. Pode ser acionado pelo Codex ou em Actions → Run workflow. Também executa quando os
arquivos desse teste são atualizados na main. Não faz deploy, backup, migração, instalação ou reinício.

Configuração do ambiente:

- Variáveis: `VPS_HOST`, `VPS_USER`; `VPS_PORT` opcional, padrão 22.
- Secrets: `VPS_SSH_KEY` (chave privada completa) e `VPS_KNOWN_HOSTS` (identidade pública previamente
  conferida no console do provedor). Credenciais são preenchidas diretamente no GitHub, nunca no chat.

O teste recusa configurações ausentes ou inválidas, exige a identidade ED25519 cadastrada e usa somente
autenticação por chave. O único comando remoto imprime uma confirmação constante. Não coleta configuração
da aplicação nem dados de clientes. A chave temporária tem acesso restrito e é removida mesmo em falha.
Erros exibem somente mensagens controladas; nenhuma saída remota bruta é publicada.

Verificação local: `node --test scripts/publicacao/verificar-conexao.test.mjs`. Os testes usam dados
descartáveis e processo SSH simulado. Somente uma execução bem-sucedida do workflow comprova autenticação
real pelo GitHub. A confirmação do Windows não substitui essa execução, e o teste não aprova o deploy:
inventário, backup/restauração e recuperação da versão precisam ser conferidos antes da publicação.

O acesso real passou em [41345736651](https://github.com/luiscompanhoni/barberos/actions/runs/41345736651),
após o usuário salvar o secret no ambiente. O teste não alterou a instalação.

O workflow manual **Conferir VPS sem publicar** consulta capacidade, metadados Docker, migrações,
metadados de backups e hashes do código instalado. Não lê `.env` nem dados de clientes. O relatório
completo é cifrado com AES-256-GCM e a chave de sessão é protegida por RSA-OAEP-SHA256 para uma chave
pública fornecida na execução. Somente o destinatário mantém a privada, fora do repositório e do GitHub.
O artefato cifrado é retido por um dia; o JSON legível é removido do runner e nunca é publicado nos logs.

Revisão sugerida, sem execução automática: três ciclos por envolver credenciais de produção.
Prompt: “Revise em três ciclos a proteção e limpeza da chave; a identidade do host e erros; as restrições
do workflow e evidências de autenticação. Não exponha segredos nem altere o servidor.”
