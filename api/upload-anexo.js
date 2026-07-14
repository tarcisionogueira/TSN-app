/**
 * POST /api/upload-anexo
 * Upload MANUAL de um documento (matrícula/edital) do computador do usuário para o
 * bucket privado `documentos` e registro em `imovel_anexos` (por imovel_id).
 *
 * É o fallback do `baixar-doc` (que baixa de URL): a matrícula da Caixa só existe
 * no portal (sem URL direta), então o analista baixa e anexa o arquivo aqui.
 *
 * Recebe multipart/form-data:
 *   file        — o arquivo (PDF/JPG/PNG), até 20 MB
 *   imovel_id   — id do imóvel (compartilhado entre casos)
 *   tipo        — 'matricula' | 'edital'
 *   data_leilao — opcional (YYYY-MM-DD), usado pelo cron de retenção
 *
 * Resposta: { anexo_id, url_publica, storage_path, replaced }
 *
 * Acesso: equipe (analista/advogado/admin) — mesma regra do índice/RLS de imovel_anexos.
 * Usa SERVICE_KEY (server-side) para contornar a ausência de policy de UPDATE e o
 * índice único parcial (imovel_id,tipo): substitui o documento existente sem atrito.
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BUCKET       = 'documentos';
const ROLES_STAFF  = ['analista', 'advogado', 'admin'];
// Documentos do CICLO do arremate (prova + pós-leilão) — atribuição pela equipe
// alimenta a IA com o caso real e ficam PERMANENTES (arrematado=true → o cron nunca
// apaga). Aceitam múltiplos arquivos e podem ser anexados ao longo do tempo.
const TIPOS_ARREMATE = ['auto_arrematacao', 'carta_arrematacao', 'contrato_banco', 'matricula_registrada'];
const TIPOS_OK     = ['matricula', 'edital', 'regras_venda', ...TIPOS_ARREMATE, 'outro'];
// Só matrícula/edital são únicos por imóvel (índice parcial). Os demais tipos
// aceitam vários arquivos — leilões podem ter anexos extras (laudo, ata, etc.).
const TIPOS_UNICOS = ['matricula', 'edital'];
const MAX_BYTES    = 20 * 1024 * 1024; // 20 MB
const TIPOS_MIME   = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

function storage(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(opts.headers || {}),
    },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (!SERVICE_KEY) return json({ error: 'Storage não configurado' }, 500);

  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);

  // Qualquer usuário AUTENTICADO pode anexar a matrícula/edital do lote que está
  // analisando — sem os documentos ele não consegue gerar os relatórios nem
  // agendar. O arquivo também vira CACHE (beneficia as próximas análises). A
  // equipe segue com as mesmas permissões; o tipo/tamanho é validado abaixo.
  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role`)).json();
  if (!perfil) return json({ error: 'Perfil não encontrado.' }, 403);

  let form;
  try { form = await req.formData(); } catch { return json({ error: 'Envio inválido (esperado multipart/form-data)' }, 400); }

  const file = form.get('file');
  const imovel_id = form.get('imovel_id');
  const tipo = String(form.get('tipo') || '').toLowerCase();
  const data_leilao = form.get('data_leilao') || null;
  // Documentos de arremate são PERMANENTES: nunca apagados pelo cron de retenção.
  // arrematado=true vem explícito (fluxo de atribuição) OU é inferido pelo tipo.
  const arrematadoPerm = String(form.get('arrematado') || '') === 'true' || TIPOS_ARREMATE.includes(tipo);

  if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'Arquivo obrigatório' }, 400);
  // imovel_id precisa ser UUID válido antes de entrar em URLs PostgREST/Storage.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(imovel_id || ''))) return json({ error: 'imovel_id inválido' }, 400);
  if (!TIPOS_OK.includes(tipo)) return json({ error: `tipo inválido (use: ${TIPOS_OK.join(', ')})` }, 400);

  const contentType = file.type || 'application/octet-stream';
  if (!TIPOS_MIME.includes(contentType)) return json({ error: 'Formato não suportado (use PDF, JPG ou PNG)' }, 415);
  if (file.size > MAX_BYTES) return json({ error: 'Arquivo excede 20 MB' }, 413);

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) return json({ error: 'Arquivo excede 20 MB' }, 413);

  // Confere a ASSINATURA REAL do arquivo (magic bytes) — o content-type é enviado
  // pelo cliente e é forjável. Impede que um payload arbitrário (HTML/JS) seja
  // aceito como matrícula/edital só por declarar application/pdf. Imóveis de leilão
  // são um cache COMPARTILHADO; docs de não-staff já não sobrescrevem os da equipe.
  const head = new Uint8Array(buffer.slice(0, 4));
  const ehPDF = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
  const ehPNG = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47; // \x89PNG
  const ehJPG = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;                     // JPEG SOI
  if (!ehPDF && !ehPNG && !ehJPG) return json({ error: 'Conteúdo do arquivo não é um PDF/JPG/PNG válido' }, 415);

  const ext = contentType.includes('pdf') ? 'pdf'
    : contentType.includes('png') ? 'png'
    : 'jpg';
  const baseNome = (file.name || `${tipo}.${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `casos/${imovel_id}/${Date.now()}_${baseNome}`;

  // Doc anterior do mesmo (imovel_id, tipo) — para substituir (só tipos únicos).
  // 'regras_venda'/'outro' aceitam múltiplos arquivos → sempre insere novo.
  let anterior = null;
  if (TIPOS_UNICOS.includes(tipo)) {
    const jaRes = await sb(`imovel_anexos?imovel_id=eq.${encodeURIComponent(imovel_id)}&tipo=eq.${encodeURIComponent(tipo)}&select=id,storage_path,role_criador&limit=1`);
    if (jaRes.ok) {
      const [e] = await jaRes.json().catch(() => []);
      if (e) anterior = e;
    }
  }

  // Anti-poisoning: um documento (matrícula/edital) já enviado pela EQUIPE não pode
  // ser sobrescrito por um usuário não-staff. Uploads NOVOS (sem anterior) e a
  // substituição de docs enviados por não-staff continuam abertos — o cliente
  // precisa poder anexar o documento do lote que está analisando.
  const ehStaff = ROLES_STAFF.includes(perfil.role);
  if (anterior && ROLES_STAFF.includes(anterior.role_criador) && !ehStaff) {
    return json({ error: 'Este documento já foi validado pela equipe. Fale com a equipe para substituí-lo.' }, 403);
  }

  // Sobe o novo arquivo
  const up = await storage(`object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
    body: buffer,
  });
  if (!up.ok) {
    console.error('upload-anexo storage erro:', await up.text());
    return json({ error: 'Erro ao salvar no storage' }, 500);
  }

  // Signed URL CURTA (1h) apenas por conveniência imediata — o link definitivo é
  // sempre assinado SOB DEMANDA a partir do storage_path (nada de 1 ano no banco).
  let urlPublica = null;
  try {
    const signRes = await storage(`object/sign/${BUCKET}/${storagePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (signRes.ok) {
      const { signedURL } = await signRes.json();
      if (signedURL) urlPublica = `${SUPABASE_URL}/storage/v1${signedURL}`;
    }
  } catch (_) { /* segue com url null; readers assinam pelo storage_path */ }

  const payload = {
    tipo,
    nome: baseNome,
    url: urlPublica,
    storage_path: storagePath,
    origem_url: null,
    data_leilao: data_leilao || null,
    arrematado: arrematadoPerm,
    tamanho_kb: Math.round(buffer.byteLength / 1024),
    criado_por: user.id,
    role_criador: perfil.role,
  };

  let anexo;
  if (anterior) {
    // Substitui o registro existente (não há policy de UPDATE p/ client; aqui é service key)
    const upd = await sb(`imovel_anexos?id=eq.${anterior.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    if (!upd.ok) {
      await storage(`object/${BUCKET}/${storagePath}`, { method: 'DELETE' });
      console.error('upload-anexo update erro:', await upd.text());
      return json({ error: 'Erro ao registrar anexo' }, 500);
    }
    [anexo] = await upd.json();
    // Remove o arquivo antigo do storage (best-effort)
    if (anterior.storage_path && anterior.storage_path !== storagePath) {
      await storage(`object/${BUCKET}/${anterior.storage_path}`, { method: 'DELETE' }).catch(() => {});
    }
  } else {
    const ins = await sb('imovel_anexos', { method: 'POST', body: JSON.stringify({ imovel_id, ...payload }) });
    if (!ins.ok) {
      await storage(`object/${BUCKET}/${storagePath}`, { method: 'DELETE' });
      console.error('upload-anexo insert erro:', await ins.text());
      return json({ error: 'Erro ao registrar anexo' }, 500);
    }
    [anexo] = await ins.json();
  }

  return json({ anexo_id: anexo?.id, url_publica: urlPublica, storage_path: storagePath, replaced: !!anterior });
}
