/**
 * LINK RASTREADO DE E-MAIL — mede clique com o que já é nosso, sem depender do Resend.
 *
 * POR QUE EXISTE (11/08): dos 136 e-mails dos últimos 30 dias, 55 têm confirmação de entrega
 * e ZERO têm abertura ou clique — o rastreio do Resend é opt-in por domínio e está desligado.
 * Ligá-lo exige subdomínio, CNAME e espera de DNS, e mesmo assim a ABERTURA é medida por pixel
 * invisível que o Apple Mail dispara sozinho e o Gmail bloqueia. O número que presta é o
 * CLIQUE — e clique a gente consegue medir sozinho, porque todo link dos nossos e-mails já
 * aponta para o nosso próprio domínio.
 *
 * Ganho que o Resend não daria: o clique cai em `atividade_log`, ou seja, aparece no
 * **Cliente 360** junto do resto do que a pessoa fez — em vez de virar um número agregado
 * num painel de terceiro, desconectado de quem clicou.
 *
 * ─── SEGURANÇA: por que o destino é um CAMINHO, e não uma URL ──────────────────────
 * Se este endpoint aceitasse `?u=https://qualquer-coisa.com`, ele viraria um **open
 * redirect**: um golpista mandaria `bidprobrasil.com.br/api/clique?...` que leva à página
 * falsa dele, com o nosso domínio na barra do e-mail. Aqui só entra caminho interno
 * (começando com `/`, e `//` é recusado porque `//evil.com` é URL absoluta disfarçada), e o
 * destino final é sempre montado sobre a NOSSA base. Não existe destino externo possível.
 *
 * A assinatura HMAC não é sobre o destino (esse já é seguro por construção) — é sobre a
 * IDENTIDADE: sem ela, qualquer um forjaria cliques de qualquer usuário e envenenaria o 360.
 * Falha FECHADA: sem segredo configurado, nenhum token valida.
 */
import crypto from 'crypto';

const SECRET = process.env.UNSUB_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_KEY || '';
export const BASE_EMAIL = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

const b64 = (s) => Buffer.from(String(s)).toString('base64url');
const deb64 = (s) => { try { return Buffer.from(String(s), 'base64url').toString('utf8'); } catch { return ''; } };

/** Assinatura sobre os três campos juntos — trocar qualquer um invalida o link. */
export function assinarClique(userId, tipo, caminho) {
  if (!SECRET) return '';
  return crypto.createHmac('sha256', SECRET)
    .update(`${userId}|${tipo}|${caminho}`)
    .digest('hex').slice(0, 16);
}

export function conferirClique(userId, tipo, caminho, sig) {
  if (!SECRET || !sig) return false;
  const esperado = Buffer.from(assinarClique(userId, tipo, caminho));
  const recebido = Buffer.from(String(sig));
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

/**
 * Monta o link rastreado. `caminho` é interno e DEVE começar com '/'
 * (ex.: '/#/buscar?utm_source=email_ativacao').
 *
 * Sem `userId` (e-mail para quem ainda não tem conta) devolve o link direto: rastrear sem
 * saber de quem é o clique não serve para nada, e um link a mais na cadeia só adiciona um
 * ponto de falha entre a pessoa e a página.
 */
export function linkRastreado(userId, tipo, caminho) {
  const c = String(caminho || '');
  // Caminho inválido é BUG DE QUEM CHAMOU, e a pior saída seria concatenar mesmo assim:
  // `BASE + 'https://x'` produz `https://bidprobrasil.com.brhttps://x`, um link quebrado
  // dentro do e-mail do cliente. Cair na home mantém o link funcionando e o erro visível
  // (o botão leva ao lugar errado, e alguém percebe) em vez de entregar lixo clicável.
  const interno = c.startsWith('/') && !c.startsWith('//');
  if (!interno) return BASE_EMAIL;

  const destino = `${BASE_EMAIL}${c}`;
  if (!userId || !SECRET || !tipo) return destino;   // prévia/manual: link direto, sem rastreio
  const sig = assinarClique(userId, tipo, c);
  return `${BASE_EMAIL}/api/clique?u=${b64(userId)}&t=${encodeURIComponent(tipo)}&p=${b64(c)}&s=${sig}`;
}

export const decodificarClique = (u, p) => ({ userId: deb64(u), caminho: deb64(p) });
