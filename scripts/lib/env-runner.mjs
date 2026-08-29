/**
 * Carrega ~/.bidpro-runner.env — import de EFEITO COLATERAL, uma linha por script.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * POR QUE EXISTE (29/08): quem carregava esse arquivo era o `runner-residencial.sh`. Rodando
 * um script NA MÃO — que é exatamente o que se faz para investigar — ninguém carrega, e o
 * script morre em `Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY`. Aconteceu duas vezes na
 * mesma sessão, nas duas o dono estava no meio de um diagnóstico:
 *   • `recon-hasta-zerou.mjs` morreu DEPOIS de gastar minutos de Chromium na medição;
 *   • `scraper-hasta.mjs` nem começou, logo após o recon confirmar o conserto.
 *
 * Ferramenta que exige ritual de ambiente falha justamente na hora da pressa, e o custo não é
 * o erro em si — é a rodada perdida e a dúvida ("será que o conserto não funcionou?").
 *
 * CONTRATO, de propósito estreito:
 *   • NÃO sobrescreve variável já presente — CI e Vercel continuam mandando no ambiente delas;
 *   • arquivo ausente é SILÊNCIO, não erro (no GitHub Actions ele não existe e está certo);
 *   • não valida nada: quem exige credencial continua exigindo, com a mensagem que já tinha.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

try {
  const txt = readFileSync(process.env.BIDPRO_RUNNER_ENV || join(homedir(), '.bidpro-runner.env'), 'utf8');
  for (const linha of txt.split('\n')) {
    const m = linha.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;                                   // comentário, linha vazia, lixo
    const valor = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    if (!process.env[m[1]]) process.env[m[1]] = valor;  // ambiente existente sempre vence
  }
} catch { /* padrao-ok: sem o arquivo seguimos com o ambiente atual — é o caso normal na CI */ }
