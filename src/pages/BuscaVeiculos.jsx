import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Filter, Loader2, MapPin, ExternalLink, X } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { parseDataLocal } from '../utils/format';
import { useIsMobile } from '../utils/useIsMobile';

const ESTADOS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
const POR_PAGINA = 20;

// Mesma lição de `Busca.jsx` (imóveis): NUNCA `select('*')`. `raw` e `descricao` completa
// (sem truncar no banco) ficam de fora — pesam e não aparecem no card.
const COLUNAS = [
  'id', 'titulo', 'descricao', 'marca', 'modelo', 'ano_fabricacao', 'ano_modelo', 'placa', 'km',
  'valor_minimo', 'valor_avaliacao', 'desconto_percentual', 'cidade', 'estado', 'link_lote', 'fotos', 'data_leilao', 'leiloeiro',
  // Direto da API do leiloeiro (11/09) — ver supabase/migrations/veiculos_leilao_sinais_leiloeiro.sql
  'sinistro', 'is_sucata', 'financiavel', 'combustivel', 'cambio', 'cor', 'motor_alerta', 'ipva_situacao',
].join(',');

// Opções de "tipo de monta" (11/09, filtro pedido pelo dono). As 4 classificações padrão do
// mercado segurador — mesmas que `SINISTRO_COR` já reconhece. "grande monta"/"perda total"
// não têm ocorrência no acervo ainda (só SODRE/SUPORTE rodaram), mas são categorias REAIS que
// o leiloeiro usa, não inventadas — ficam disponíveis desde já para quando aparecerem.
const TIPOS_MONTA = ['sem sinistro', 'pequena monta', 'média monta', 'grande monta', 'perda total'];

