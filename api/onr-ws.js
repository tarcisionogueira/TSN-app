/**
 * /api/onr-ws — painel do Web Service OFICIAL da ONR (admin). Ver api/_onr-ws.js.
 * GET  → { configurado, falta, ambiente, servico_no_ar, tokens_livres, ultimas_chamadas }
 * POST { acao: 'teste' }   → login + CartoriosListar: prova ponta a ponta e descobre a CAIXA do hash
 *                            (a spec não diz se o SHA-1 vai maiúsculo ou minúsculo).
 * POST { acao: 'saldo' }   → saldo de créditos pré-pagos (Creditos.ObterSaldo).
 * Nada aqui gasta emolumento: login, listagem de cartórios e saldo são gratuitos.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { getUser } from './_auth.js';
import { configOnr, faltaOnr, loginOnr, listarCartorios, saldoCreditos, URL_HOMOLOGACAO } from './_onr-ws.js';

const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

async function sb(method, path, body, prefer) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`PostgREST ${r.status} em ${path.split('?')[0]}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// Códigos que a spec usa para "hash não aceito" (p.ex. 45; algumas tabelas 14/50 — p56, p156).
const ERRO_DE_HASH = new Set([11, 14, 45]);

export default async function handler(req, res) {
  if (!SB || !SVC) return res.status(500).json({ error: 'Supabase não configurado' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const [perfil] = (await sb('GET', `perfis?id=eq.${user.id}&select=role`)) || [];
    if (perfil?.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const cfg = configOnr();

    if (req.method === 'GET') {
      let servicoNoAr = null;
      try {
        const r = await fetch(`${cfg.base}/logincliente.asmx?wsdl`, { signal: AbortSignal.timeout(10000) });
        servicoNoAr = r.ok;
      } catch (e) { servicoNoAr = false; console.warn('[onr-ws] WSDL inacessível:', e?.message || e); }
      const [livres, ultimas] = await Promise.all([
        sb('GET', `onr_ws_tokens?ambiente=eq.${encodeURIComponent(cfg.base)}&usado_em=is.null&gerado_em=gt.${new Date(Date.now() - 7.5 * 3600e3).toISOString()}&select=token`),
        sb('GET', 'onr_ws_chamadas?select=criado_em,servico,metodo,ok,codigo_erro,erro,protocolo,valor_total&order=criado_em.desc&limit=15'),
      ]);
      return res.status(200).json({
        configurado: faltaOnr(cfg).length === 0, falta: faltaOnr(cfg),
        ambiente: cfg.base === URL_HOMOLOGACAO ? 'homologacao' : cfg.base, hash_case: cfg.hashCase,
        servico_no_ar: servicoNoAr, tokens_livres: (livres || []).length, ultimas_chamadas: ultimas || [],
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
    const { acao } = req.body || {};

    if (acao === 'teste') {
      const passos = [];
      try {
        const l = await loginOnr(cfg);
        passos.push({ passo: 'login', ok: true, detalhe: `${l.tokens} tokens · cliente ${l.idCliente ?? '?'} · ${l.ativo ? 'ativo' : 'INATIVO'}` });
      } catch (e) {
        console.warn('[onr-ws] teste: login recusado:', e?.message || e);
        passos.push({ passo: 'login', ok: false, detalhe: e.message });
        return res.status(200).json({ ok: false, passos });
      }
      for (const caixa of [cfg.hashCase, cfg.hashCase === 'upper' ? 'lower' : 'upper']) {
        try {
          const cs = await listarCartorios({ tipoServico: 2, idEstado: 0, idCidade: 0 }, { hashCase: caixa, userId: user.id });
          passos.push({ passo: `cartorios (hash ${caixa})`, ok: true, detalhe: `${cs.length} cartórios com matrícula online` });
          return res.status(200).json({ ok: true, hash_case_aceito: caixa, passos, amostra: cs.slice(0, 3) });
        } catch (e) {
          console.warn(`[onr-ws] teste: cartórios com hash ${caixa} falhou:`, e?.message || e);
          passos.push({ passo: `cartorios (hash ${caixa})`, ok: false, detalhe: e.message });
          if (!ERRO_DE_HASH.has(e.codigo)) break;      // erro que não é de hash: tentar a outra caixa não ajuda
        }
      }
      return res.status(200).json({ ok: false, passos });
    }

    if (acao === 'saldo') {
      try { return res.status(200).json({ ok: true, saldo: await saldoCreditos({ userId: user.id }) }); }
      catch (e) { console.warn('[onr-ws] saldo:', e?.message || e); return res.status(200).json({ ok: false, erro: e.message, codigo: e.codigo ?? null }); }
    }
    return res.status(400).json({ error: 'acao desconhecida' });
  } catch (e) {
    console.error('[onr-ws]', e?.message || e);
    return res.status(500).json({ error: String(e?.message || e).slice(0, 300) });
  }
}
