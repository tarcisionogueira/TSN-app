import { supabase } from './supabase';
import { PLANOS } from '../data/cursos';

const fmt = (v, decimais = 2) =>
  `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: decimais, maximumFractionDigits: decimais })}`;

/** Calcula preco_vista a partir do desconto % ou retorna o valor salvo no DB. */
function calcVista(cfg) {
  if (cfg.desconto_vista_pct > 0) {
    return Number(cfg.preco) * (1 - Number(cfg.desconto_vista_pct) / 100);
  }
  return cfg.preco_vista ?? null;
}

/**
 * Retorna o objeto PLANOS enriquecido com preços ao vivo do planos_config do Supabase.
 * Dados de UX (cor, recursos, homepage, etc.) vêm do cursos.js estático.
 */
export async function fetchPlanosComConfig() {
  const { data } = await supabase.from('planos_config').select('*');
  if (!data) return PLANOS;

  const merged = { ...PLANOS };
  data.forEach(cfg => {
    const base = merged[cfg.plano_key];
    if (!base) return;
    const vista = calcVista(cfg);
    const anual = cfg.preco_anual ? Number(cfg.preco_anual) : null;
    const preco = cfg.preco != null ? Number(cfg.preco) : base.preco;
    merged[cfg.plano_key] = {
      ...base,
      nome: cfg.nome || base.nome,
      preco,
      precoLabel: fmt(preco),
      precoAnual: anual,
      precoAnualLabel: anual ? fmt(anual) : null,
      precoMensalAnual: anual ? anual / 12 : null,
      precoMensalAnualLabel: anual ? fmt(anual / 12) : null,
      precoVista: vista,
      precoVistaLabel: vista ? fmt(vista, 0) : null,
      desconto_vista_pct: cfg.desconto_vista_pct ?? 0,
      comissao_pct: cfg.comissao_pct ?? 0,
      cobrar: cfg.cobrar,
      ativo: cfg.ativo,
      // label de periodicidade para assessorado/clube
      periodicidade: (['assessorado', 'clube'].includes(cfg.plano_key) && vista)
        ? `/mês · 12 meses · ou ${fmt(vista, 0)} à vista`
        : base.periodicidade,
      precoVistaLabel2: vista
        ? `${fmt(vista, 0)} à vista (${cfg.desconto_vista_pct > 0 ? cfg.desconto_vista_pct.toFixed(0) + '% off' : 'à vista'})`
        : null,
    };
  });
  return merged;
}
