# Cadastro Pix protegido

O cadastro de destinatários não faz pagamentos. Conferir um lote é uma revisão interna; a saída Pix continua bloqueada e os titulares não foram verificados pelo banco.

## Armazenamento e acesso

Novas chaves são cifradas com AES-256-GCM e nonce aleatório, vinculadas ao ID da pessoa. Um código de autenticação baseado em segredo permite comparar duplicatas normalizadas sem guardar o valor legível. O banco conserva somente cifra, tipo, máscara e esse código. O valor não é devolvido pelo cadastro, pelo lote nem pela exportação da folha.

A variável `RH_PIX_ENCRYPTION_KEY` deve conter uma chave de 32 bytes em base64. Não existe valor padrão. Configure e preserve a chave em armazenamento de segredos com acesso restrito, separado do backup do banco, antes de cifrar dados operacionais. Não escreva seu valor no código, chat, log, documento, artifact ou commit. Uma chave diferente ou perdida impede a restauração dos valores cifrados e bloqueia a conferência do lote. Rotação operacional exige procedimento próprio que mantenha a configuração anterior até testar a restauração; não basta substituir a variável.

Pessoas com permissão de folha podem consultar as máscaras. Somente o dono com sessão atual pode cadastrar, substituir ou remover uma chave. A revisão Pix recebida precisa coincidir com a armazenada; alterações concorrentes exigem atualizar a ficha. O formulário mantém a chave quando o campo de substituição está vazio; remoção é uma opção explícita. Uma versão antiga do formulário sem revisão não consegue apagar o cadastro por acidente.

## Legado e recuperação

A migração SQL acrescenta campos e uma restrição de consistência. Não transforma dados legados automaticamente nem inventa chaves Pix. Registros legados são apresentados mascarados e impedem a conferência do lote até proteger e validar o cadastro.

`scripts/migrar-pix-protegido.ts` é um exercício offline restrito a bancos locais descartáveis. Exige a configuração de proteção antes de consultar registros. Para cada chave válida, trava o cadastro, cifra, decifra e compara a restauração; só então substitui o texto na mesma transação de uma auditoria sem a chave. Dados inválidos permanecem intactos para revisão. Repetições não cifram novamente registros já migrados. Falhas de auditoria ou de integridade não confirmam a alteração do registro.

Antes de qualquer migração operacional futura: backup completo, teste de restauração separado com a configuração de proteção correta e incorreta, contagens de legados/protegidos/pendentes, comparação das máscaras e reversão ensaiada. O script local não concede autorização para executá-la em produção. O rollback do aplicativo não deve reinstalar uma versão que desconheça os novos campos nem remover cifras. Mantenha banco e configuração de proteção recuperáveis juntos, sem colocá-los no mesmo arquivo aberto.

Antes de habilitar pagamentos reais continuam necessários sandbox da Stone, verificação bancária de titular e saldo, reautenticação recente para aprovação, vínculo de aprovação à revisão exata, idempotência e tratamento de estado incerto. Nada disso é substituído pela criptografia ou pela conferência interna.
