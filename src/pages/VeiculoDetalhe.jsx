import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Car, ArrowLeft, ExternalLink, MapPin, Loader2, BarChart2 } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { fmtBRL } from '../utils/format';
import { useIsMobile } from '../utils/useIsMobile';
import { apiCall } from '../utils/apiCall';
import { useAuth } from '../contexts/AuthContext';
import { lerCotaVeiculo } from '../utils/cotaAnalise';
import EnviarEmailCasoLote from '../components/EnviarEmailCasoLote';

// Tela EXCLUSIVA do operacional (dono/equipe) — nunca do cliente (reafirmado 21/09; a rota
// em App.jsx já só existe sob /admin/veiculos-leilao*, roles=['admin','analista']). Por isso
// "Solicitar análise" e "Enviar e-mail" abaixo não precisam tratar cliente/visitante: quem
// chega aqui já passou pelo gate da rota.
const ROLES_STAFF = ['admin', 'analista', 'advogado', 'consultor'];

// Resultado real do leilão (21/09) — mesmo mapa de BuscaVeiculos.jsx (RESULTADO_BADGE) e de
// ImovelDetalhe.jsx. 'indeterminado' com nome honesto: a busca já o trata junto de "sem
// lance", mas aqui, no lote específico, nunca finge uma confirmação que ainda não existe.
// Só DUAS saídas para o cliente (dono, 24/09): "Com lance" ou "Sem lance". 'indeterminado' continua
// no banco (a reapuração usa), mas não aparece: sem sinal de lance, é tratado como sem lance.
const RESULTADO_LEILAO_BADGE = {
  vendido: { texto: 'Com lance', bg: '#dcfce7', fg: '#15803d' },
  sem_lance: { texto: 'Sem lance', bg: '#f3e8ff', fg: '#6d28d9' },
};
// 24/09 (tarde, Montana SUPERBID do dono): 'indeterminado' NÃO é sem lance — na SUPERBID quase
// sempre é lance abaixo da reserva (condicional). Sem confirmação não há selo nem filtro: fica
// como "ainda não apurado" até a apuração decidir. Continuam só duas saídas visíveis.

// Mesmo léxico/cores de BuscaVeiculos.jsx (sinal do PRÓPRIO leiloeiro — nunca inventado).
const MODALIDADE_LABEL = { judicial: 'Judicial', extrajudicial: 'Extrajudicial', nao_identificado: 'Não identificado' };
const SINISTRO_COR = {
  pequeno: { bg: '#fef3c7', fg: '#92400e' }, médio: { bg: '#fed7aa', fg: '#9a3412' },
  medio: { bg: '#fed7aa', fg: '#9a3412' }, grande: { bg: '#fecaca', fg: '#991b1b' },
  irrecuperável: { bg: '#fecaca', fg: '#7f1d1d' }, irrecuperavel: { bg: '#fecaca', fg: '#7f1d1d' },
};
const corSinistro = (s) => SINISTRO_COR[String(s || '').toLowerCase()] || { bg: '#f1f5f9', fg: '#475569' };

function fotosArray(v) {
  if (Array.isArray(v?.fotos) && v.fotos.length) return v.fotos.filter(Boolean);
  return [];
}

function fmtDataLeilao(d) {
  if (!d) return 'Data não informada';
  try { return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return 'Data não informada'; }
}

const COLUNAS = [
  'id', 'titulo', 'descricao', 'marca', 'modelo', 'ano_fabricacao', 'ano_modelo', 'placa', 'chassi', 'renavam', 'km',
  'valor_minimo', 'valor_avaliacao', 'desconto_percentual', 'modalidade', 'cidade', 'estado',
  'link_lote', 'fotos', 'data_leilao', 'leiloeiro', 'sinistro', 'is_sucata', 'financiavel',
  'combustivel', 'cambio', 'cor', 'motor_alerta', 'ipva_situacao', 'tipo_veiculo',
  'valor_fipe', 'fipe_codigo', 'fipe_mes_referencia', 'fipe_status', 'fipe_atualizado_em',
  // faltavam até 24/09: sem elas o selo de resultado e a reapuração ao abrir nunca rodavam aqui
  'resultado_leilao', 'valor_lance_vencedor', 'teve_lance',
].join(',');

// FIPE 'aproximado'/'sem_match'/'sem_dados' explicados na tela — nunca um número sem contexto
// (a régua de casamento é heurística; ver api/_fipe.js).
const FIPE_EXPLICACAO = {
  aproximado: 'Mais de uma versão do modelo bateu com o ano informado — valor aproximado, pode variar por versão/motorização.',
  sem_match: 'Não foi possível casar marca/modelo com a tabela FIPE automaticamente.',
  sem_dados: 'Faltam marca, modelo ou ano cadastrados para consultar a FIPE.',
  erro: 'A consulta à FIPE falhou — tente novamente mais tarde.',
};

