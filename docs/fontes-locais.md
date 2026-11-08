# Fontes locais do aplicativo

O layout usa `next/font/local` com as mesmas famílias Manrope e Geist Mono e as mesmas variáveis `--font-manrope` e `--font-geist-mono`. As classes do layout, o tema Black, as marcas e o mapeamento de fontes no CSS foram preservados. `font-display: swap` continua explícito; preload e ajuste de fallback permanecem a cargo do Next.

Os arquivos oficiais estão versionados em `src/app/fonts/`. O build lê esses bytes locais, sem consultar CSS ou arquivos do Google Fonts. Isso remove o caminho `next/font/google` que falhou no Turbopack do build Linux; não há troca de dependências, TLS desabilitado ou download durante a compilação.

| Arquivo | Distribuição | Pesos no layout | Bytes | SHA-256 |
|---|---|---|---:|---|
| `Manrope-Variable.ttf` | Manrope 4.505, variável | 300–800 | 164700 | `3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6` |
| `GeistMono-Variable.woff2` | Geist Mono 1.700, variável | 100–900 | 71596 | `afaacc4c5fbba89d2ebf7a02dc4070208540874592a5504d57175782fe893101` |

A Manrope foi obtida da [distribuição oficial Google Fonts](https://github.com/google/fonts/tree/main/ofl/manrope), arquivo `Manrope[wght].ttf`, blob Git imutável [`75274da58537d6123b14f2cd0c355ad4681fc2b3`](https://api.github.com/repos/google/fonts/git/blobs/75274da58537d6123b14f2cd0c355ad4681fc2b3). Seu eixo original vai de 200 a 800; o layout mantém os pesos 300 a 800 usados anteriormente. Foi escolhido o TTF variável completo para não converter a fonte nem substituir a distribuição por seis WOFF2 estáticos maiores.

A Geist Mono veio do [repositório oficial Vercel](https://github.com/vercel/geist-font), revisão [`77f0563c03009d6c15c6342183fa53b352255b22`](https://github.com/vercel/geist-font/tree/77f0563c03009d6c15c6342183fa53b352255b22), arquivo `fonts/GeistMono/webfonts/GeistMono[wght].woff2`, blob [`0e746fc18223dfcb107a85502a0abe1b1a02d51a`](https://api.github.com/repos/vercel/geist-font/git/blobs/0e746fc18223dfcb107a85502a0abe1b1a02d51a). Nenhum dos dois binários foi convertido ou recortado pelo projeto.

As duas famílias permitem empacotamento em software comercial sob a SIL Open Font License 1.1, preservando copyright e licença. As cópias integrais acompanham os arquivos: [Manrope-OFL.txt](../src/app/fonts/Manrope-OFL.txt) e [GeistMono-OFL.txt](../src/app/fonts/GeistMono-OFL.txt). Origens das licenças: [Google Fonts/Manrope](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt) e [Vercel/Geist na revisão usada](https://github.com/vercel/geist-font/blob/77f0563c03009d6c15c6342183fa53b352255b22/OFL.txt). Não vender as fontes isoladamente nem remover esses avisos.

## Verificação e limites

As assinaturas TTF/WOFF2 e os hashes Git dos binários foram conferidos após o download. A comparação com os arquivos Latin do build Google anterior encontrou métricas verticais iguais e contornos/avanços iguais para 191 glifos Latin comuns da Manrope e 190 da Geist Mono no peso padrão dos arquivos, incluindo os caracteres portugueses da interface.

A Manrope anterior também identificava versão 4.505. O arquivo Google da Geist Mono identificava 1.701; a distribuição Vercel fixada identifica 1.700. Essa diferença de versão está registrada, sem substituir a família ou afirmar comparação exaustiva de todos os glifos e pesos. As fontes variáveis completas foram mantidas; nenhum subset adicional foi produzido. O carregamento de fallback é calculado por `next/font/local`, conforme sua implementação instalada.

Para aceitar a alteração, executar o check/build com os transportes de teste e rede externa bloqueados, e repetir o CI Linux/Docker da revisão. Um build Windows anterior ou o download das fontes sozinho não comprova o build Linux corrigido. A API de fonte local, intervalos de peso e variáveis seguem a [documentação do Next](https://nextjs.org/docs/app/api-reference/components/font#local-fonts), também conferida na documentação de `node_modules/next/dist/docs/` da versão instalada.

Atualizações futuras devem manter origem oficial, revisão/blob imutável, licença, pesos, cobertura necessária e SHA-256. Os arquivos são parte do código; sua obtenção não faz parte do build nem depende de credenciais ou serviço pago.
