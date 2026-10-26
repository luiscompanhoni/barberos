# Completar cadastros com fontes verificadas

Use `scripts/completar-cadastros.ts` para enriquecer clientes a partir dos CSVs de clientes do CashBarber e Celcoin. O importador antigo `importar-clientes-cashbarber.ts` agrupa pelo telefone e nao deve ser usado para este fluxo.

O modo padrao apenas simula. Antes de aplicar, preserve os originais fora do repositorio, confira seus hashes, faca backup do banco e teste em homologacao. Nunca versione CSVs, relatorios com dados pessoais, backups ou credenciais.

```sh
npx tsx scripts/completar-cadastros.ts /pasta-privada/cash.csv /pasta-privada/celcoin.csv --relatorio=/pasta-privada/simulacao.json
# Depois de conferir a simulacao e validar o backup:
npx tsx scripts/completar-cadastros.ts /pasta-privada/cash.csv /pasta-privada/celcoin.csv --aplicar --relatorio=/pasta-privada/aplicacao.json
```

Em imagens sem tsx, compile com esbuild, `--bundle --platform=node --external:@prisma/client`, e execute o CJS no container que ja possui as credenciais do banco. Nao imprima variaveis de ambiente. Os CSVs aceitam UTF-8 e Windows-1252; cabecalhos obrigatorios, aspas e quantidade de colunas sao validados.

## Regras

- CPF deve passar os digitos verificadores; telefone deve ser celular brasileiro valido.
- CPF ou telefone do destino precisa concordar com o nome completo normalizado. Telefone compartilhado por nomes diferentes, CPF divergente, documento duplicado e identificadores que apontam para pessoas diferentes ficam pendentes.
- So CPF, e-mail e nascimento ausentes sao completados; telefone, nome e dados existentes permanecem preservados. Data de nascimento deve existir no calendario e corresponder a idade entre 5 e 100 anos.
- Fontes discordantes nao sao resolvidas escolhendo arbitrariamente a primeira linha. E-mail de outro cadastro e valores repetidos entre destinos tambem sao retidos.
- Novos clientes exigem telefone unico e ausencia de possivel cadastro com mesmo nome em outro telefone. Fontes concordantes do mesmo telefone geram apenas uma pessoa.
- Nenhuma assinatura, pagamento, permissao ou mensagem e criada. Clientes novos entram com mensagens automaticas desabilitadas, pois o CSV nao comprova consentimento. Preferencias existentes sao preservadas.
- Aplicacao em transacao serializavel, com auditoria por cliente, estado anterior dos perfis completados, identificacao da fonte e SHA-256. Falha desfaz o lote inteiro. Relatorio opcional tem dados pessoais e deve ficar em pasta privada, fora do projeto.

Repita a simulacao apos aplicar. O esperado e `completar: 0` e `criar: 0`; pendencias podem continuar existindo. Linhas pendentes nao equivalem a pessoas distintas. Enderecos nao sao importados porque o cadastro atual nao possui campos para eles. Dados ausentes nas duas fontes nao sao inventados.
