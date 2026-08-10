/**
 * /api/backup-r2-cron — BACKUP EXTERNO OFF-REGION (Cloudflare R2), para DR.
 *
 * POR QUÊ: o backup diário do Supabase Pro cobre o BANCO (7 dias, MESMA região), mas NÃO
 * cobre o Storage (arquivos), e fica tudo na mesma região (sa-east-1). Para recuperação de
 * desastre com cópia "em local distinto", espelhamos no R2:
 *   1) STORAGE IRRECUPERÁVEL: os uploads do próprio usuário (matrícula manual, KYC, contrato,
 *      comprovantes) — hoje 33 arquivos / ~11 MB. Tudo que é `_auto` (matrícula/edital/anexo
 *      raspado dos leiloeiros, ~14 GB) FICA DE FORA: é recuperável pela própria captura.
 *   2) SNAPSHOT DO NEGÓCIO: as tabelas irrecuperáveis e pequenas (perfis, arremates, índice,
 *      indicadores, planos) viram JSON e vão para o R2 — cópia off-region do estado do negócio,
 *      complementando o backup nativo do banco.
 *
 * DORMENTE POR PADRÃO: sem as env do R2, apenas responde {dormant:true} (nada roda). Ative
 * criando o bucket no Cloudflare e definindo na Vercel:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET   (opcional: R2_PREFIX)
 * SigV4 é assinado à mão com o crypto do Node (R2 é S3-compatível) — sem dependência nova.
 *
 * SEGURO/ECONÔMICO: best-effort (nunca derruba), volume minúsculo (11 MB), re-espelha só o
 * que mudou (compara tamanho via HEAD). Autorizado por CRON_SECRET. Registrado no vercel.json.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };
// ORÇAMENTO DE TEMPO (10/08). A execução de 10/08 04:40 morreu com "Task timed out after 120
// seconds" e a de 09/08 não deixou linha nenhuma: o `registrarExecucao` é a ÚLTIMA instrução do
// handler, então um timeout mata o backup ANTES do rastro — cópia off-region parada por 2 dias
// com o painel em silêncio, descoberta só pelo health-check reclamando de backup velho. Duas
// mudanças: o teto sobe para 300s (Pro; mesmo teto do monitor-fontes) e a varredura do storage
// respeita um orçamento MENOR que ele, para sempre sobrar tempo de gravar o que aconteceu. Um
// backup incompleto passa a ser um FATO REGISTRADO (`ok=false`), não uma ausência de linha.
const ORCAMENTO_STORAGE_MS = 200000; // 200s dos 300s: sobra p/ snapshot do negócio + limpeza + rastro
// Espelhamento em paralelo: cada arquivo custa 1 HEAD (+ download + PUT quando mudou), e a fila
// era 100% sequencial — por isso 73 arquivos já estouravam 120s. 6 é conservador para o R2 e
// corta o tempo da varredura por ~6.
const CONCORRENCIA = 6;
// Região do bucket R2 (location hint declarado na criação: enam/weur/apac/...). Serve para o
// health-check conferir que a cópia está FORA da região do banco (Supabase: sa-east-1).
const R2_REGIAO = (process.env.R2_LOCATION || '').trim();
// Janela de retenção dos snapshots diários do banco na cópia off-region. Backup é para
// restaurar desastre recente — não para guardar histórico de dados pessoais sem prazo.
const DIAS_SNAPSHOT = 90;

import crypto from 'node:crypto';
import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const R2 = {
  account: (process.env.R2_ACCOUNT_ID || '').trim(),
  keyId: (process.env.R2_ACCESS_KEY_ID || '').trim(),
  secret: (process.env.R2_SECRET_ACCESS_KEY || '').trim(),
  bucket: (process.env.R2_BUCKET || '').trim(),
  prefix: (process.env.R2_PREFIX || '').trim().replace(/^\/+|\/+$/g, ''),
};
const R2_ON = !!(R2.account && R2.keyId && R2.secret && R2.bucket);

// Tabelas irrecuperáveis e PEQUENAS → snapshot JSON off-region (o banco já tem backup nativo;
// isto é a cópia em local distinto). Fora: imoveis_leilao/editais (recapturáveis pela captura).
const TABELAS_NEGOCIO = [
  'perfis', 'arrematacoes', 'arrematados', 'planos_config',
  'indice_amostra', 'cidade_indicadores', 'leiloeiro_conhecimento',
];

// MINIMIZAÇÃO NA CÓPIA (LGPD Art. 6º, III — necessidade). A cópia existe para RESTAURAR um
// desastre; para isso não é preciso levar chave financeira nem documento legível para fora
// do país. Colunas listadas aqui saem do snapshot da tabela:
//   • chave_pix / pix_key / pj_chave_pix → é o dado de MAIOR valor para um atacante e o de
//     MENOR custo de recuperação: o parceiro recadastra no próximo saque, em segundos.
//   • cpf (texto claro) → resquício de antes da criptografia. O CPF continua na cópia como
//     `cpf_enc` (AES-GCM) e `cpf_hash` (HMAC): sem a CPF_ENC_KEY — que NÃO vai no backup —
//     são bytes inúteis. Restauração preservada, exposição eliminada.
// Se a credencial do R2 vazar, o achado é "dados cifrados, sem chave", não "CPF e PIX".
const COLUNAS_FORA = {
  perfis: ['cpf', 'chave_pix', 'pix_key', 'pj_chave_pix'],
};

// Monta o ?select= da tabela excluindo COLUNAS_FORA. Sem lista definida → `*` (como antes).
async function selectDaTabela(tabela) {
  const fora = COLUNAS_FORA[tabela];
  if (!fora?.length) return '*';
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/backup_colunas_da_tabela`,
    { method: 'POST', headers: { ...sbHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ p_tabela: tabela }) },
  ).catch(() => null);
  const cols = r && r.ok ? await r.json().catch(() => null) : null;
  if (!Array.isArray(cols) || !cols.length) return null; // não sabemos as colunas → NÃO copia
  return cols.filter((c) => !fora.includes(c)).join(',');
}

function sbHeaders() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }

// Deixa rastro de CADA execução em backup_execucoes — é o que o check-up de saúde lê para
// dizer se a cópia off-region está viva. Best-effort: nunca derruba o backup.
async function registrarExecucao(dados) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/backup_execucoes`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        destino: R2_ON ? `r2:${R2.account}/${R2.bucket}` : null,
        regiao_destino: R2_REGIAO || null,
        ...dados,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch { /* rastro é best-effort */ }
}
const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const hmac = (key, str) => crypto.createHmac('sha256', key).update(str).digest();

