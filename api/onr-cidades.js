/**
 * GET /api/onr-cidades?uf=SP&cidade=Campinas
 * Verifica se uma cidade/UF possui cartório integrado ao RI Digital.
 * Retorna { integrado: bool, cartorios: [{ id, nome, cidade, uf }] }
 */

import { getAuthUser } from './_auth.js';
import { onrAjax, invalidateSession } from './_onr.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // getAuthUser retorna null (não lança) quando o token falta/é inválido
  const user = await getAuthUser(req);
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });

  const { searchParams } = new URL(req.url);
  const uf     = (searchParams.get('uf') || '').trim().toUpperCase();
  const cidade = (searchParams.get('cidade') || '').trim().toLowerCase();

  if (!uf) {
    return new Response(JSON.stringify({ error: 'Parâmetro uf é obrigatório' }), { status: 400 });
  }

  try {
    // Tenta buscar lista de cidades/cartórios integrados no RI Digital por UF
    const res = await onrAjax('sitearisp', 'Listagem_cartorios', { uf }, true);

    // Resposta esperada: array de cartórios [[id, nome, cidade, uf], ...]
    // ou objeto { success: true, data: [...] }
    let cartorios = [];

    if (Array.isArray(res)) {
      cartorios = res.map(r => ({
        id:     String(r[0] ?? r.id ?? ''),
        nome:   String(r[1] ?? r.nome ?? ''),
        cidade: String(r[2] ?? r.cidade ?? ''),
        uf:     String(r[3] ?? r.uf ?? uf),
      })).filter(c => c.nome);
    } else if (res && Array.isArray(res.data)) {
      cartorios = res.data;
    } else if (res && Array.isArray(res.cidades)) {
      cartorios = res.cidades;
    }

    // Filtra pela cidade se fornecida
    const cidadesDisponiveis = cidade
      ? cartorios.filter(c => c.cidade.toLowerCase().includes(cidade) || cidade.includes(c.cidade.toLowerCase()))
      : cartorios;

    const integrado = cidadesDisponiveis.length > 0;

    return new Response(JSON.stringify({ integrado, cartorios: cidadesDisponiveis, total_uf: cartorios.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    // Se a sessão expirou, invalida o cache
    if (err.message?.includes('login') || err.message?.includes('session')) {
      invalidateSession();
    }
    // Em caso de erro de rede/API, retorna fallback sem integração confirmada
    console.error('[onr-cidades] erro:', err.message);
    return new Response(JSON.stringify({
      integrado: null,  // null = inconclusivo (diferente de false = não integrado)
      cartorios: [],
      erro: 'Não foi possível consultar o RI Digital. Verifique manualmente.',
    }), { status: 200 });
  }
}