const fmtBRL = (v) => (v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');

function fmtDataLeilao(d) {
  if (!d) return 'A confirmar';
  const dt = parseDataLocal(d);
  if (!dt) return d;
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// Mesmo estilo de contagem regressiva de `Busca.jsx` — reescrito aqui em vez de
// importado porque o de lá carrega premissas de modalidade de imóvel que não existem
// em veículo (venda_direta/venda_online).
function contagemLeilao(d) {
  if (!d) return null;
  const dt = parseDataLocal(d);
  if (!dt) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const dias = Math.round((alvo - hoje) / 86400000);
  if (dias < 0) return null;
  const data = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const texto = dias === 0 ? `Encerra hoje · ${data}` : dias === 1 ? `Encerra amanhã · ${data}` : `Encerra em ${dias} dias · ${data}`;
  const cor = dias <= 3 ? { bg: '#fee2e2', fg: '#b91c1c' } : dias <= 10 ? { bg: '#fef3c7', fg: '#92400e' } : { bg: '#eff6ff', fg: '#084BA6' };
  return { dias, texto, ...cor };
}

// Desconto = quanto o lance mínimo está abaixo da avaliação do PRÓPRIO leiloeiro. Sem
// avaliação (comum quando a API não a traz), não há desconto para mostrar — melhor
// omitir do que inventar um número. Trava contra outlier (avaliação absurdamente baixa
// ou lance acima da avaliação) na mesma linha do que já existe para imóveis.
function desconto(v) {
  // Prefere a coluna gravada pelo scraper (11/09) — mesmo cálculo, só evita reprocessar em
  // todo render. Recalcula só para linha antiga que ainda não passou pela migração/backfill.
  if (v.desconto_percentual != null) return v.desconto_percentual;
  const min = Number(v.valor_minimo) || 0;
  const aval = Number(v.valor_avaliacao) || 0;
  if (!min || !aval || min >= aval) return null;
  const pct = Math.round((1 - min / aval) * 100);
  if (pct <= 0 || pct > 95) return null;
  return pct;
}

// Cores por severidade — "monta" é a classificação padrão do mercado segurador
// (pequena/média/grande monta, perda total). Vem DIRETO do leiloeiro (lot_sinister), não é
// inferência nossa.
const SINISTRO_COR = {
  'pequena monta': { bg: '#fef3c7', fg: '#92400e' },
  'média monta': { bg: '#fed7aa', fg: '#9a3412' },
  'grande monta': { bg: '#fecaca', fg: '#991b1b' },
  'perda total': { bg: '#fecaca', fg: '#991b1b' },
};
const corSinistro = (s) => SINISTRO_COR[String(s || '').toLowerCase()] || { bg: '#f1f5f9', fg: '#475569' };

function fotosArray(v) {
  const f = v?.fotos;
  if (Array.isArray(f)) return f.filter(Boolean);
  return [];
}

// Mesmo componente de `Busca.jsx`: só carrega a imagem quando entra na viewport, e
// avança para o próximo candidato se o primeiro link quebrar (hotlink do leiloeiro cai
// com frequência).
function LazyImage({ src, alt, style }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const cands = Array.isArray(src) ? src.filter(Boolean) : (src ? [src] : []);
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [Array.isArray(src) ? src.join('|') : src]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: '100px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const atual = cands[idx] || null;
  return (
    <div ref={ref} style={{ ...style, background: '#f1f5f9', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {visible && atual
        ? <img src={atual} alt={alt} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={() => setIdx(i => i + 1)} />
        : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#cbd5e1', width: '100%', height: '100%' }}>
            <Car size={28} strokeWidth={1.5} />
            <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600 }}>Sem foto</span>
          </div>
      }
    </div>
  );
}

const inp = { width: '100%', padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: 'white', color: '#111111', boxSizing: 'border-box' };
const lbl = { fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 };

function filtrosVazios() {
  return {
    estado: '', cidade: '', marca: '', modelo: '', anoMin: '', anoMax: '', valorMax: '',
    valorAvaliacaoMax: '', descontoMin: '', tipoMonta: '', ordenacao: 'atualizado_desc',
  };
}

export default function BuscaVeiculos() {
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const [filtros, setFiltros] = useState(filtrosVazios);
  const [mostrarFiltros, setMostrarFiltros] = useState(!isMobile);
  const [resultados, setResultados] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  async function buscar(p, f) {
    setLoading(true); setErro('');
    try {
      let q = supabase.from('veiculos_leilao').select(COLUNAS, { count: 'estimated' })
        .eq('ativo', true)
        // Rede de segurança pública (11/09, pedido do dono): só bens já CONFIRMADOS em
        // pátio — nunca em posse do executado. `indefinido` é o default conservador de
        // `classificarPatio()` e não deve aparecer para o cliente.
        .eq('status_patio', 'confirmado');
      if (f.estado) q = q.eq('estado', f.estado);
      if (f.cidade.trim()) q = q.ilike('cidade', `%${f.cidade.trim()}%`);
      if (f.marca.trim()) q = q.ilike('marca', `%${f.marca.trim()}%`);
      // Nome/modelo: OR com o título — SUPORTE ainda não separa marca/modelo (~117 de 237
      // linhas sem `modelo`), e o nome do carro vem só dentro do título nesses casos. Buscar
      // só em `modelo` esconderia esse leiloeiro inteiro do filtro.
      if (f.modelo.trim()) { const t = f.modelo.trim(); q = q.or(`modelo.ilike.%${t}%,titulo.ilike.%${t}%`); }
      if (f.anoMin) q = q.gte('ano_fabricacao', Number(f.anoMin));
      if (f.anoMax) q = q.lte('ano_fabricacao', Number(f.anoMax));
      if (f.valorMax) q = q.lte('valor_minimo', Number(f.valorMax));
      if (f.valorAvaliacaoMax) q = q.lte('valor_avaliacao', Number(f.valorAvaliacaoMax));
      if (f.descontoMin) q = q.gte('desconto_percentual', Number(f.descontoMin));
      if (f.tipoMonta) q = q.eq('sinistro', f.tipoMonta);
      const [coluna, dir] = f.ordenacao === 'valor_asc' ? ['valor_minimo', true]
        : f.ordenacao === 'valor_desc' ? ['valor_minimo', false]
        : f.ordenacao === 'ano_desc' ? ['ano_fabricacao', false]
        : f.ordenacao === 'desconto_desc' ? ['desconto_percentual', false]
        : ['atualizado_em', false];
      q = q.order(coluna, { ascending: dir, nullsFirst: false });
      const de = (p - 1) * POR_PAGINA;
      const { data, error, count } = await q.range(de, de + POR_PAGINA - 1);
      if (error) { setErro('Não foi possível carregar os veículos agora. Tente de novo em instantes.'); setResultados([]); setTotal(0); return; }
      setResultados(data || []); setTotal(count || 0);
    } catch {
      setErro('Não foi possível carregar os veículos agora. Tente de novo em instantes.');
    } finally { setLoading(false); }
  }

  useEffect(() => { buscar(1, filtros); setPagina(1); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const aplicarFiltros = () => { setPagina(1); buscar(1, filtros); if (isMobile) setMostrarFiltros(false); };
  const limparFiltros = () => { const f = filtrosVazios(); setFiltros(f); setPagina(1); buscar(1, f); };
  const irPara = (p) => { setPagina(p); buscar(p, filtros); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '12px' : '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Car size={22} color="#0D63DB" />
            <h1 style={{ fontSize: 20, fontWeight: 900, color: '#111111', margin: 0 }}>Leilão de Veículos</h1>
            <span style={{ fontSize: 10, fontWeight: 800, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 8 }}>PILOTO</span>
          </div>
          <p style={{ fontSize: 12.5, color: '#64748b', margin: '4px 0 0' }}>
            Só veículos já recolhidos ao pátio do leiloeiro — nunca em posse do executado. Fonte(s) de acesso gratuito, em expansão.
          </p>
        </div>
        <button onClick={() => setMostrarFiltros(v => !v)}
          style={{ display: isMobile ? 'flex' : 'none', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
          <Filter size={14} /> Filtros
        </button>
      </div>

      {mostrarFiltros && (
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 14, display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={lbl}>Estado</label>
            <select style={inp} value={filtros.estado} onChange={e => setFiltros(f => ({ ...f, estado: e.target.value }))}>
              <option value="">Todos</option>
              {ESTADOS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Cidade</label>
            <input style={inp} placeholder="Ex.: Campinas" value={filtros.cidade} onChange={e => setFiltros(f => ({ ...f, cidade: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Marca</label>
            <input style={inp} placeholder="Ex.: Fiat" value={filtros.marca} onChange={e => setFiltros(f => ({ ...f, marca: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Modelo</label>
            <input style={inp} placeholder="Ex.: Uno" value={filtros.modelo} onChange={e => setFiltros(f => ({ ...f, modelo: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Ano de</label>
            <input style={inp} type="number" placeholder="2010" value={filtros.anoMin} onChange={e => setFiltros(f => ({ ...f, anoMin: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Ano até</label>
            <input style={inp} type="number" placeholder="2024" value={filtros.anoMax} onChange={e => setFiltros(f => ({ ...f, anoMax: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Lance máx. (R$)</label>
            <input style={inp} type="number" placeholder="50000" value={filtros.valorMax} onChange={e => setFiltros(f => ({ ...f, valorMax: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Avaliação máx. (R$)</label>
            <input style={inp} type="number" placeholder="80000" value={filtros.valorAvaliacaoMax} onChange={e => setFiltros(f => ({ ...f, valorAvaliacaoMax: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Desconto mín.</label>
            <select style={inp} value={filtros.descontoMin} onChange={e => setFiltros(f => ({ ...f, descontoMin: e.target.value }))}>
              <option value="">Qualquer</option>
              <option value="20">20% ou mais</option>
              <option value="40">40% ou mais</option>
              <option value="60">60% ou mais</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Tipo de monta</label>
            <select style={inp} value={filtros.tipoMonta} onChange={e => setFiltros(f => ({ ...f, tipoMonta: e.target.value }))}>
              <option value="">Qualquer</option>
              {TIPOS_MONTA.map(t => <option key={t} value={t} style={{ textTransform: 'capitalize' }}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Ordenar por</label>
            <select style={inp} value={filtros.ordenacao} onChange={e => setFiltros(f => ({ ...f, ordenacao: e.target.value }))}>
              <option value="atualizado_desc">Mais recentes</option>
              <option value="valor_asc">Menor lance</option>
              <option value="valor_desc">Maior lance</option>
              <option value="ano_desc">Ano (mais novo)</option>
              <option value="desconto_desc">Maior desconto</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, gridColumn: isMobile ? '1 / -1' : 'auto' }}>
            <button onClick={aplicarFiltros} style={{ flex: 1, padding: '9px 14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Buscar</button>
            <button onClick={limparFiltros} title="Limpar filtros" style={{ padding: '9px 10px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', color: '#64748b' }}><X size={14} /></button>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '60px 0', color: '#64748b' }}>
          <Loader2 size={18} className="animate-spin" /> Carregando veículos…
        </div>
      )}

      {!loading && erro && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 14px', color: '#b91c1c', fontSize: 13 }}>{erro}</div>
      )}

      {!loading && !erro && resultados.length === 0 && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: '50px 20px', textAlign: 'center', color: '#64748b' }}>
          <Car size={32} color="#cbd5e1" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 700, color: '#111111', marginBottom: 4 }}>Nenhum veículo encontrado</div>
          <div style={{ fontSize: 12.5 }}>Ajuste os filtros ou volte mais tarde — o piloto ainda está em expansão para novas fontes.</div>
        </div>
      )}

      {!loading && !erro && resultados.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap: 12 }}>
          {resultados.map(v => {
            const desc = desconto(v);
            const fotos = fotosArray(v);
            const cont = contagemLeilao(v.data_leilao);
            const anoLabel = [v.ano_fabricacao, v.ano_modelo].filter(Boolean).join('/');
            return (
              <div key={v.id}
                style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: v.link_lote ? 'pointer' : 'default', transition: 'box-shadow 0.15s' }}
                onClick={e => { if (e.target.closest('a,button')) return; if (v.link_lote) window.open(v.link_lote, '_blank', 'noopener'); }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
                <div style={{ width: '100%', height: isMobile ? 180 : 150, position: 'relative' }}>
                  <LazyImage src={fotos} alt={v.titulo} style={{ width: '100%', height: '100%' }} />
                  {desc != null && (
                    <div style={{ position: 'absolute', top: 8, right: 8, background: desc >= 40 ? '#16a34a' : desc >= 20 ? '#d97706' : '#dc2626', color: 'white', fontWeight: 900, fontSize: 13, padding: '3px 8px', borderRadius: 8 }}>
                      -{desc}%
                    </div>
                  )}
                  {v.leiloeiro && (
                    <div title={`Leiloeiro: ${v.leiloeiro}`} style={{ position: 'absolute', bottom: 8, left: 8, maxWidth: 'calc(100% - 16px)', background: 'rgba(15,23,42,0.82)', color: 'white', fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      🔨 {v.leiloeiro}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ fontWeight: 700, color: '#111111', fontSize: isMobile ? 14 : 12, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {[v.marca, v.modelo].filter(Boolean).join(' ') || v.titulo || 'Veículo'}
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {anoLabel && <span>{anoLabel}</span>}
                    {v.km != null && <span>· {Number(v.km).toLocaleString('pt-BR')} km</span>}
                    {v.placa && <span>· {v.placa}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    <MapPin size={9} style={{ flexShrink: 0 }} />{[v.cidade, v.estado].filter(Boolean).join(', ') || '—'}
                  </div>
                  {/* Sinal do próprio leiloeiro (11/09) — sinistro, sucata, financiamento e
                      alerta de motor. Nunca inventado: o que ele não informa fica de fora. */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    {v.sinistro && (() => { const c = corSinistro(v.sinistro); return (
                      <span title="Classificação do sinistro, informada pelo leiloeiro" style={{ fontSize: 9, fontWeight: 700, background: c.bg, color: c.fg, padding: '1px 6px', borderRadius: 8, textTransform: 'capitalize' }}>{v.sinistro}</span>
                    ); })()}
                    {v.is_sucata && (
                      <span title="Vendido sem ATPV-E — só certificado de baixa; a transferência não é a padrão" style={{ fontSize: 9, fontWeight: 800, background: '#fecaca', color: '#991b1b', padding: '1px 6px', borderRadius: 8 }}>⚠️ Sucata</span>
                    )}
                    {v.motor_alerta && (
                      <span title="Menção de dano no motor na descrição do leiloeiro" style={{ fontSize: 9, fontWeight: 800, background: '#fecaca', color: '#991b1b', padding: '1px 6px', borderRadius: 8 }}>⚠️ Motor</span>
                    )}
                    {v.financiavel === false && (
                      <span title="Não financiável — só à vista, conforme o leiloeiro" style={{ fontSize: 9, fontWeight: 700, background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: 8 }}>À vista</span>
                    )}
                    {v.financiavel === true && (
                      <span title="Aceita financiamento, conforme o leiloeiro" style={{ fontSize: 9, fontWeight: 700, background: '#dcfce7', color: '#15803d', padding: '1px 6px', borderRadius: 8 }}>💳 Financiável</span>
                    )}
                    {v.ipva_situacao && (
                      <span style={{ fontSize: 9, color: '#94a3b8' }}>IPVA {v.ipva_situacao.toLowerCase()}</span>
                    )}
                  </div>
                  {(v.cambio || v.combustivel || v.cor) && (
                    <div style={{ fontSize: 9.5, color: '#94a3b8' }}>
                      {[v.cambio, v.combustivel, v.cor].filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1)).join(' · ')}
                    </div>
                  )}
                  {v.descricao && (
                    <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {v.descricao}
                    </div>
                  )}
                  <div style={{ marginTop: 2 }}>
                    <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Lance Mín.</div>
                    <div style={{ fontWeight: 900, color: '#111111', fontSize: isMobile ? 18 : 15 }}>{fmtBRL(v.valor_minimo)}</div>
                    {v.valor_avaliacao > 0 && <div style={{ fontSize: 10, color: '#64748b' }}>Aval. {fmtBRL(v.valor_avaliacao)}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
                    {cont
                      ? <span title="Data do leilão" style={{ fontSize: 9, fontWeight: 800, background: cont.bg, color: cont.fg, padding: '1px 6px', borderRadius: 8 }}>🗓 {cont.texto}</span>
                      : <span style={{ fontSize: 9, color: '#94a3b8' }}>🗓 {fmtDataLeilao(v.data_leilao)}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: '1px solid #f1f5f9', background: '#fafafa' }}>
                  <button onClick={e => { e.stopPropagation(); if (v.link_lote) window.open(v.link_lote, '_blank', 'noopener'); }} disabled={!v.link_lote}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 4px', background: v.link_lote ? '#0D63DB' : '#e2e8f0', color: v.link_lote ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: v.link_lote ? 'pointer' : 'default' }}>
                    Ver no leiloeiro <ExternalLink size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && totalPaginas > 1 && (
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '12px 18px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <button onClick={() => irPara(Math.max(1, pagina - 1))} disabled={pagina === 1}
            style={{ padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: pagina === 1 ? 'not-allowed' : 'pointer', background: pagina === 1 ? '#f8fafc' : 'white', color: pagina === 1 ? '#cbd5e1' : '#334155' }}>
            ← Anterior
          </button>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Página {pagina} de {totalPaginas}</span>
          <button onClick={() => irPara(Math.min(totalPaginas, pagina + 1))} disabled={pagina === totalPaginas}
            style={{ padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: pagina === totalPaginas ? 'not-allowed' : 'pointer', background: pagina === totalPaginas ? '#f8fafc' : 'white', color: pagina === totalPaginas ? '#cbd5e1' : '#334155' }}>
            Próxima →
          </button>
        </div>
      )}

      <button onClick={() => nav('/admin?aba=Scrapers')} style={{ alignSelf: 'center', marginTop: 4, background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
        ← Voltar para o Operacional
      </button>
    </div>
  );
}
