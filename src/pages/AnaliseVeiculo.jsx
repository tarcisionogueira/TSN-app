import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Car, ArrowLeft, Loader2, BarChart2, AlertTriangle, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { fmtBRL } from '../utils/format';
import { apiCall } from '../utils/apiCall';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../utils/useIsMobile';

/**
 * Relatório de análise de VEÍCULO (21/09, pedido do dono). Página separada de `Analise.jsx`
 * de propósito: aquela tem 372KB e orquestra DOIS relatórios de imóvel (mercadológico +
 * documental, com comparáveis, CNJ, geocodificação — nada disso existe para veículo). Misturar
 * os dois fluxos numa página já enorme custaria mais risco do que vale; aqui é UM relatório
 * (api/gerar-analise-veiculo.js), então a página também é simples: dispara, faz polling do
 * status em `analises_veiculo` (mesmo princípio de Analise.jsx — o servidor pode levar mais
 * que o tempo de uma conexão de página aberta, o banco é a fonte da verdade) e renderiza.
 */

const FAIXA_INFO = {
  otima:    { label: 'Ótimo ponto de entrada', cor: '#15803d', bg: '#dcfce7', Icon: CheckCircle2 },
  boa:      { label: 'Boa relação com a FIPE', cor: '#0369a1', bg: '#e0f2fe', Icon: CheckCircle2 },
  atencao:  { label: 'Atenção — perto da FIPE', cor: '#92400e', bg: '#fef3c7', Icon: AlertTriangle },
  alta:     { label: 'Acima da FIPE', cor: '#991b1b', bg: '#fecaca', Icon: XCircle },
  sem_fipe: { label: 'FIPE não disponível', cor: '#64748b', bg: '#f1f5f9', Icon: HelpCircle },
};
const RECOMENDACAO_LABEL = { comprar: 'Comprar', avaliar_com_cautela: 'Avaliar com cautela', evitar: 'Evitar' };

function useQueryParam(name) {
  const loc = useLocation();
  return new URLSearchParams(loc.search).get(name);
}