export default function VeiculoDetalhe() {
  const nav = useNavigate();
  // Voltar = voltar no HISTÓRICO (24/09): empurrar a rota da busca remontava a lista do zero
  // (filtros e posição perdidos). Sem histórico (link aberto direto), cai na busca.
  const voltarABusca = () => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav('/admin/veiculos-leilao'));
  const { id } = useParams();
  const isMobile = useIsMobile();
  const { user, role, effectiveUserId } = useAuth();
  const [v, setV] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [fotoAtiva, setFotoAtiva] = useState(0);
  const [buscandoFipe, setBuscandoFipe] = useState(false);
  const [cotaEsgotada, setCotaEsgotada] = useState(false);
  const [cota, setCota] = useState(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCarregando(true); setErro(null);
      const { data, error } = await supabase.from('veiculos_leilao').select(COLUNAS).eq('id', id).single();
      if (cancelado) return;
      if (error || !data) { setErro('Veículo não encontrado.'); setCarregando(false); return; }
      setV(data);
      setCarregando(false);
    })();
    return () => { cancelado = true; };
  }, [id]);

  // Ao abrir a tela: se a FIPE ainda não tem valor fresco, busca on-demand (pedido do dono —
  // "ao abrir o veículo trazer a FIPE dele"). A trava de cota diária vive no servidor
  // (api/veiculo-fipe.js + registrar_uso_fipe) — aqui só reage ao resultado.
  useEffect(() => {
    if (!v?.id) return;
    const precisaBuscar = !v.fipe_atualizado_em || (v.fipe_status !== 'ok' && v.fipe_status !== 'aproximado' && v.fipe_status !== 'sem_dados');
    if (!precisaBuscar) return;
    let cancelado = false;
    (async () => {
      setBuscandoFipe(true);
      try {
        const r = await apiCall(`/api/veiculo-fipe?id=${encodeURIComponent(v.id)}`);
        const dados = await r.json();
        if (cancelado) return;
        if (r.ok) {
          setV(prev => prev && ({ ...prev, valor_fipe: dados.valor_fipe, fipe_codigo: dados.fipe_codigo, fipe_mes_referencia: dados.fipe_mes_referencia, fipe_status: dados.fipe_status }));
          setCotaEsgotada(!!dados.cota_esgotada);
        }
      } catch { /* padrao-ok: busca best-effort — a tela funciona normalmente sem FIPE */ }
      if (!cancelado) setBuscandoFipe(false);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.id]);

  // On-demand: RESULTADO DO LEILÃO indeterminado → reconfere contra a página do leiloeiro ao
  // abrir a tela (pedido do dono, 21/09: "rode novamente para o leiloeiro e atualize o status
  // caso esteja divergente"). Mesmo endpoint/gate de ImovelDetalhe.jsx (cooldown/teto de
  // tentativas no servidor); só dispara quando já está 'indeterminado' e o leilão já encerrou.
  useEffect(() => {
    if (!v?.id || v.resultado_leilao !== 'indeterminado') return;
    if (!v.data_leilao || new Date(v.data_leilao).getTime() >= Date.now()) return;
    let cancelado = false;
    apiCall('/api/reapurar-resultado-leilao', { method: 'POST', body: JSON.stringify({ veiculoId: v.id }) })
      .then(r => r.json()).then(d => {
        if (cancelado || !d?.atualizado) return;
        setV(prev => prev && ({ ...prev, resultado_leilao: d.resultado_leilao, valor_lance_vencedor: d.valor_lance_vencedor }));
      }).catch(() => {}); // padrao-ok: reconferência best-effort — falha não pode travar a tela do veículo
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.id, v?.resultado_leilao]);

  // Cota de análise de veículo, mesmo padrão de ImovelDetalhe.jsx (lerCotaMercado): nunca
  // lança — falha de rede não pode virar "você não tem análise".
  useEffect(() => {
    const uid = effectiveUserId || user?.id;
    if (!uid) { setCota(null); return; }
    let vivo = true;
    lerCotaVeiculo(supabase, uid).then((c) => { if (vivo) setCota(c); });
    return () => { vivo = false; };
  }, [user, effectiveUserId]);

  if (carregando) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: '#64748b' }}><Loader2 className="animate-spin" size={22} /></div>;
  }
  if (erro || !v) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
        <p>{erro || 'Veículo não encontrado.'}</p>
        <button onClick={voltarABusca} style={{ marginTop: 8, background: 'none', border: 'none', color: '#0D63DB', cursor: 'pointer', fontWeight: 700 }}>← Voltar à busca</button>
      </div>
    );
  }

  const fotos = fotosArray(v);
  const anoLabel = [v.ano_fabricacao, v.ano_modelo].filter(Boolean).join('/');
  const mostrarFipe = v.valor_fipe > 0 && (v.fipe_status === 'ok' || v.fipe_status === 'aproximado');
  const leilaoEncerrado = v.data_leilao && new Date(v.data_leilao).getTime() < Date.now();
  const rotuloAnalise = (() => {
    if (!cota || cota.ilimitado) return 'Solicitar Análise';
    if (cota.restantes <= 0) return cota.amostra ? 'Análises grátis esgotadas' : 'Cota do mês esgotada';
    return cota.amostra ? 'Analisar grátis' : 'Analisar veículo';
  })();
  const saldoAnalise = (!cota || cota.ilimitado || cota.restantes <= 0)
    ? null
    : `${cota.restantes} de ${cota.limite} ${cota.restantes === 1 ? 'relatório disponível' : 'relatórios disponíveis'}${cota.amostra ? ' (amostra grátis)' : ' este mês'}`;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: isMobile ? 12 : 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={voltarABusca} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 700, alignSelf: 'flex-start' }}>
        <ArrowLeft size={16} /> Voltar à busca
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.1fr 0.9fr', gap: 20 }}>
        {/* Galeria */}
        <div>
          <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: 14, overflow: 'hidden', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {fotos.length
              ? <img src={fotos[fotoAtiva]} alt={v.titulo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <Car size={48} color="#cbd5e1" />}
          </div>
          {fotos.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto' }}>
              {fotos.map((f, i) => (
                <button key={i} onClick={() => setFotoAtiva(i)}
                  style={{ flexShrink: 0, width: 56, height: 56, borderRadius: 8, overflow: 'hidden', border: i === fotoAtiva ? '2px solid #0D63DB' : '1px solid #e2e8f0', padding: 0, cursor: 'pointer', background: 'none' }}>
                  <img src={f} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Informações principais */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 style={{ fontSize: isMobile ? 20 : 22, fontWeight: 900, color: '#111111', margin: 0 }}>
            {[v.marca, v.modelo].filter(Boolean).join(' ') || v.titulo || 'Veículo'}
          </h1>
          <div style={{ fontSize: 13, color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {anoLabel && <span>{anoLabel}</span>}
            {v.km != null && <span>· {Number(v.km).toLocaleString('pt-BR')} km</span>}
            {v.placa && <span>· Placa {v.placa}</span>}
            {v.chassi && <span>· Chassi {v.chassi}</span>}
            {v.renavam && <span>· RENAVAM {v.renavam}</span>}
          </div>
          <div style={{ fontSize: 12.5, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={13} />{[v.cidade, v.estado].filter(Boolean).join(', ') || '—'}
            {v.leiloeiro && <span> · Leiloeiro: {v.leiloeiro}</span>}
          </div>

          {/* Resultado real do leilão (21/09) — só depois de encerrado e já apurado; ausência
              aqui é "ainda não sei", nunca "não vendeu". */}
          {v.resultado_leilao && leilaoEncerrado && RESULTADO_LEILAO_BADGE[v.teve_lance && v.resultado_leilao ? 'vendido' : v.resultado_leilao] && (() => {
            const rb = RESULTADO_LEILAO_BADGE[v.teve_lance && v.resultado_leilao ? 'vendido' : v.resultado_leilao];
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: rb.bg, color: rb.fg, padding: '8px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700 }}>
                {rb.texto}{v.valor_lance_vencedor > 0 ? ` — ${fmtBRL(v.valor_lance_vencedor)}` : ''}
              </div>
            );
          })()}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {v.modalidade && v.modalidade !== 'nao_identificado' && (
              <span style={{ fontSize: 11, fontWeight: 700, background: v.modalidade === 'judicial' ? '#ede9fe' : '#e0f2fe', color: v.modalidade === 'judicial' ? '#6d28d9' : '#075985', padding: '3px 9px', borderRadius: 8 }}>{MODALIDADE_LABEL[v.modalidade]}</span>
            )}
            {v.sinistro && (() => { const c = corSinistro(v.sinistro); return (
              <span style={{ fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg, padding: '3px 9px', borderRadius: 8, textTransform: 'capitalize' }}>{v.sinistro}</span>
            ); })()}
            {v.is_sucata && <span title="Só certificado de baixa — sem ATPV-E" style={{ fontSize: 11, fontWeight: 800, background: '#fecaca', color: '#991b1b', padding: '3px 9px', borderRadius: 8 }}>⚠️ Sucata</span>}
            {v.motor_alerta && <span title="Menção de dano no motor na descrição do leiloeiro" style={{ fontSize: 11, fontWeight: 800, background: '#fecaca', color: '#991b1b', padding: '3px 9px', borderRadius: 8 }}>⚠️ Motor</span>}
            {v.financiavel === false && <span style={{ fontSize: 11, fontWeight: 700, background: '#f1f5f9', color: '#475569', padding: '3px 9px', borderRadius: 8 }}>À vista</span>}
            {v.financiavel === true && <span style={{ fontSize: 11, fontWeight: 700, background: '#dcfce7', color: '#15803d', padding: '3px 9px', borderRadius: 8 }}>💳 Financiável</span>}
            {v.ipva_situacao && <span style={{ fontSize: 11, color: '#94a3b8' }}>IPVA {v.ipva_situacao.toLowerCase()}</span>}
          </div>

          {(v.cambio || v.combustivel || v.cor) && (
            <div style={{ fontSize: 12.5, color: '#64748b' }}>
              {[v.cambio, v.combustivel, v.cor].filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1)).join(' · ')}
            </div>
          )}

          {/* Valores */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginTop: 4 }}>
            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>Lance Mínimo</div>
            <div style={{ fontWeight: 900, color: '#111111', fontSize: 24 }}>{fmtBRL(v.valor_minimo)}</div>
            {v.valor_avaliacao > 0 && <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>Avaliação do leiloeiro: {fmtBRL(v.valor_avaliacao)}</div>}

            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e2e8f0' }}>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>Valor FIPE de referência</div>
              {buscandoFipe ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13, marginTop: 4 }}>
                  <Loader2 size={14} className="animate-spin" /> Consultando FIPE…
                </div>
              ) : mostrarFipe ? (
                <>
                  <div style={{ fontWeight: 900, color: '#0369a1', fontSize: 20 }}>
                    {v.fipe_status === 'aproximado' ? '≈ ' : ''}{fmtBRL(v.valor_fipe)}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    {v.fipe_codigo ? `Código FIPE ${v.fipe_codigo} · ` : ''}{v.fipe_mes_referencia || ''}
                  </div>
                  {v.fipe_status === 'aproximado' && <div style={{ fontSize: 11.5, color: '#92400e', marginTop: 4 }}>{FIPE_EXPLICACAO.aproximado}</div>}
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>
                  {cotaEsgotada
                    ? 'Cota diária da consulta FIPE esgotada — tente novamente mais tarde.'
                    : (FIPE_EXPLICACAO[v.fipe_status] || 'Valor FIPE ainda não disponível para este veículo.')}
                </div>
              )}
            </div>
          </div>

          <div style={{ fontSize: 12.5, color: '#64748b' }}>🗓 {fmtDataLeilao(v.data_leilao)}</div>

          <a href={v.link_lote || undefined} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 16px', background: v.link_lote ? '#0D63DB' : '#e2e8f0', color: v.link_lote ? 'white' : '#94a3b8', borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: 'none', pointerEvents: v.link_lote ? 'auto' : 'none' }}>
            Ver no leiloeiro <ExternalLink size={14} />
          </a>

          {/* Solicitar análise (21/09, pedido do dono: "assim como os imóveis") — condição do
              veículo + FIPE + veredito, num relatório só (ver api/gerar-analise-veiculo.js).
              Sem ramo de cliente/visitante aqui: a rota (App.jsx) já é exclusiva
              admin/analista — quem chegou nesta tela sempre pode gerar. */}
          {leilaoEncerrado ? (
            <div style={{ padding: '13px 14px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, fontSize: 12.5, color: '#9a3412', lineHeight: 1.55 }}>
              <strong>Leilão encerrado.</strong> Como não é mais possível dar lance, o relatório não é gerado para este veículo.
            </div>
          ) : (
            <>
              <button onClick={() => nav(`/analise-veiculo?veiculo=${encodeURIComponent(v.id)}`, { state: { veiculo: v } })}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                <BarChart2 size={15} /> {rotuloAnalise}
              </button>
              {saldoAnalise && (
                <div style={{ marginTop: 7, textAlign: 'center', fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>{saldoAnalise}</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Enviar e-mail — só equipe (jurídico ou o leiloeiro deste lote), mesmo componente de
          ImovelDetalhe.jsx/Caso.jsx. Sem cliente/caso nesta tela (mesmo lote pode interessar a
          vários clientes) — só os anexos do lote. */}
      {ROLES_STAFF.includes(role) && (
        <EnviarEmailCasoLote veiculoId={v.id} cardStyle={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: 16 }} />
      )}

      {v.descricao && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Descrição do leiloeiro</div>
          <div style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{v.descricao}</div>
        </div>
      )}
    </div>
  );
}
