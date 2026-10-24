# Acabamento visual da área interna

Biblioteca adicionada: [Motion](https://github.com/motiondivision/motion), versão 14.6.0, licença MIT. A biblioteca é utilizada pelo `AcabamentoBlack` para conectar o detalhe da tesoura à rolagem, sem atualizar estado React por evento de scroll. Não há serviço externo, catálogo de templates, shader ou WebGL.

Os degradês de grafite e ouro e os estados de hover são CSS do projeto, em `src/app/black-workspace.css`. O tema é limitado à classe `black-workspace` do layout da equipe. Cartões com classes de fundo explícitas mantêm suas cores de status. A nova logo depende de um arquivo aprovado pelo proprietário.

A tesoura aparece na lateral apenas no computador. No celular há uma linha discreta de rolagem; nenhum efeito decorativo intercepta cliques. A preferência por movimento reduzido desativa a trilha, e os estados de foco permanecem visíveis. Os formulários não são remontados para fazer transições de página.

Para revisar: dashboard, botões principais de comandas/caixa, cartões clicáveis, navegação por teclado, 390 px de largura, preferência de movimento reduzido e cartões de erro/sucesso. Nenhum fluxo financeiro, regra de pagamento ou permissão foi alterado nesta entrega. Os códigos de fechamento e os valores exibidos continuam vindo dos fluxos existentes.

Esta versão foi preparada em desenvolvimento. A homologação tem alterações de navegação adicionais e deve receber um patch que preserve seu estado atual, sem substituição integral dos arquivos antigos do checkout.
