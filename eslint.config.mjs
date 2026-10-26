import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import quality from "./eslint-rules/index.cjs";

// Regras locais (eslint-rules/, perfil leve do Vibe Coding Toolkit). Self-check: `npm run lint:rules`.
// Detalhes e baseline em docs/quality.md.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["eslint-rules/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    plugins: { quality },
    rules: {
      // Baseline: arquivos que ja passavam do limite quando a regra entrou. Ao dividir um, tire-o da lista.
      "quality/max-lines": ["error", {
        max: 350,
        ignore: [
          "src/components/jogos/caixas/AberturaCaixa.tsx",
          "src/lib/pagamentos/pagarme.ts",
          "src/components/jogos/raspadinha/CartaRaspavel.tsx",
          "scripts/teste-checkout.ts", // teste de integracao (prefixo teste- nao e reconhecido como teste)
        ],
      }],
    },
  },
  {
    // Componentes de interface nao importam o cliente do banco: chamam src/lib/<dominio> ou uma rota.
    files: ["src/components/**/*.{ts,tsx}"],
    plugins: { quality },
    rules: {
      "quality/no-direct-data-access": ["error", { modules: ["@/lib/db"], layers: ["/src/components/"], bindings: ["db"] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    ".agents/**",
    ".claude/**",
    ".claude-flow/**",
    "graphify-out/**",
  ]),
]);

export default eslintConfig;
