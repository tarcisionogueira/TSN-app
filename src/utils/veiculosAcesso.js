import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * LEILÃO DE VEÍCULOS ABERTO AO PÚBLICO, LEILOEIRO SÓ COM PLANO (20/10, decisão do dono).
 *
 * Grátis: localizar o carro com o que temos (fotos, preço, FIPE, local, sinais do lote). Plano Veículos
 * (R$ 29,90) ou Combo (R$ 99,90): quem é o leiloeiro, link do lote, documentos, local do pátio e o
 * relatório por IA. A regra mora no BANCO (supabase/migrations/20261020_veiculos_publico_acesso.sql):
 *   • a tabela `veiculos_leilao` só é legível pela equipe;
 *   • o público lê `veiculos_vitrine` (sem nada que leve ao leiloeiro);
 *   • `veiculo_leiloeiro(ids)` / `veiculo_local_patio(ids)` devolvem o resto só para quem tem acesso
 *     (vazio para os demais — não é erro, é o cadeado).
 * Este módulo só escolhe a fonte e junta as peças; esconder aqui sem o banco não protegeria nada.
 */
export const ROLES_EQUIPE_VEICULOS = ['admin', 'analista', 'consultor', 'advogado']; // = eh_equipe() no banco
export const ehEquipeVeiculos = (role) => ROLES_EQUIPE_VEICULOS.includes(role);
export const fonteVeiculos = (role) => (ehEquipeVeiculos(role) ? 'veiculos_leilao' : 'veiculos_vitrine');
export const rotaVeiculo = (role, id) => (ehEquipeVeiculos(role) ? `/admin/veiculos-leilao/${id}` : `/veiculo/${id}`);
export const rotaBuscaVeiculos = (role) => (ehEquipeVeiculos(role) ? '/admin/veiculos-leilao' : '/veiculos');
export const CHECKOUT_VEICULOS = '/checkout?plano=veiculos';
export const CHECKOUT_COMBO = '/checkout?plano=combo';

// Campos restritos (leiloeiro, link, descrição, anexos, placa, pátio) por id. Sem acesso o banco devolve
// lista vazia → Map vazio. Erro de leitura LANÇA: "não consegui ler" não pode virar "não tem leiloeiro".
export async function dadosRestritosVeiculos(ids, { comLocal = false } = {}) {
  const lista = [...new Set((ids || []).filter(Boolean))].slice(0, 60);
  if (!lista.length) return new Map();
  const [r1, r2] = await Promise.all([
    supabase.rpc('veiculo_leiloeiro', { p_ids: lista }),
    comLocal ? supabase.rpc('veiculo_local_patio', { p_ids: lista }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (r1.error) throw new Error(`dados do leiloeiro: ${r1.error.message}`);
  if (r2.error) throw new Error(`local do pátio: ${r2.error.message}`);
  const mapa = new Map((r1.data || []).map((x) => [x.id, { ...x }]));
  for (const x of r2.data || []) mapa.set(x.id, { ...(mapa.get(x.id) || {}), raw: x.raw });
  return mapa;
}

// Acesso do usuário logado (equipe ou plano vigente com a folga de 3 dias do banco). `null` = ainda lendo.
// Erro de leitura vira `false` com aviso no console — a tela mostra o cadeado, que é o lado seguro.
export function useAcessoVeiculos(user, role) {
  const [acesso, setAcesso] = useState(ehEquipeVeiculos(role) ? true : null);
  useEffect(() => {
    if (ehEquipeVeiculos(role)) { setAcesso(true); return; }
    if (!user?.id) { setAcesso(false); return; }
    let vivo = true;
    supabase.rpc('tem_acesso_veiculos').then(({ data, error }) => {
      if (!vivo) return;
      if (error) console.warn('[veiculos] leitura do acesso falhou:', error.message);
      setAcesso(!error && data === true);
    });
    return () => { vivo = false; };
  }, [user?.id, role]);
  return acesso;
}
