import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // ─── SOURCEMAP EM PRODUÇÃO (13/08) ────────────────────────────────────────────────────
    // POR QUE: em 13/08 um erro REAL de cliente chegou em `erros_cliente` — `/imovel/:id`,
    // "Cannot read properties of null (reading 'id')", visitante anônimo — e NÃO foi possível
    // dizer de onde veio. O stack estava gravado (a coluna existe e é preenchida), mas
    // minificado: `at qs (index-a4hI7HCk.js:33:30918)`. Sem mapa, `qs` não vira nome nenhum.
    // Passei a sessão inteira eliminando candidatos por leitura de código — ImovelGate,
    // ChatSuporte, SugestaoImovel, ToastRelatorioPronto, BoasVindasModal — e todos estavam
    // guardados. O problema não era falta de zelo na busca: era a evidência ter sido apagada
    // no build.
    //
    // É a mesma família que este projeto persegue: um sinal que existe, chega, é gravado — e
    // não significa nada na hora de agir. A trava aqui não é uma regra, é parar de destruir a
    // informação antes de precisar dela.
    //
    // SEGURANÇA: o repositório `tarcisionogueira/TSN-app` é PÚBLICO (ver CLAUDE.md), então o
    // mapa não expõe nada que já não esteja no GitHub. O que NÃO pode vazar continua não
    // podendo: segredo nenhum entra em bundle de front — os que o cliente usa são a URL e a
    // chave publicável do Supabase, protegidas por RLS, e o resto vive nas funções da Vercel,
    // que não são mapeadas aqui. Se o repositório algum dia fechar, troque por 'hidden': o
    // mapa deixa de ser referenciado no bundle e você o lê sob demanda.
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
