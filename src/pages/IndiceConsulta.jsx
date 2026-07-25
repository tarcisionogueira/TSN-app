import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, TrendingUp, Search, Home, Building2, FileText } from 'lucide-react';
import { apiCall } from '../utils/apiCall';
import EnderecoAutocomplete from '../components/EnderecoAutocomplete';
import { gerarIndicePDF } from '../components/IndicePDF';
import { useAuth } from '../contexts/AuthContext';

// Quem pode GERAR o índice de uma região nova (o servidor é a fonte da verdade — isto é só UI).
const PODE_GERAR = ['admin', 'top2', 'assessorado', 'clube', 'analista', 'advogado'];

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

// Consulta do Índice BidPro — o preço do m² (venda E locação) por cidade/bairro, mais a
// valorização por ano. Só LEITURA do que já está mapeado (grátis). Região não mapeada →
// aponta para gerar (recurso dos planos pagos).
export default function IndiceConsulta() {
  const nav = useNavigate();
  const { effectiveRole, nome } = useAuth();
  const podeGerar = PODE_GERAR.includes(effectiveRole);
  // nivelConsulta: 'rua' (endereço+nº → condomínio/≤250m) · 'bairro' · 'cidade'.
  const [form, setForm] = React.useState({ cidade: '', uf: 'SP', bairro: '', tipo: 'apartamento', lat: null, lng: null, endereco: '', condominio: '', numero: '', nivelConsulta: '' });
  const [loading, setLoading] = React.useState(false);
  const [res, setRes] = React.useState(null);
  const [erro, setErro] = React.useState('');
  const [gerando, setGerando] = React.useState(false);
  const [gerMsg, setGerMsg] = React.useState('');
  const [manual, setManual] = React.useState(false); // fallback: preencher cidade/UF/bairro à mão
  const [isMobile, setIsMobile] = React.useState(typeof window !== 'undefined' && window.innerWidth < 640);
  React.useEffect(() => {
    const on = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  // Consulta o índice de uma localidade (objeto form) e devolve o resultado {mapeado,...}.
  const consultarDe = async (f) => {
    const r = await apiCall('/api/indice-consulta', { method: 'POST', body: JSON.stringify(f) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Falha na consulta');
    return d;
  };

  // Assim que o usuário ESCOLHE um endereço/bairro/cidade, já dizemos se está mapeado —
  // sem botão. Se não estiver, o cartão convida a gerar na hora (na granularidade certa).
  const autoConsultar = async (f) => {
    setErro(''); setRes(null); setGerMsg(''); setLoading(true);
    try { setRes(await consultarDe(f)); } catch (e2) { setErro(e2.message); }
    setLoading(false);
  };

  const consultar = (e) => {
    e?.preventDefault?.();
    if (!form.cidade.trim() || !form.uf) { setErro('Informe a cidade e a UF.'); return; }
    autoConsultar(form);
  };

  // Gera o índice de MERCADO desta localidade: pesquisa web ao vivo (api/indice-mercado),
  // guarda as amostras (peso por data) e reconsulta p/ exibir. Cobra cota/crédito no servidor.
  // Passa endereço + condomínio → Nível 1 (mesmo condomínio/rua, ≤250 m), como no mercadológico.
  const gerar = async () => {
    setGerando(true); setGerMsg('');
    try {
      const r = await apiCall('/api/indice-mercado', { method: 'POST', body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) { setGerMsg(d.error || 'Não foi possível gerar.'); setGerando(false); return; }
      if (!d.gerado) { setGerMsg('A pesquisa não encontrou amostras de mercado suficientes nesta localidade. Tente uma cidade/bairro maior.'); setGerando(false); return; }
      const dc = await consultarDe(form).catch(() => null);
      if (dc) { setRes(dc); setGerMsg(d.inseridas ? `Pesquisa concluída — ${d.inseridas} amostra(s) nova(s) na base.` : 'Índice atualizado.'); }
    } catch (e) { setGerMsg(e.message || 'Falha ao gerar.'); }
    setGerando(false);
  };

  const vz = res?.valorizacao;
  const reg = res?.regiao;
  const nivelLabel = reg?.nivel_label || (reg?.nivel === 'bairro' ? 'bairro' : reg?.nivel === 'grid' ? 'microrregião (~1 km)' : 'cidade');

  // Como o condomínio/edifício vem do Google (POI/premise): nome ≠ rua.
  const condominioDe = (end) => {
    const poi = ['premise', 'subpremise', 'point_of_interest', 'establishment'].some(t => (end.tipos || []).includes(t));
    const nome = String(end.nome || '').trim();
    return (poi && nome && nome.toLowerCase() !== String(end.logradouro || '').toLowerCase()) ? nome : '';
  };
  const rotuloNivel = { rua: 'rua/condomínio (raio de 250 m)', bairro: 'bairro e adjacências', cidade: 'cidade' };
  const localLabel = [form.condominio, form.bairro, form.cidade].filter(Boolean).join(' · ') + (form.uf ? `/${form.uf}` : '');

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 16px', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <MapPin size={22} color="#0D63DB" />
        <h1 style={{ fontSize: 22, fontWeight: 900, color: '#111', margin: 0 }}>Índice BidPro</h1>
      </div>
      <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 14px', lineHeight: 1.6 }}>
        O preço do m² <strong>para venda e para locação</strong> na região, com a valorização por ano.
        Digite <strong>qualquer endereço, bairro ou cidade</strong> — se ainda não mapeamos, você <strong>gera a pesquisa na hora</strong>.
      </p>

      <form onSubmit={consultar} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14, marginBottom: 20 }}>
        {!manual && (
          <label style={{ flex: '1 1 100%' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Endereço, bairro ou cidade <span style={{ color: '#94a3b8', fontWeight: 400 }}>(preenche o resto sozinho)</span></div>
            <EnderecoAutocomplete
              placeholder="Digite a rua e número, o bairro ou a cidade…"
              onSelect={(end) => {
                const numero = end.numero || '';
                const condominio = condominioDe(end);
                const nivel = (numero || condominio) ? 'rua' : (end.bairro ? 'bairro' : 'cidade');
                const endereco = [end.logradouro, numero].filter(Boolean).join(', ') || end.formatado || '';
                const f = {
                  ...form,
                  cidade: end.cidade || '', uf: (end.uf || '').toUpperCase(), bairro: end.bairro || '',
                  lat: end.lat ?? null, lng: end.lng ?? null,
                  endereco, condominio, numero, nivelConsulta: nivel,
                };
                setForm(f);
                if (f.cidade && f.uf) autoConsultar(f); // já diz na hora se está mapeado
              }}
            />
            {form.cidade && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {form.condominio ? <Building2 size={13} /> : <MapPin size={13} />} {localLabel}
                {form.nivelConsulta && <span style={{ color: '#15803d', opacity: 0.75 }}>· {rotuloNivel[form.nivelConsulta]}</span>}
              </div>
            )}
          </label>
        )}
        {manual && (<>
          <label style={{ flex: isMobile ? '1 1 100%' : 2, minWidth: isMobile ? '100%' : 160 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Cidade</div>
            <input value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} placeholder="Digite a cidade"
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, boxSizing: 'border-box' }} />
          </label>
          <label style={{ width: isMobile ? 96 : 84 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>UF</div>
            <select value={form.uf} onChange={e => setForm(f => ({ ...f, uf: e.target.value }))}
              style={{ width: '100%', padding: '10px 8px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, background: 'white', boxSizing: 'border-box' }}>
              {UFS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label style={{ flex: isMobile ? '1 1 auto' : 2, minWidth: 140 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Bairro <span style={{ color: '#94a3b8', fontWeight: 400 }}>(opcional)</span></div>
            <input value={form.bairro} onChange={e => setForm(f => ({ ...f, bairro: e.target.value }))} placeholder="Digite o bairro"
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, boxSizing: 'border-box' }} />
          </label>
        </>)}
        <label style={{ flex: isMobile ? '1 1 100%' : '0 0 168px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Tipo</div>
          <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
            style={{ width: '100%', padding: '10px 8px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, background: 'white', boxSizing: 'border-box' }}>
            <option value="apartamento">Apartamento</option>
            <option value="casa">Casa / condomínio</option>
            <option value="terreno">Terreno / área</option>
            <option value="comercial">Comercial / industrial</option>
          </select>
        </label>
        <button type="submit" disabled={loading || !form.cidade}
          title={!form.cidade ? 'Escolha um endereço/cidade na lista' : ''}
          style={{ flex: isMobile ? '1 1 100%' : '0 0 auto', justifyContent: 'center', padding: '11px 20px', background: (loading || !form.cidade) ? '#94a3b8' : '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: (loading || !form.cidade) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={16} /> {loading ? 'Consultando…' : 'Consultar'}
        </button>
        <button type="button" onClick={() => setManual(m => !m)}
          style={{ flex: '1 1 100%', background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: '2px 2px 0', textDecoration: 'underline' }}>
          {manual ? '↺ Voltar a buscar pelo endereço' : 'Preferir digitar cidade/UF manualmente'}
        </button>
      </form>

      {erro && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 10, fontSize: 13, marginBottom: 16 }}>{erro}</div>}

      {res && !res.mapeado && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: '18px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#92400e', marginBottom: 6 }}>
            Ainda não mapeamos {form.nivelConsulta === 'rua' ? (form.condominio ? 'este condomínio' : 'esta rua') : form.nivelConsulta === 'bairro' ? 'este bairro' : 'esta cidade'}
          </div>
          <div style={{ fontSize: 13.5, color: '#78350f', lineHeight: 1.6, marginBottom: 14 }}>
            Sem índice ainda para <strong>{localLabel || `${form.cidade}/${form.uf}`}</strong>.
            {podeGerar
              ? ` Gere agora uma pesquisa de mercado ao vivo (venda e locação) ${form.nivelConsulta === 'rua' ? 'com referência no condomínio/rua (raio de 250 m) e na vizinhança até 1 km' : form.nivelConsulta === 'bairro' ? 'do bairro e adjacências' : 'da cidade'} para ${form.tipo} — as amostras ficam guardadas e passam a alimentar o índice e os relatórios.`
              : ' Nos planos pagos você gera o índice desta localidade na hora.'}
          </div>
          {gerMsg && <div style={{ fontSize: 12.5, color: '#92400e', background: '#fef3c7', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>{gerMsg}</div>}
          {podeGerar ? (
            <button onClick={gerar} disabled={gerando}
              style={{ padding: '10px 18px', background: gerando ? '#94a3b8' : '#d97706', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: gerando ? 'wait' : 'pointer' }}>
              {gerando ? 'Pesquisando o mercado…' : '⚡ Gerar índice agora'}
            </button>
          ) : (
            <button onClick={() => nav('/planos')} style={{ padding: '10px 18px', background: '#d97706', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
              Ver planos
            </button>
          )}
          {podeGerar && effectiveRole !== 'admin' && (
            <div style={{ fontSize: 11, color: '#a16207', marginTop: 8 }}>Consome 1 do seu limite mensal de índice; esgotado, usa crédito. A pesquisa leva alguns segundos.</div>
          )}
        </div>
      )}

      {res && res.mapeado && reg && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ borderRadius: 14, border: '1px solid #c7d2fe', background: '#eef2ff', padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#111' }}>{form.cidade}/{form.uf}{reg.bairro_norm ? ` · ${form.bairro}` : ''}</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>nível {nivelLabel} · {reg.n_amostras || 0} amostras</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ background: 'white', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0D63DB', fontSize: 11, fontWeight: 700 }}><Home size={13} /> VENDA</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#0D63DB', marginTop: 4 }}>{Number(reg.venda_m2) > 0 ? `${brl(reg.venda_m2)}/m²` : '—'}</div>
              </div>
              <div style={{ background: 'white', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#7c3aed', fontSize: 11, fontWeight: 700 }}><Building2 size={13} /> LOCAÇÃO</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#7c3aed', marginTop: 4 }}>{Number(reg.aluguel_m2) > 0 ? `${brl(reg.aluguel_m2)}/m²·mês` : 'em formação'}</div>
              </div>
            </div>
          </div>

          <button
            onClick={() => gerarIndicePDF({ form, reg, amostras: res?.amostras || [], amostrasAno: res?.amostras_ano || [], solicitante: { nome, role: effectiveRole } })}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 20px', background: '#0D2A54', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
            <FileText size={16} /> Gerar relatório do Índice (PDF)
          </button>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: -8 }}>
            Peça com a marca BidPro para compartilhar com clientes (advogados, peritos, corretores).
          </div>

          {Array.isArray(vz?.serie) && vz.serie.length >= 2 && (() => {
            const max = Math.max(...vz.serie.map(p => Number(p.m2) || 0)) || 1;
            const pos = Number(vz.valorizacao_periodo_pct) >= 0;
            return (
              <div style={{ borderRadius: 14, border: '1px solid #bbf7d0', background: '#f0fdf4', padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <TrendingUp size={15} color="#059669" />
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#111' }}>Valorização (venda R$/m²)</span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>{vz.ano_inicial}–{vz.ano_final}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, padding: '2px 10px', borderRadius: 999, background: pos ? '#dcfce7' : '#fee2e2', color: pos ? '#166534' : '#991b1b' }}>
                    {pos ? '+' : ''}{Number(vz.valorizacao_periodo_pct).toFixed(1)}% · {Number(vz.valorizacao_aa_pct).toFixed(1)}% a.a.
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 100 }}>
                  {vz.serie.map(p => {
                    const h = Math.max(6, Math.round((Number(p.m2) / max) * 74));
                    return (
                      <div key={p.ano} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, justifyContent: 'flex-end', height: '100%' }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: '#065f46' }}>{brl(p.m2)}</div>
                        <div title={`${p.n} amostras`} style={{ width: '100%', maxWidth: 46, height: h, borderRadius: '6px 6px 0 0', background: 'linear-gradient(180deg,#34d399,#059669)' }} />
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: '#334155' }}>{p.ano}</div>
                        <div style={{ fontSize: 9, color: '#94a3b8' }}>{p.n} am.</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
            Base própria BidPro (anúncios de venda/locação e revendas confirmadas, com data). Não inclui preços de leilão/arremate. Referência de mercado — não é avaliação formal.
          </div>
        </div>
      )}
    </div>
  );
}
