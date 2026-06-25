import React, { useState, useEffect } from 'react';
import { Loader2, Sparkles, Save, Bell, BellOff, Calendar, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';
import { calcularDepositoJudicial } from '../utils/calculos';

const inp = { width: '100%', padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: 'white', color: '#111', boxSizing: 'border-box' };
const lbl = { fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 };
const fmtBRL = v => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const fmtData = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

const VAZIO = {
  valor_imovel: '', valor_sinal: '', sinal_percentual: '', valor_parcela: '',
  num_parcelas: '', data_sinal: '', data_primeira_parcela: '', taxa_juros_anual: '',
  indice_correcao: 'prefixado', notificar_email: true, notas: '', imovel_nome: '',
};

function Field({ label, children }) {
  return <div><label style={lbl}>{label}</label>{children}</div>;
}

export default function FinanciamentoTracker({ imovelId, imovelNome, onSalvo }) {
  const { user } = useAuth();
  const [dados, setDados] = useState({ ...VAZIO, imovel_nome: imovelNome || '' });
  const [salvando, setSalvando] = useState(false);
  const [carregandoIA, setCarregandoIA] = useState(false);
  const [editalTexto, setEditalTexto] = useState('');
  const [showEdital, setShowEdital] = useState(false);
  const [showCronograma, setShowCronograma] = useState(true);
  const [msg, setMsg] = useState(null);
  const [financiamentoId, setFinanciamentoId] = useState(null);

  // Carrega financiamento existente se imovelId fornecido
  useEffect(() => {
    if (!user?.id || !imovelId) return;
    supabase.from('financiamentos').select('*').eq('user_id', user.id).eq('imovel_id', imovelId).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setFinanciamentoId(data.id);
          setDados({
            valor_imovel: data.valor_imovel || '',
            valor_sinal: data.valor_sinal || '',
            sinal_percentual: data.sinal_percentual || '',
            valor_parcela: data.valor_parcela || '',
            num_parcelas: data.num_parcelas || '',
            data_sinal: data.data_sinal || '',
            data_primeira_parcela: data.data_primeira_parcela || '',
            taxa_juros_anual: data.taxa_juros_anual || '',
            indice_correcao: data.indice_correcao || 'prefixado',
            notificar_email: data.notificar_email !== false,
            notas: data.notas || '',
            imovel_nome: data.imovel_nome || imovelNome || '',
          });
        }
      });
  }, [user?.id, imovelId]);

  const upd = e => {
    const { name, value, type, checked } = e.target;
    setDados(prev => {
      const next = { ...prev, [name]: type === 'checkbox' ? checked : value };
      // Auto-calcula valor_sinal a partir de sinal_percentual e valor_imovel
      if (name === 'sinal_percentual' && next.valor_imovel) {
        next.valor_sinal = (Number(next.valor_imovel) * Number(value) / 100).toFixed(2);
      }
      if (name === 'valor_imovel' && next.sinal_percentual) {
        next.valor_sinal = (Number(value) * Number(next.sinal_percentual) / 100).toFixed(2);
      }
      return next;
    });
  };

  // Cronograma de pagamentos
  const cronograma = React.useMemo(() => {
    const parcelas = [];
    if (dados.data_sinal && dados.valor_sinal) {
      parcelas.push({ n: 'Sinal', data: dados.data_sinal, valor: Number(dados.valor_sinal), tipo: 'sinal' });
    }
    if (dados.data_primeira_parcela && dados.num_parcelas && dados.valor_parcela) {
      const base = new Date(dados.data_primeira_parcela + 'T12:00:00');
      for (let i = 0; i < Number(dados.num_parcelas); i++) {
        const dt = new Date(base);
        dt.setMonth(dt.getMonth() + i);
        parcelas.push({ n: i + 1, data: dt.toISOString().slice(0, 10), valor: Number(dados.valor_parcela), tipo: 'parcela' });
      }
    }
    return parcelas;
  }, [dados.data_sinal, dados.valor_sinal, dados.data_primeira_parcela, dados.num_parcelas, dados.valor_parcela]);

  const hoje = new Date().toISOString().slice(0, 10);
  const totalDesembolso = cronograma.reduce((s, p) => s + p.valor, 0);

  const handleIA = async () => {
    if (!editalTexto.trim()) { setMsg({ tipo: 'erro', texto: 'Cole o texto do edital primeiro.' }); return; }
    setCarregandoIA(true);
    setMsg(null);
    try {
      const res = await apiCall('/api/financiamento-ia', 'POST', { editalTexto, imovelId });
      if (res.error) throw new Error(res.error);
      setDados(prev => ({
        ...prev,
        valor_imovel:          res.valor_imovel ?? prev.valor_imovel,
        valor_sinal:           res.valor_sinal ?? prev.valor_sinal,
        sinal_percentual:      res.sinal_percentual ?? prev.sinal_percentual,
        valor_parcela:         res.valor_parcela ?? prev.valor_parcela,
        num_parcelas:          res.num_parcelas ?? prev.num_parcelas,
        taxa_juros_anual:      res.taxa_juros_anual ?? prev.taxa_juros_anual,
        indice_correcao:       res.indice_correcao ?? prev.indice_correcao,
        data_sinal:            res.data_sinal ?? prev.data_sinal,
        data_primeira_parcela: res.data_primeira_parcela ?? prev.data_primeira_parcela,
        notas:                 res.notas ?? prev.notas,
      }));
      setShowEdital(false);
      setMsg({ tipo: 'ok', texto: 'Parâmetros extraídos pelo edital. Revise e confirme.' });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e.message || 'Erro na análise de IA.' });
    } finally {
      setCarregandoIA(false);
    }
  };

  const handleSalvar = async () => {
    if (!user?.id) return;
    setSalvando(true);
    setMsg(null);
    const payload = {
      user_id: user.id,
      imovel_id: imovelId || null,
      imovel_nome: dados.imovel_nome || imovelNome || null,
      valor_imovel: Number(dados.valor_imovel) || null,
      valor_sinal: Number(dados.valor_sinal) || null,
      sinal_percentual: Number(dados.sinal_percentual) || null,
      valor_parcela: Number(dados.valor_parcela) || null,
      num_parcelas: Number(dados.num_parcelas) || null,
      data_sinal: dados.data_sinal || null,
      data_primeira_parcela: dados.data_primeira_parcela || null,
      taxa_juros_anual: Number(dados.taxa_juros_anual) || null,
      indice_correcao: dados.indice_correcao || 'prefixado',
      notificar_email: dados.notificar_email !== false,
      notas: dados.notas || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = financiamentoId
      ? await supabase.from('financiamentos').update(payload).eq('id', financiamentoId).select('id').single()
      : await supabase.from('financiamentos').insert(payload).select('id').single();
    if (error) {
      setMsg({ tipo: 'erro', texto: error.message });
    } else {
      if (!financiamentoId && data?.id) setFinanciamentoId(data.id);
      setMsg({ tipo: 'ok', texto: 'Financiamento salvo com sucesso!' });
      onSalvo?.();
    }
    setSalvando(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Tracker de Financiamento</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Monitore parcelas e receba alertas de vencimento</div>
        </div>
        <button
          onClick={() => setShowEdital(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f0fdf4', color: '#059669', border: '1px solid #bbf7d0', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          <Sparkles size={14} /> Preencher com IA
        </button>
      </div>

      {/* Painel de extração por IA */}
      {showEdital && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16 }}>
          <label style={lbl}>Cole o texto do edital ou condições de pagamento</label>
          <textarea
            rows={5}
            value={editalTexto}
            onChange={e => setEditalTexto(e.target.value)}
            placeholder="Ex: O imóvel tem valor de avaliação de R$ 350.000,00. O arrematante deverá pagar 30% de sinal em 5 dias úteis e o restante em 360 parcelas mensais de R$ 1.800,00 corrigidas pelo IPCA..."
            style={{ ...inp, resize: 'vertical', background: 'white' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={handleIA}
              disabled={carregandoIA}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: carregandoIA ? 'wait' : 'pointer' }}
            >
              {carregandoIA ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Analisando...</> : <><Sparkles size={14} /> Extrair parâmetros</>}
            </button>
            <button onClick={() => setShowEdital(false)} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 14px', fontSize: 12, cursor: 'pointer', color: '#64748b' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Mensagem de feedback */}
      {msg && (
        <div style={{ background: msg.tipo === 'ok' ? '#f0fdf4' : '#fee2e2', border: `1px solid ${msg.tipo === 'ok' ? '#bbf7d0' : '#fca5a5'}`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          {msg.tipo === 'ok' ? <CheckCircle2 size={15} color="#059669" /> : <AlertTriangle size={15} color="#dc2626" />}
          <span style={{ color: msg.tipo === 'ok' ? '#065f46' : '#b91c1c' }}>{msg.texto}</span>
        </div>
      )}

      {/* Formulário */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Field label="Nome do imóvel">
          <input name="imovel_nome" value={dados.imovel_nome} onChange={upd} placeholder="Ex: Apto Rua das Flores 123" style={inp} />
        </Field>
        <Field label="Valor do imóvel (R$)">
          <input name="valor_imovel" type="number" value={dados.valor_imovel} onChange={upd} placeholder="350000" style={inp} />
        </Field>
        <Field label="% do sinal">
          <input name="sinal_percentual" type="number" value={dados.sinal_percentual} onChange={upd} placeholder="30" min="0" max="100" style={inp} />
        </Field>
        <Field label="Valor do sinal (R$)">
          <input name="valor_sinal" type="number" value={dados.valor_sinal} onChange={upd} placeholder="105000" style={inp} />
        </Field>
        <Field label="Data de vencimento do sinal">
          <input name="data_sinal" type="date" value={dados.data_sinal} onChange={upd} style={inp} />
        </Field>
        <Field label="Valor da parcela (R$)">
          <input name="valor_parcela" type="number" value={dados.valor_parcela} onChange={upd} placeholder="1800" style={inp} />
        </Field>
        <Field label="Número de parcelas">
          <input name="num_parcelas" type="number" value={dados.num_parcelas} onChange={upd} placeholder="360" min="1" style={inp} />
        </Field>
        <Field label="Data da 1ª parcela">
          <input name="data_primeira_parcela" type="date" value={dados.data_primeira_parcela} onChange={upd} style={inp} />
        </Field>
        <Field label="Taxa de juros (% a.a.)">
          <input name="taxa_juros_anual" type="number" value={dados.taxa_juros_anual} onChange={upd} placeholder="10.5" step="0.1" style={inp} />
        </Field>
        <Field label="Índice de correção">
          <select name="indice_correcao" value={dados.indice_correcao} onChange={upd} style={inp}>
            <option value="prefixado">Prefixado</option>
            <option value="SELIC">SELIC</option>
            <option value="IPCA">IPCA</option>
            <option value="IGPM">IGP-M</option>
            <option value="TR">TR</option>
          </select>
        </Field>
      </div>

      <Field label="Observações">
        <textarea name="notas" value={dados.notas} onChange={upd} rows={2} placeholder="Condições especiais, nome do leiloeiro, processo judicial..." style={{ ...inp, resize: 'vertical' }} />
      </Field>

      {/* Toggle de notificação */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: dados.notificar_email ? '#f0fdf4' : '#f8fafc', border: `1px solid ${dados.notificar_email ? '#bbf7d0' : '#e2e8f0'}`, borderRadius: 10, padding: '12px 16px' }}>
        {dados.notificar_email ? <Bell size={16} color="#059669" /> : <BellOff size={16} color="#94a3b8" />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>Alertas de vencimento por email</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>Você receberá um email no dia de cada vencimento</div>
        </div>
        <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: 'pointer' }}>
          <input type="checkbox" name="notificar_email" checked={dados.notificar_email} onChange={upd} style={{ opacity: 0, width: 0, height: 0 }} />
          <span style={{ position: 'absolute', inset: 0, background: dados.notificar_email ? '#059669' : '#cbd5e1', borderRadius: 12, transition: '0.2s' }} />
          <span style={{ position: 'absolute', top: 3, left: dados.notificar_email ? 23 : 3, width: 18, height: 18, background: 'white', borderRadius: '50%', transition: '0.2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
        </label>
      </div>

      {/* Cronograma de pagamentos */}
      {cronograma.length > 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <button
            onClick={() => setShowCronograma(v => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#f8fafc', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#0f172a' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={14} color="#0D63DB" />
              Cronograma de pagamentos ({cronograma.length} vencimentos · Total: {fmtBRL(totalDesembolso)})
            </span>
            {showCronograma ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showCronograma && (
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>#</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>Vencimento</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b', fontWeight: 600 }}>Valor</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cronograma.map((p, i) => {
                    const vencido = p.data < hoje;
                    const hoje_dt = p.data === hoje;
                    return (
                      <tr key={i} style={{ borderTop: '1px solid #f1f5f9', background: hoje_dt ? '#fef3c7' : vencido ? '#fff1f2' : 'white' }}>
                        <td style={{ padding: '8px 12px', color: '#64748b' }}>{p.tipo === 'sinal' ? 'S' : p.n}</td>
                        <td style={{ padding: '8px 12px', fontWeight: hoje_dt ? 700 : 400 }}>{fmtData(p.data)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>{fmtBRL(p.valor)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          {hoje_dt
                            ? <span style={{ background: '#fef3c7', color: '#78350f', border: '1px solid #fcd34d', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>⚠️ Hoje</span>
                            : vencido
                            ? <span style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>Vencido</span>
                            : <span style={{ background: '#f0fdf4', color: '#059669', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>Pendente</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Botão salvar */}
      <button
        onClick={handleSalvar}
        disabled={salvando}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#0D63DB', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer' }}
      >
        {salvando ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Salvando...</> : <><Save size={15} /> Salvar financiamento</>}
      </button>
    </div>
  );
}
