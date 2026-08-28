import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scale, Building2, Mail, FileText, DollarSign, Plus, Trash2, Save, Loader2, ArrowRight, MessageSquare, Paperclip } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { TERMO_JURIDICO_VERSAO, TermoJuridicoModal } from '../components/TermoJuridico';

const ETAPA_LABEL = {
  analise_solicitada: 'Análise solicitada', analises_prontas: 'Análises prontas',
  reuniao_agendada: 'Reunião agendada', reuniao_realizada: 'Reunião realizada',
  juridico_solicitado: 'Aguardando seu parecer', juridico_concluido: 'Parecer concluído',
  segunda_reuniao: '2ª reunião', arrematado: 'Arrematado', honorarios_pagos: 'Honorários pagos',
  procuracao_assinada: 'Procuração assinada', pos_arrematacao: 'Pós-arrematação',
};

export default function AdvogadoPortal() {
  const nav = useNavigate();
  const { user, effectiveUserId, role } = useAuth();
  const [aba, setAba] = useState('escritorio');

  // ── TERMO DE ADESÃO DO ADVOGADO (28/08) ─────────────────────────────────────
  // O portal é a porta por onde TODO advogado passa, venha ele de convite de equipe ou de
  // atribuição manual do admin — por isso o aceite é exigido aqui, e não só no convite: um
  // gate no convite deixaria de fora quem foi promovido a advogado pelo Admin, que é como o
  // primeiro deles provavelmente vai entrar.
  //
  // BLOQUEANTE de propósito. Este termo é o que define o repasse de 4,5% do valor arrematado
  // e o dever de sigilo sobre documento de cliente; deixar navegar antes de aceitar seria dar
  // acesso a matrícula e processo de terceiro sem contrato nenhum assinado.
  const [aceite, setAceite] = useState(undefined);   // undefined = ainda lendo
  const [concordo, setConcordo] = useState(false);
  const [aceitando, setAceitando] = useState(false);
  const [erroAceite, setErroAceite] = useState('');
  const alvo = effectiveUserId || user?.id;
  useEffect(() => {
    if (!alvo) return;
    let vivo = true;
    (async () => {
      // `error` conferido: sem isso um 400 viraria "não aceitou" e o advogado veria o termo
      // de novo a cada carga, ou — pior, se a leitura falhasse do outro lado — passaria direto.
      const { data, error } = await supabase.from('perfis').select('juridico_aceite_em').eq('id', alvo).maybeSingle();
      if (!vivo) return;
      if (error) { console.error('[AdvogadoPortal] leitura do aceite falhou:', error.message); setAceite(null); return; }
      setAceite(data?.juridico_aceite_em || null);
    })();
    return () => { vivo = false; };
  }, [alvo]);

  const registrarAceite = async () => {
    setAceitando(true); setErroAceite('');
    const { data, error } = await supabase.rpc('aceitar_termo_juridico', { p_versao: TERMO_JURIDICO_VERSAO });
    setAceitando(false);
    // A RPC devolve NULL quando o papel não é advogado/admin. Sem checar isso, a tela diria
    // "aceito" e o banco continuaria sem carimbo — o aceite que ninguém registrou.
    if (error || !data) {
      setErroAceite(error?.message || 'Não foi possível registrar o aceite. Confirme que seu perfil está como Advogado e tente de novo.');
      return;
    }
    setAceite(data);
  };

  // Só o próprio advogado assina. O admin vê o portal sem o bloqueio (ele revisa o fluxo,
  // e o termo dele não é este).
  const precisaAceitar = role === 'advogado' && aceite === null;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '24px 20px 80px' }}>
      {precisaAceitar && (
        <>
          <TermoJuridicoModal
            bloqueante
            onAceitar={registrarAceite}
            concordo={concordo} setConcordo={setConcordo} aceitando={aceitando}
          />
          {erroAceite && (
            <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 4100, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700 }}>{erroAceite}</div>
          )}
        </>
      )}
      <h1 style={{ fontSize: 24, fontWeight: 900, color: '#111', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Scale size={24} color="#7c3aed" /> Área do Advogado
      </h1>
      <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 20px' }}>Gerencie seu escritório, os e-mails em cópia e acompanhe seus casos e honorários.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[['escritorio', 'Meu Escritório', Building2], ['casos', 'Casos Recebidos', FileText], ['atendimentos', 'Atendimentos', MessageSquare], ['honorarios', 'Honorários', DollarSign]].map(([k, label, Icon]) => (
          <button key={k} onClick={() => k === 'honorarios' ? nav('/comissoes') : setAba(k)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', background: aba === k ? '#7c3aed' : '#f1f5f9', color: aba === k ? 'white' : '#64748b' }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {aba === 'escritorio' && <SecaoEscritorio />}
      {aba === 'casos' && <SecaoCasos user={user} alvoId={effectiveUserId || user.id} nav={nav} />}
      {aba === 'atendimentos' && <SecaoAtendimentos />}
    </div>
  );
}

function SecaoAtendimentos() {
  const [itens, setItens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState(null);
  useEffect(() => {
    (async () => {
      try { const r = await apiCall('/api/advogado-atendimentos'); const d = await r.json(); setItens(d.atendimentos || []); } catch (_) {}
      setLoading(false);
    })();
  }, []);
  const fmt = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  if (loading) return <div style={{ padding: 30, textAlign: 'center' }}><Loader2 size={20} color="#7c3aed" style={{ animation: 'spin 1s linear infinite' }} /></div>;
  if (!itens.length) return <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Nenhum atendimento ainda. Quando um caso for encaminhado por e-mail, a conversa aparece aqui.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {itens.map(it => (
        <div key={it.caso_id} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
          <button onClick={() => setAberto(aberto === it.caso_id ? null : it.caso_id)}
            style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', border: 'none', background: 'white', cursor: 'pointer' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.imovel || 'Imóvel'} <span style={{ color: '#94a3b8', fontWeight: 400 }}>· {it.tipo_leilao || '—'}</span></div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{(it.thread || []).length} mensagem(ns) na conversa</div>
            </div>
            <ArrowRight size={16} color="#cbd5e1" style={{ transform: aberto === it.caso_id ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
          </button>
          {aberto === it.caso_id && (
            <div style={{ borderTop: '1px solid #f1f5f9', padding: '14px 18px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Thread contínuo: demanda enviada + suas devolutivas, em ordem */}
              {(it.thread || []).map((m, i) => {
                const ehDemanda = m.tipo === 'demanda';
                return (
                  <div key={i} style={{ alignSelf: ehDemanda ? 'flex-start' : 'flex-end', maxWidth: '88%' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>
                      {ehDemanda ? '📨 Demanda recebida' : '⚖️ Sua devolutiva'} · {fmt(m.data)}
                    </div>
                    <div style={{ padding: '10px 13px', borderRadius: 12, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                      background: ehDemanda ? 'white' : '#ccfbf1', border: `1px solid ${ehDemanda ? '#e2e8f0' : '#5eead4'}`, color: '#111' }}>
                      {ehDemanda && m.assunto && <div style={{ fontWeight: 700, marginBottom: 4 }}>{m.assunto}</div>}
                      {m.texto || (ehDemanda ? 'Documentação e triagem enviadas por e-mail.' : '(sem texto)')}
                      {(m.anexos || []).length > 0 && (
                        <div style={{ marginTop: 6, fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Paperclip size={11} /> {m.anexos.length} anexo(s)
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SecaoEscritorio() {
  const [esc, setEsc] = useState({ razao_social: '', cnpj: '', oab: '', telefone: '', endereco: '', observacoes: '' });
  const [dests, setDests] = useState([]);
  const [novo, setNovo] = useState({ nome: '', email: '', papel: '', copia: true });
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');

  const carregar = async () => {
    try {
      const r = await apiCall('/api/advogado-escritorio'); const d = await r.json();
      if (d.escritorio) setEsc(e => ({ ...e, ...d.escritorio }));
      const r2 = await apiCall('/api/juridico-destinatarios'); const d2 = await r2.json();
      setDests(d2.destinatarios || []);
    } catch (_) {}
  };
  useEffect(() => { carregar(); }, []);

  const salvarEscritorio = async () => {
    setSalvando(true); setMsg('');
    try {
      const r = await apiCall('/api/advogado-escritorio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(esc) });
      if (!r.ok) throw new Error((await r.json()).error || 'Erro');
      setMsg('Dados do escritório salvos.');
    } catch (e) { setMsg('Erro: ' + e.message); }
    setSalvando(false);
  };

  const addEmail = async () => {
    if (!novo.email.includes('@')) { setMsg('E-mail inválido.'); return; }
    const r = await apiCall('/api/juridico-destinatarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novo) });
    if (r.ok) { setNovo({ nome: '', email: '', papel: '', copia: true }); carregar(); }
  };
  const removerEmail = async (id) => {
    const r = await apiCall('/api/juridico-destinatarios', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (r.ok) carregar();
  };

  const campo = (k, label, ph) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>{label}</label>
      <input value={esc[k] || ''} onChange={e => setEsc(p => ({ ...p, [k]: e.target.value }))} placeholder={ph}
        style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, boxSizing: 'border-box', outline: 'none' }} />
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
      {/* Dados da empresa */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 800, color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}><Building2 size={16} /> Dados do escritório</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '0 16px' }}>
          {campo('razao_social', 'Razão social / Nome', 'Ex.: Cajado Advogados Associados')}
          {campo('cnpj', 'CNPJ', '00.000.000/0001-00')}
          {campo('oab', 'OAB', 'Ex.: 123456/BA')}
          {campo('telefone', 'Telefone', '(00) 00000-0000')}
        </div>
        {campo('endereco', 'Endereço', 'Rua, nº, cidade/UF')}
        {campo('observacoes', 'Observações', 'Informações adicionais')}
        <button onClick={salvarEscritorio} disabled={salvando}
          style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: salvando ? 0.6 : 1 }}>
          {salvando ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />} Salvar
        </button>
        {msg && <span style={{ marginLeft: 12, fontSize: 13, color: msg.startsWith('Erro') ? '#dc2626' : '#15803d' }}>{msg}</span>}
      </div>

      {/* E-mails em cópia */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800, color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}><Mail size={16} /> E-mails que recebem as demandas</h3>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px' }}>Defina quem recebe no <strong>Para</strong> e quem fica em <strong>Cópia</strong>. Ex.: o dono no Para; diretora e advogado em cópia.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {dests.length === 0 && <div style={{ fontSize: 13, color: '#94a3b8' }}>Nenhum e-mail cadastrado ainda.</div>}
          {dests.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #eef2f7', borderRadius: 10, padding: '8px 12px' }}>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: d.copia ? '#eff6ff' : '#dcfce7', color: d.copia ? '#0D63DB' : '#15803d' }}>{d.copia ? 'Cópia' : 'Para'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{d.nome || d.email} {d.papel && <span style={{ color: '#94a3b8', fontWeight: 400 }}>· {d.papel}</span>}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{d.email}</div>
              </div>
              <button onClick={() => removerEmail(d.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr)) auto', gap: 8, alignItems: 'end' }}>
          <input value={novo.nome} onChange={e => setNovo(p => ({ ...p, nome: e.target.value }))} placeholder="Nome"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, outline: 'none' }} />
          <input value={novo.email} onChange={e => setNovo(p => ({ ...p, email: e.target.value }))} placeholder="email@escritorio.com"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, outline: 'none' }} />
          <input value={novo.papel} onChange={e => setNovo(p => ({ ...p, papel: e.target.value }))} placeholder="Papel (ex.: Dono)"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, outline: 'none' }} />
          <select value={novo.copia ? 'cc' : 'to'} onChange={e => setNovo(p => ({ ...p, copia: e.target.value === 'cc' }))}
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, outline: 'none' }}>
            <option value="to">Para</option>
            <option value="cc">Cópia</option>
          </select>
          <button onClick={addEmail} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: '#111', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}><Plus size={14} /> Adicionar</button>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function SecaoCasos({ user, alvoId, nav }) {
  const [casos, setCasos] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('casos').select('id,imovel_endereco,status_etapa,tipo_leilao,juridico_enviado_em,created_at')
        .eq('advogado_id', alvoId || user.id).order('juridico_enviado_em', { ascending: false, nullsFirst: false });
      setCasos(data || []); setLoading(false);
    })();
  }, [user?.id]);

  if (loading) return <div style={{ padding: 30, textAlign: 'center' }}><Loader2 size={20} color="#7c3aed" style={{ animation: 'spin 1s linear infinite' }} /></div>;
  if (!casos.length) return <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Nenhum caso recebido ainda. Você é avisado por e-mail quando um caso é encaminhado.</div>;

  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
      {casos.map(c => (
        <button key={c.id} onClick={() => nav('/caso/' + c.id)}
          style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', border: 'none', borderBottom: '1px solid #f1f5f9', background: 'white', cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.imovel_endereco || 'Imóvel'} <span style={{ color: '#94a3b8', fontWeight: 400 }}>· {c.tipo_leilao || '—'}</span></div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{ETAPA_LABEL[c.status_etapa] || c.status_etapa}{c.juridico_enviado_em ? ` · recebido ${new Date(c.juridico_enviado_em).toLocaleDateString('pt-BR')}` : ''}</div>
          </div>
          <ArrowRight size={16} color="#cbd5e1" />
        </button>
      ))}
    </div>
  );
}