// RFC3986 para a QUERY canônica: o SigV4 exige percent-encoding também em !'()*, que o
// encodeURIComponent deixa passar. (No caminho mantemos o encoder já em uso e testado.)
const enc = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// Assinatura AWS SigV4 para uma chamada única no R2 (region "auto", service "s3").
// `key` vazia = operação no BUCKET (ex.: ListObjectsV2); `query` entra na assinatura.
function assinar(method, key, payloadHash, extraHeaders = {}, query = null) {
  const host = `${R2.account}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const uri = key === ''
    ? '/' + encodeURIComponent(R2.bucket)
    : '/' + [R2.bucket, ...key.split('/')].map(encodeURIComponent).join('/');
  const canonicalQuery = query ? Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&') : '';
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...extraHeaders };
  const signedNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedNames.map((h) => `${h}:${String(headers[Object.keys(headers).find((k) => k.toLowerCase() === h)]).trim()}\n`).join('');
  const signedHeaders = signedNames.join(';');
  const canonicalRequest = `${method}\n${uri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(Buffer.from(canonicalRequest))}`;
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + R2.secret, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${R2.keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `https://${host}${uri}${canonicalQuery ? `?${canonicalQuery}` : ''}`, headers: { ...headers, Authorization: authorization } };
}

// Tamanho já espelhado no R2 (HEAD) — para re-espelhar só o que mudou. -1 se não existe/erro.
async function r2Tamanho(key) {
  try {
    const { url, headers } = assinar('HEAD', key, sha256hex(Buffer.alloc(0)));
    const r = await fetch(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(15000) });
    if (r.status === 200) return Number(r.headers.get('content-length') || -1);
  } catch { /* trata como ausente */ }
  return -1;
}

async function r2Put(key, body, contentType) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const { url, headers } = assinar('PUT', key, sha256hex(buf), { 'content-type': contentType || 'application/octet-stream' });
  const r = await fetch(url, { method: 'PUT', headers, body: buf, signal: AbortSignal.timeout(60000) });
  return r.ok;
}

// Lista TODAS as chaves sob um prefixo (ListObjectsV2, paginado). Devolve **null** em
// qualquer falha — o chamador NUNCA apaga com base numa listagem incompleta, senão uma
// falha de rede viraria exclusão de backup.
async function r2Listar(prefixo) {
  const chaves = [];
  let token = null;
  const desescapa = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  for (let pagina = 0; pagina < 50; pagina++) { // teto defensivo: 50 × 1000 objetos
    const query = { 'list-type': '2', prefix: prefixo, 'max-keys': '1000', ...(token ? { 'continuation-token': token } : {}) };
    try {
      const { url, headers } = assinar('GET', '', sha256hex(Buffer.alloc(0)), {}, query);
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      if (!r.ok) return null;
      const xml = await r.text();
      for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) chaves.push(desescapa(m[1]));
      if (!/<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)) return chaves;
      const prox = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
      if (!prox) return chaves;
      token = desescapa(prox[1]);
    } catch { return null; }
  }
  return chaves;
}