export default function AnaliseVeiculo() {
  const nav = useNavigate();
  const loc = useLocation();
  const isMobile = useIsMobile();
  const { user, effectiveUserId } = useAuth();
  const veiculoId = useQueryParam('veiculo');
  const uid = effectiveUserId || user?.id;

  const [v, setV] = useState(loc.state?.veiculo || null);
  const [carregandoVeiculo, setCarregandoVeiculo] = useState(true);
  const [analise, setAnalise] = useState(null); // linha de analises_veiculo, ou null (nunca gerado)
  const [carregandoAnalise, setCarregandoAnalise] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  const pollRef = useRef(null);

  // Veículo SEMPRE do banco, nunca só do state de navegação — foi exatamente um snapshot
  // incompleto persistido que causou o "lance mínimo ausente" no relatório de imóvel (20/09).
  useEffect(() => {
    if (!veiculoId) return;
    let vivo = true;
    (async () => {
      const { data, error } = await supabase.from('veiculos_leilao').select('*').eq('id', veiculoId).single();
      if (!vivo) return;
      if (error) { setErro('Não foi possível carregar este veículo agora. Tente novamente.'); setCarregandoVeiculo(false); return; }
      setV(data || null); setCarregandoVeiculo(false);
    })();
    return () => { vivo = false; };
  }, [veiculoId]);

  const carregarAnalise = async () => {
    if (!veiculoId || !uid) return null;
    const { data, error } = await supabase.from('analises_veiculo').select('*').eq('user_id', uid).eq('veiculo_id', veiculoId).maybeSingle();
    if (error) { setErro('Não foi possível carregar o relatório agora. Tente novamente.'); return null; }
    setAnalise(data || null);
    return data || null;
  };

  useEffect(() => {
    if (!uid || !veiculoId) return;
    let vivo = true;
    (async () => {
      const a = await carregarAnalise();
      if (!vivo) return;
      setCarregandoAnalise(false);
      if (a?.status === 'gerando') iniciarPolling();
    })();
    return () => { vivo = false; clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, veiculoId]);

  function iniciarPolling() {
    clearInterval(pollRef.current);
    let tentativas = 0;
    pollRef.current = setInterval(async () => {
      tentativas += 1;
      const a = await carregarAnalise();
      if (a?.status && a.status !== 'gerando') { clearInterval(pollRef.current); setGerando(false); }
      if (tentativas > 45) { clearInterval(pollRef.current); setGerando(false); } // ~2,5min — cobre o maxDuration:120s do endpoint com folga
    }, 3500);
  }

  const gerar = async () => {
    setErro(''); setGerando(true);
    try {
      const r = await apiCall('/api/gerar-analise-veiculo', { method: 'POST', body: JSON.stringify({ veiculoId }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setGerando(false);
        setErro(d?.error || 'Não foi possível gerar o relatório agora.');
        return;
      }
    } catch {
      // Dispare-e-esqueça: a geração roda no servidor mesmo que esta chamada falhe ao
      // retornar (conexão instável) — o polling abaixo é quem decide o estado real.
    }
    await carregarAnalise();
    iniciarPolling();
  };

  if (carregandoVeiculo || carregandoAnalise) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', color: '#64748b' }}><Loader2 className="animate-spin" size={22} /></div>;
  }
  if (!v) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
        <p>Veículo não encontrado.</p>
        <button onClick={() => nav('/admin/veiculos-leilao')} style={{ marginTop: 8, background: 'none', border: 'none', color: '#0D63DB', cursor: 'pointer', fontWeight: 700 }}>← Voltar à busca</button>
      </div>
    );
  }

  const titulo = [v.marca, v.modelo].filter(Boolean).join(' ') || v.titulo || 'Veículo';
  const result = analise?.status === 'concluida' ? analise.result : null;
  const emGeracao = gerando || analise?.status === 'gerando';
  const faixa = result?.faixaFipe ? FAIXA_INFO[result.faixaFipe] || FAIXA_INFO.sem_fipe : null;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: isMobile ? 12 : 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={() => nav(`/admin/veiculos-leilao/${v.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 700, alignSelf: 'flex-start' }}>
        <ArrowLeft size={16} /> Voltar ao veículo
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Car size={22} color="#0D63DB" />
        <div>
          <h1 style={{ fontSize: isMobile ? 18 : 20, fontWeight: 900, color: '#111111', margin: 0 }}>{titulo}</h1>
          <div style={{ fontSize: 12.5, color: '#64748b' }}>Relatório de análise do veículo</div>
        </div>
      </div>

      {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 14px', color: '#b91c1c', fontSize: 13 }}>{erro}</div>}

      {!result && !emGeracao && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 24, textAlign: 'center' }}>
          <p style={{ color: '#64748b', fontSize: 13.5, marginBottom: 16 }}>
            Gera um relatório único com a condição do veículo (com base no que o leiloeiro disponibilizou — edital, descrição e anexos do lote) e a FIPE atualizada, com veredito de compra.
          </p>
          <button onClick={gerar} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 22px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            <BarChart2 size={15} /> Gerar relatório
          </button>
        </div>
      )}

      {emGeracao && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 24, textAlign: 'center', color: '#64748b' }}>
          <Loader2 className="animate-spin" size={22} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13.5 }}>Gerando relatório… pode levar até 2 minutos. Você pode sair desta tela — o relatório fica salvo quando terminar.</div>
        </div>
      )}

      {analise?.status === 'erro' && !emGeracao && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 16, color: '#b91c1c', fontSize: 13 }}>
          Não foi possível gerar o relatório da última vez. <button onClick={gerar} style={{ background: 'none', border: 'none', color: '#b91c1c', textDecoration: 'underline', cursor: 'pointer', fontWeight: 700, padding: 0 }}>Tentar de novo</button>
        </div>
      )}

      {result && (
        <>
          {/* FIPE × lance mínimo — o número que a régua "65% da FIPE" decide. */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>Lance mínimo</div>
                <div style={{ fontWeight: 900, color: '#111111', fontSize: 20 }}>{fmtBRL(result.valorMinimo)}</div>
              </div>
              {result.fipeValor > 0 && (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>FIPE ({result.fipeMesReferencia || 'ref.'})</div>
                  <div style={{ fontWeight: 900, color: '#0369a1', fontSize: 20 }}>{fmtBRL(result.fipeValor)}</div>
                </div>
              )}
              {faixa && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: faixa.bg, color: faixa.cor, padding: '8px 14px', borderRadius: 10, fontWeight: 800, fontSize: 13 }}>
                  <faixa.Icon size={16} />
                  {result.percentualFipe != null ? `${result.percentualFipe.toFixed(0)}% da FIPE` : faixa.label}
                </div>
              )}
            </div>
            {result.percentualFipe != null && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: '#94a3b8' }}>{faixa.label} — regra da casa: até 65% da FIPE é considerado ótimo ponto de entrada.</div>
            )}
          </div>

          {result.recomendacao && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: '#111111' }}>
              Veredito: <span style={{ color: result.recomendacao === 'comprar' ? '#15803d' : result.recomendacao === 'evitar' ? '#b91c1c' : '#92400e' }}>{RECOMENDACAO_LABEL[result.recomendacao]}</span>
            </div>
          )}

          {result.semDocumentos && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#92400e' }}>
              O leiloeiro não disponibilizou descrição nem documentos para este lote — o parecer abaixo é limitado ao que consta no anúncio.
            </div>
          )}

          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Parecer</div>
            <div style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{result.parecer}</div>
          </div>

          {result.riscos?.length > 0 && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Riscos identificados</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.riscos.map((r, i) => <li key={i} style={{ fontSize: 13, color: '#334155' }}>{r}</li>)}
              </ul>
            </div>
          )}

          <button onClick={gerar} disabled={emGeracao} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#0D63DB', fontSize: 12.5, fontWeight: 700, cursor: emGeracao ? 'default' : 'pointer', padding: 0 }}>
            Gerar novamente
          </button>
        </>
      )}
    </div>
  );
}
