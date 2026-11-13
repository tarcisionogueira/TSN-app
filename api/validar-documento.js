export const config = { runtime: 'edge' };

import { normalizarCodigo, mascararDocumento } from '../src/lib/codigo-validacao.js';

// Validação PÚBLICA de documento assinado (12/11, pedido do dono: código ligando todas as páginas do
// documento à folha de assinaturas, como nos serviços de assinatura).
//  - POST { token } → emite (ou devolve) o CÓDIGO do documento daquele link. O token do link é a
//    credencial (mesmo modelo do ContratoLink); só há código se o documento já tem ao menos uma
//    assinatura. Usado pelo ContratoPDF antes de imprimir.
//  - GET ?c=<código> → o que foi assinado, por quem e quando, com CPF/CNPJ mascarado (LGPD) e os hashes.
//    NUNCA devolve token, e-mail, IP, geolocalização, imagem de assinatura ou documentos de identidade.
//    Código inexistente e mal formado têm a mesma resposta. O código tem 80 bits: não se adivinha.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

const resp = (corpo, status = 200) => new Response(JSON.stringify(corpo), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const NAO = { encontrado: false };

const nomeDe = (l) => l.dados_signatario?.nome || l.dados_signatario?.razao_social || l.assinante_nome?.trim() || 'Signatário';
const docDe = (l) => mascararDocumento(l.dados_signatario?.cpf || l.dados_signatario?.cnpj);

export default async function handler(req) {
  if (!SVC || !SUPABASE_URL) return resp({ erro: 'Configuração ausente' }, 500);
  try {
    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return resp({ erro: 'JSON inválido' }, 400); }
      const token = String(body?.token || '');
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) return resp(NAO, 404);
      const r = await sb('rpc/garantir_codigo_validacao', { method: 'POST', body: JSON.stringify({ p_token: token }) });
      if (!r.ok) { console.error('garantir_codigo_validacao', r.status, (await r.text().catch(() => '')).slice(0, 160)); return resp({ erro: 'Não foi possível emitir o código agora.' }, 500); }
      const codigo = await r.json();
      return codigo ? resp({ codigo }) : resp(NAO, 404);
    }
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

    const codigo = normalizarCodigo(new URL(req.url).searchParams.get('c'));
    if (!codigo) return resp(NAO, 404);
    const campos = 'titulo,status,criado_em,assinado_em,assinatura_hash,dados_signatario,assinante_nome,requer_testemunha,nome_testemunha,testemunha_em,contrato_grupo_id';
    const r = await sb(`contratos_link?codigo_validacao=eq.${codigo}&status=neq.cancelado&select=${campos}&order=criado_em.asc`);
    if (!r.ok) { console.error('validar-documento GET', r.status); return resp({ erro: 'Não foi possível consultar agora.' }, 500); }
    const linhas = await r.json();
    if (!Array.isArray(linhas) || !linhas.length) return resp(NAO, 404);

    const partes = linhas.map((l) => ({
      nome: nomeDe(l), documento: docDe(l), assinou: l.status === 'assinado', assinado_em: l.status === 'assinado' ? l.assinado_em : null,
      hash: l.status === 'assinado' ? l.assinatura_hash || null : null,
      testemunha: l.requer_testemunha ? { nome: l.nome_testemunha || null, assinou: !!l.testemunha_em, em: l.testemunha_em || null } : null,
    }));
    const todos = partes.every((p) => p.assinou && (!p.testemunha || p.testemunha.assinou));
    return resp({
      encontrado: true, codigo, titulo: linhas[0].titulo, criado_em: linhas[0].criado_em,
      situacao: todos ? 'assinado' : 'parcial', assinaturas: partes.filter((p) => p.assinou).length, total: partes.length, partes,
    });
  } catch (e) {
    console.error('validar-documento', e?.message);
    return resp({ erro: 'Não foi possível consultar agora.' }, 500);
  }
}