async function r2Delete(key) {
  try {
    const { url, headers } = assinar('DELETE', key, sha256hex(Buffer.alloc(0)));
    const r = await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) });
    return r.ok || r.status === 404; // 404 = já não existe, objetivo cumprido
  } catch { return false; }
}

// O rastro em backup_execucoes é a ÚNICA prova de que a cópia off-region rodou. Se o corpo
// estourar (rede, R2 fora, bug), o `registrarExecucao` do fim nunca acontecia e o resultado era
// indistinguível de "o cron não existe": silêncio. Aqui a exceção vira linha `ok=false` com o
// motivo, e só depois sobe.
export default async function handler(req, res) {
  try {
    await executar(req, res);
  } catch (e) {
    await registrarExecucao({ dormante: false, ok: false, detalhe: { motivo: 'excecao', erro: String(e?.message || e) } });
    if (!res.headersSent) res.status(500).json({ error: 'falha no backup', detalhe: String(e?.message || e) });
  }
}

async function executar(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'env Supabase ausente' }); return; }
  if (!R2_ON) {
    // Registra a execução DORMENTE: sem este rastro, um backup desligado ficava invisível —
    // o cron respondia 200 e o painel seguia verde. O health-check lê isto e acusa.
    await registrarExecucao({ dormante: true, ok: false, detalhe: { motivo: 'R2 não configurado' } });
    res.status(200).json({ ok: true, dormant: true, motivo: 'R2 não configurado (defina R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET)' });
    return;
  }

  const pfx = R2.prefix ? R2.prefix + '/' : '';
  const out = {
    storage: { total: 0, enviados: 0, iguais: 0, falhas: 0 },
    negocio: { tabelas: 0, falhas: 0 },
    limpeza: { orfaos: 0, snapshots: 0, falhas: 0, pulada: null },
  };
  // Chaves que DEVEM existir na cópia (preenchido no passo 1) — base da limpeza do passo 3.
  const esperadas = new Set();
  let manifestoOk = false;
  // Varredura do storage COMPLETA? Só uma varredura completa autoriza a limpeza do passo 3 —
  // ver a trava lá embaixo. Começa `false` e só vira `true` no fim do passo 1.
  let storageCompleto = false;
  const comecou = Date.now();

  // 1) STORAGE IRRECUPERÁVEL → R2 (espelha só o que mudou de tamanho)
  try {
    const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/rpc/backup_manifesto_irrecuperaveis`, {
      method: 'POST', headers: { ...sbHeaders(), 'Content-Type': 'application/json' }, body: '{}',
    })).json();
    if (Array.isArray(rows)) {
      manifestoOk = true;
      out.storage.total = rows.length;
      let proximo = 0;
      const espelhar = async (o) => {
        try {
          const destino = `${pfx}storage/${o.bucket}/${o.name}`;
          esperadas.add(destino);
          if ((await r2Tamanho(destino)) === Number(o.tamanho)) { out.storage.iguais++; return; }
          const dl = await fetch(`${SUPABASE_URL}/storage/v1/object/${o.bucket}/${o.name.split('/').map(encodeURIComponent).join('/')}`, {
            headers: sbHeaders(), signal: AbortSignal.timeout(45000),
          });
          if (!dl.ok) { out.storage.falhas++; return; }
          const bytes = Buffer.from(await dl.arrayBuffer());
          if (await r2Put(destino, bytes, dl.headers.get('content-type') || 'application/octet-stream')) out.storage.enviados++;
          else out.storage.falhas++;
        } catch { out.storage.falhas++; }
      };
      // Fila com CONCORRENCIA trabalhadores. Cada um para de puxar quando o orçamento acaba —
      // o que sobra fica declarado em `out.storage.restantes` e o run é marcado incompleto.
      await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, rows.length) }, async () => {
        while (proximo < rows.length) {
          if (Date.now() - comecou > ORCAMENTO_STORAGE_MS) return;
          await espelhar(rows[proximo++]);
        }
      }));
      if (proximo >= rows.length) storageCompleto = true;
      else out.storage.restantes = rows.length - proximo;
    }
  } catch { /* storage best-effort */ }

  // 2) SNAPSHOT DO NEGÓCIO (tabelas pequenas irrecuperáveis) → R2 como JSON
  const carimbo = new Date().toISOString().slice(0, 10);
  for (const t of TABELAS_NEGOCIO) {
    try {
      // `select` explícito quando a tabela tem colunas fora da cópia (ver COLUNAS_FORA).
      // null = não conseguimos resolver as colunas → falha declarada, NUNCA cai no `*`
      // silencioso (seria copiar justamente o que se decidiu não copiar).
      const sel = await selectDaTabela(t);
      if (sel === null) { out.negocio.falhas++; continue; }
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=${encodeURIComponent(sel)}`, { headers: sbHeaders(), signal: AbortSignal.timeout(45000) });
      if (!r.ok) { out.negocio.falhas++; continue; }
      const json = Buffer.from(await r.text());
      if (await r2Put(`${pfx}db/${carimbo}/${t}.json`, json, 'application/json')) out.negocio.tabelas++;
      else out.negocio.falhas++;
    } catch { out.negocio.falhas++; }
  }

  // 3) ELIMINAÇÃO NA CÓPIA (LGPD Art. 18, VI) — o que saiu da ORIGEM tem de sair do BACKUP.
  //
  // Sem este passo o backup virava ARQUIVO PERMANENTE, e fora do Brasil: o cliente exercia o
  // direito ao esquecimento, o arquivo sumia do Supabase e continuava para sempre no R2. Pior
  // no snapshot do banco, gravado com a DATA na chave (`db/AAAA-MM-DD/...`): uma cópia de
  // `perfis` inteiro — nome, CPF, telefone — por dia, acumulando sem fim. A Política de
  // Privacidade promete anonimização imediata no encerramento da conta; sem isto aqui, a
  // promessa não alcançava a cópia.
  //
  // Duas travas para nunca apagar por engano: só roda se o MANIFESTO foi lido com sucesso
  // (senão "nada é esperado" e apagaríamos tudo) e só apaga com base numa listagem COMPLETA
  // (r2Listar devolve null em qualquer falha).
  // TERCEIRA trava (10/08): a varredura do passo 1 precisa ter terminado. `esperadas` é
  // preenchida arquivo a arquivo; se o orçamento cortou a fila no meio, tudo que não chegou a
  // ser visitado ficaria "não esperado" e este passo APAGARIA do backup cópias perfeitamente
  // válidas — justamente os arquivos que ninguém consegue recuperar. Fila incompleta = não
  // apaga nada; a limpeza espera o próximo run inteiro.
  if (manifestoOk && !storageCompleto) {
    out.limpeza.pulada = 'storage_incompleto';
  } else if (manifestoOk) {
    const atuais = await r2Listar(`${pfx}storage/`);
    if (atuais === null) out.limpeza.pulada = 'listagem_falhou';
    else {
      for (const k of atuais) {
        if (esperadas.has(k)) continue;
        if (await r2Delete(k)) out.limpeza.orfaos++; else out.limpeza.falhas++;
      }
    }
  } else {
    out.limpeza.pulada = 'manifesto_indisponivel';
  }

  // Retenção dos snapshots diários do banco: mantém a janela de DIAS_SNAPSHOT e descarta o
  // resto. Backup serve para restaurar um desastre recente, não para guardar histórico de
  // dados pessoais indefinidamente (LGPD Art. 15, I e Art. 16).
  {
    const snaps = await r2Listar(`${pfx}db/`);
    if (snaps === null) { if (!out.limpeza.pulada) out.limpeza.pulada = 'listagem_db_falhou'; }
    else {
      const corte = new Date(Date.now() - DIAS_SNAPSHOT * 86400000).toISOString().slice(0, 10);
      for (const k of snaps) {
        const m = k.match(/db\/(\d{4}-\d{2}-\d{2})\//);
        if (!m || m[1] >= corte) continue;
        if (await r2Delete(k)) out.limpeza.snapshots++; else out.limpeza.falhas++;
      }
    }
  }

  // Só é "ok" se o storage foi varrido INTEIRO e sem falha, E o snapshot do negócio saiu
  // completo. Varredura cortada pelo orçamento não é sucesso parcial: é uma cópia que não
  // reflete a origem, e o health-check tem de enxergar isso como problema.
  const okGeral = storageCompleto && out.storage.falhas === 0 && out.negocio.falhas === 0 && out.negocio.tabelas > 0;
  await registrarExecucao({
    dormante: false, ok: okGeral,
    arquivos_total: out.storage.total, arquivos_novos: out.storage.enviados,
    arquivos_iguais: out.storage.iguais, falhas: out.storage.falhas + out.negocio.falhas,
    tabelas_ok: out.negocio.tabelas, detalhe: out,
  });
  res.status(200).json({ ok: true, r2: `${R2.account}/${R2.bucket}`, ...out });
}
