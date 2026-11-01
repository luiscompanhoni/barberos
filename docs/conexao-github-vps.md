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

Revisão sugerida, sem execução automática: três ciclos por envolver credenciais de produção.
Prompt: “Revise em três ciclos a proteção e limpeza da chave; a identidade do host e erros; as restrições
do workflow e evidências de autenticação. Não exponha segredos nem altere o servidor.”
