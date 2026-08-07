import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import checarResponseOk from './eslint-rules/checar-response-ok.js'

// Plugin LOCAL — regras que travam classes de bug já vividas neste projeto (ver o
// cabeçalho de cada arquivo em eslint-rules/ para o caso real que originou a regra).
const bidpro = { rules: { 'checar-response-ok': checarResponseOk } }

export default defineConfig([
  globalIgnores(['dist']),
  // Frontend (browser) — React
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [js.configs.recommended, reactRefresh.configs.vite],
    plugins: { 'react-hooks': reactHooks, bidpro },
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Só as regras clássicas de hooks (bugs reais). Evita o conjunto do React
      // Compiler do react-hooks 7 (set-state-in-effect, purity, etc.), que gera
      // centenas de avisos não acionáveis neste código.
      'bidpro/checar-response-ok': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'warn',
      // Ruído cosmético → aviso (não bloqueia).
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
  // Backend (Node) — serverless functions
  {
    files: ['api/**/*.js'],
    extends: [js.configs.recommended],
    plugins: { bidpro },
    languageOptions: { globals: { ...globals.node }, sourceType: 'module' },
    rules: {
      'bidpro/checar-response-ok': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': 'warn',
      'no-control-regex': 'off', // regex de sanitização usam control chars de propósito
      'no-irregular-whitespace': 'off', // dados raspados contêm NBSP etc.
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'off',
    },
  },
  // Scripts de scraping — Node + trechos em contexto de navegador (page.evaluate)
  {
    files: ['scripts/**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    plugins: { bidpro },
    languageOptions: { globals: { ...globals.node, ...globals.browser }, sourceType: 'module' },
    rules: {
      'bidpro/checar-response-ok': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': 'warn',
      'no-control-regex': 'off',
      'no-irregular-whitespace': 'off', // BOM/NBSP em dados raspados
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'off',
    },
  },
])
