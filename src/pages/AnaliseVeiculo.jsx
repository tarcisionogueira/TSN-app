import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Car, ArrowLeft, Loader2, BarChart2, AlertTriangle, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { fmtBRL } from '../utils/format';
import { apiCall } from '../utils/apiCall';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../utils/useIsMobile';
import { desagioFipe, calcularViabilidade, TETO_FIPE } from '../utils/viabilidadeVeiculo';
import { mdSimplesParaHtml } from '../utils/mdSimples';
import { imprimirHtml } from '../components/pdfImprimir';
import { FileDown } from 'lucide-react';

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

// PDF DO RELATÓRIO (29/09, pedido do dono): identificação completa do lote e da BidPro, cenário
// realista e teto de lance. Mesmo mecanismo dos relatórios de imóvel (components/pdfImprimir.js).
function htmlRelatorioVeiculo({ v, titulo, result, viab, desagio }) {
  const e = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const brl = (x) => fmtBRL(x);
  const dt = (s) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'não informada');
  const linha = (r, val) => `<tr><td class="r">${e(r)}</td><td>${val}</td></tr>`;
  const ano = [v.ano_fabricacao, v.ano_modelo].filter(Boolean).join('/');
  const id = [
    linha('Veículo', e([titulo, ano].filter(Boolean).join(' — '))),
    linha('Descrição do lote', e((v.titulo || '').slice(0, 200))),
    linha('Placa / Chassi / Renavam', e([v.placa, v.chassi, v.renavam].filter(Boolean).join(' · ') || 'não informados')),
    linha('KM', e(v.km != null ? Number(v.km).toLocaleString('pt-BR') : 'não informado')),
    linha('Cor · Combustível · Câmbio', e([v.cor, v.combustivel, v.cambio].filter(Boolean).join(' · ') || 'não informados')),
    linha('Leiloeiro', e(v.leiloeiro || 'não informado')),
    linha('Local (pátio)', e([v.cidade, v.estado].filter(Boolean).join('/') || 'não informado')),
    linha('Data do leilão', e(dt(v.data_leilao))),
    linha('Modalidade', e(v.modalidade || 'não identificada')),
    linha('Página do lote', v.link_lote ? `<a href="${e(v.link_lote)}">${e(v.link_lote)}</a>` : 'não informada'),
    linha('Identificador BidPro', e(v.id)),
  ].join('');
  const fipe = result.fipeValor > 0
    ? `${brl(result.fipeValor)}${v.fipe_codigo ? ` · código ${e(v.fipe_codigo)}` : ''}${result.fipeMesReferencia ? ` · ${e(result.fipeMesReferencia)}` : ''}${result.fipeStatus === 'aproximado' ? ' · valor aproximado (mais de uma versão bateu com o ano)' : ''}`
    : 'não disponível';
  const custos = viab ? [
    linha(`Comissão do leiloeiro (${viab.comissaoPct}%${viab.comissaoPresumida ? ', presumida' : ''})`, ''),
    ...viab.despesas.map((d) => linha(`${d.item} (${d.origem})`, brl(d.valor))),
    `<tr class="t"><td class="r">Despesas assumidas (sem honorários)</td><td>${brl(viab.despesasTotal)}</td></tr>`,
  ].join('') : '';
  const cenario = viab ? `
    <h2>Cenário realista e teto de lance</h2>
    <table>
      ${linha('Lance mínimo', brl(result.valorMinimo))}
      ${linha('Investimento total no lance mínimo (lance + comissão + despesas)', `<b>${brl(viab.investimentoNoMinimo)}</b> (${viab.pctInvestimentoFipe.toFixed(0)}% da FIPE)`)}
      ${linha('Teto de aquisição (65% da FIPE)', brl(viab.tetoAquisicao))}
      ${linha('TETO DE LANCE', `<b style="color:${viab.fechaNaRegra ? '#15803d' : '#b91c1c'}">${brl(viab.tetoLance)}</b>`)}
      ${linha(`Revenda realista (FIPE − ${desagio.pct}%)`, brl(viab.fipeRealista))}
      ${linha('Lucro estimado no lance mínimo', brl(viab.lucroNoMinimo))}
      ${linha('Lucro estimado no teto de lance', brl(viab.lucroNoTeto))}
    </table>
    <p class="n">${viab.fechaNaRegra ? `Lance até ${brl(viab.tetoLance)} mantém arrematação + comissão + despesas em até 65% da FIPE.` : 'O lance mínimo já ultrapassa o teto de 65% da FIPE considerando comissão e despesas.'}</p>
    <h3>Custos considerados</h3><table>${custos}</table>
    <h3>Deságio aplicado à FIPE</h3><ul>${desagio.fatores.map((f) => `<li>${e(f.motivo)}: −${f.pct}%</li>`).join('')}</ul>` : '';
  const riscos = result.riscos?.length ? `<h2>Riscos identificados</h2><ul>${result.riscos.map((r) => `<li>${e(r)}</li>`).join('')}</ul>` : '';
  const rec = result.recomendacao ? `<p class="v">Veredito: <b>${e(RECOMENDACAO_LABEL[result.recomendacao])}</b></p>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório BidPro — ${e(titulo)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; font-size: 11.5px; line-height: 1.45; }
  .topo { display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 3px solid #0D63DB; padding-bottom: 8px; margin-bottom: 14px; }
  .marca { font-size: 20px; font-weight: 900; color: #0D63DB; } .sub { color:#64748b; font-size: 11px; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 13px; color:#0D63DB; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .4px; }
  h3 { font-size: 12px; margin: 12px 0 4px; } h4 { font-size: 12px; margin: 8px 0 4px; }
  table { width:100%; border-collapse: collapse; } td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  td.r { color:#475569; width: 44%; } tr.t td { font-weight: 800; border-top: 2px solid #cbd5e1; }
  .n { font-weight: 700; } .v { font-size: 13px; margin-top: 10px; } ul { margin: 4px 0; padding-left: 18px; } p { margin: 4px 0; }
  .rod { margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 8px; color:#64748b; font-size: 9.5px; }
</style></head><body>
  <div class="topo"><div><div class="marca">BidPro Brasil</div><div class="sub">bidprobrasil.com.br · Relatório de análise de veículo de leilão</div></div>
  <div class="sub">Emitido em ${e(new Date().toLocaleString('pt-BR'))}</div></div>
  <h1>${e(titulo)}${ano ? ` — ${e(ano)}` : ''}</h1>
  <h2>Identificação do lote</h2><table>${id}</table>
  <h2>FIPE × lance</h2><table>
    ${linha('Lance mínimo', brl(result.valorMinimo))}
    ${linha('FIPE de referência', fipe)}
    ${result.percentualFipe != null ? linha('Lance mínimo sobre a FIPE', `${result.percentualFipe.toFixed(0)}%`) : ''}
  </table>
  ${cenario}
  ${rec}
  <h2>Parecer</h2>${mdSimplesParaHtml(result.parecer)}
  ${riscos}
  <div class="rod">Análise gerada com base nas informações e documentos disponibilizados pelo leiloeiro. Custos marcados como "estimado" são médias de mercado para a condição declarada; confirme no edital, na vistoria e junto ao Detran antes de ofertar. O deságio sobre a FIPE é uma régua de mercado da BidPro, não uma avaliação individual. Honorários não estão incluídos no investimento.</div>
</body></html>`;
}

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
  // Cenário realista + teto de lance (29/09, pedido do dono) — regra em utils/viabilidadeVeiculo.js.
  const desagio = desagioFipe(v);
  const viab = result ? calcularViabilidade({ fipe: result.fipeValor, lanceMinimo: result.valorMinimo, comissaoPct: result.comissaoLeiloeiroPct, despesas: result.custos || [], desagioPct: desagio.pct }) : null;
  const semCustosNoRelatorio = result && !Array.isArray(result.custos);
  const baixarPdf = () => imprimirHtml(htmlRelatorioVeiculo({ v, titulo, result, viab, desagio }), `BidPro - Relatório ${titulo} ${[v.ano_fabricacao, v.ano_modelo].filter(Boolean).join('-')}`);
  const emGeracao = gerando || analise?.status === 'gerando';
  const faixa = result?.faixaFipe ? FAIXA_INFO[result.faixaFipe] || FAIXA_INFO.sem_fipe : null;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: isMobile ? 12 : 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* LOOP (29/09, print do dono): "Voltar ao veículo" EMPURRAVA a rota do veículo; lá, "Voltar à
          busca" faz nav(-1) — e voltava para ESTE relatório, ida e volta sem fim. Quem veio da página
          do veículo (que passa `state.veiculo`) volta no histórico; link direto troca a entrada. */}
      <button onClick={() => (loc.state?.veiculo && (window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav(`/admin/veiculos-leilao/${v.id}`, { replace: true }))} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 700, alignSelf: 'flex-start' }}>
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

          {viab && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>Cenário realista e teto de lance</div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12 }}>
                {[
                  ['Teto de lance', fmtBRL(viab.tetoLance), viab.fechaNaRegra ? '#15803d' : '#b91c1c'],
                  ['Investimento no lance mínimo', fmtBRL(viab.investimentoNoMinimo), '#111111'],
                  ['Revenda realista', fmtBRL(viab.fipeRealista), '#0369a1'],
                  ['Lucro estimado (lance mínimo)', fmtBRL(viab.lucroNoMinimo), viab.lucroNoMinimo >= 0 ? '#15803d' : '#b91c1c'],
                ].map(([rot, val, cor]) => (
                  <div key={rot} style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>{rot}</div>
                    <div style={{ fontWeight: 900, color: cor, fontSize: 17 }}>{val}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: viab.fechaNaRegra ? '#166534' : '#b91c1c', fontWeight: 700 }}>
                {viab.fechaNaRegra
                  ? `Lance até ${fmtBRL(viab.tetoLance)} mantém arrematação + comissão + despesas em até ${Math.round(TETO_FIPE * 100)}% da FIPE (${fmtBRL(viab.tetoAquisicao)}).`
                  : `O lance mínimo já passa do teto: com comissão e despesas, a aquisição fica acima de ${Math.round(TETO_FIPE * 100)}% da FIPE.`}
              </div>
              <table style={{ width: '100%', marginTop: 10, borderCollapse: 'collapse', fontSize: 12.5 }}>
                <tbody>
                  <tr style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: '5px 0' }}>Comissão do leiloeiro</td><td style={{ textAlign: 'right' }}>{viab.comissaoPct}%{viab.comissaoPresumida ? ' (presumida — confirme no edital)' : ''}</td></tr>
                  {viab.despesas.map((d, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: '5px 0' }}>{d.item} <span style={{ color: '#94a3b8', fontSize: 11 }}>({d.origem})</span></td><td style={{ textAlign: 'right' }}>{fmtBRL(d.valor)}</td></tr>
                  ))}
                  <tr style={{ borderTop: '1px solid #e2e8f0', fontWeight: 800 }}><td style={{ padding: '5px 0' }}>Despesas assumidas (sem honorários)</td><td style={{ textAlign: 'right' }}>{fmtBRL(viab.despesasTotal)}</td></tr>
                  <tr style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: '5px 0' }}>Deságio sobre a FIPE para revenda</td><td style={{ textAlign: 'right' }}>{desagio.pct}%</td></tr>
                </tbody>
              </table>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 11.5, color: '#64748b' }}>
                {desagio.fatores.map((f, i) => <li key={i}>{f.motivo}: −{f.pct}%</li>)}
              </ul>
              {semCustosNoRelatorio && <div style={{ marginTop: 8, fontSize: 11.5, color: '#92400e' }}>Este relatório é anterior ao levantamento de custos — clique em "Gerar novamente" para incluir as despesas declaradas e os reparos estimados.</div>}
            </div>
          )}

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
            <div className="parecer-md" style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: mdSimplesParaHtml(result.parecer) }} />
          </div>

          {result.riscos?.length > 0 && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Riscos identificados</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.riscos.map((r, i) => <li key={i} style={{ fontSize: 13, color: '#334155' }}>{r}</li>)}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={baixarPdf} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              <FileDown size={15} /> Baixar PDF
            </button>
            <button onClick={gerar} disabled={emGeracao} style={{ background: 'none', border: 'none', color: '#0D63DB', fontSize: 12.5, fontWeight: 700, cursor: emGeracao ? 'default' : 'pointer', padding: 0 }}>
              Gerar novamente
            </button>
          </div>
        </>
      )}
    </div>
  );
}
