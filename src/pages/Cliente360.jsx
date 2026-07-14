import { useState, useEffect } from 'react';
import { apiCall } from '../utils/apiCall';
import { MapPin, Search, Mail, MessageCircle, User, FileText, Scale, ClipboardCheck } from 'lucide-react';

// Fase B — Monitoramento 360º do cliente (admin/analista).
// Busca um usuário e mostra: perfil + último acesso, intenção (triagem), os 3
// relatórios (quantos gerou + últimos imóveis), buscas recentes e chamados,
// com atalhos de contato (e-mail / WhatsApp). Dados via /api/admin-usuario-360.

const dataBR = (s) => { try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return '—'; } };
const dataHoraBR = (s) => { try { return new Date(s).toLocaleString('pt-BR'); } catch { return '—'; } };
const diasAtras = (s) => { try { return Math.floor((Date.now() - new Date(s).getTime()) / 86400000); } catch { return null; } };
const brl = (v) => (v == null ? null : `R$ ${Number(v).toLocaleString('pt-BR')}`);

const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 };
const label = { fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 };

function StatusChip({ status }) {
  const c = status === 'concluida' ? { bg: '#dcfce7', fg: '#15803d' }
    : status === 'erro' ? { bg: '#fee2e2', fg: '#b91c1c' }
    : { bg: '#e0e7ff', fg: '#3730a3' };
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: c.bg, color: c.fg }}>{status || '—'}</span>;
}

function RelatorioCard({ icone: Icone, nome, dados }) {
  const d = dados || { total: 0, concluidas: 0, latest: [] };
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icone size={16} color="#0D63DB" />
        <div style={{ fontSize: 13, fontWeight: 800, color: '#111' }}>{nome}</div>
      </div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
        <div><div style={{ fontSize: 22, fontWeight: 900, color: '#111' }}>{d.total || 0}</div><div style={label}>gerados</div></div>
        <div><div style={{ fontSize: 22, fontWeight: 900, color: '#15803d' }}>{d.concluidas ?? 0}</div><div style={label}>concluídos</div></div>
      </div>
      {(d.latest || []).length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {d.latest.map((r, i) => (
            <div key={i} style={{ fontSize: 11.5, color: '#334155', display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: i ? '1px solid #f1f5f9' : 'none', paddingTop: i ? 5 : 0 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.titulo || `${r.cidade || '—'}${r.estado ? '/' + r.estado : ''}`}{r.arrematado ? ' 🏆' : ''}
              </span>
              <span style={{ flexShrink: 0, color: '#94a3b8' }}>{dataBR(r.created_at)}</span>
            </div>
          ))}
        </div>
      ) : <div style={{ fontSize: 11.5, color: '#94a3b8' }}>Nenhum ainda.</div>}
    </div>
  );
}

export default function Cliente360() {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  // Busca AO VIVO: já carrega a lista ao abrir (termo vazio) e filtra a cada dígito
  // (debounce de 300ms). Sem botão. 1 caractere é amplo demais → aguarda o 2º.
  useEffect(() => {
    const t = termo.trim();
    if (t.length === 1) return;
    const id = setTimeout(async () => {
      setBuscando(true); setErro(''); setDados(null);
      try {
        const r = await apiCall(`/api/admin-usuario-360?q=${encodeURIComponent(t)}`);
        const j = await r.json();
        setResultados(Array.isArray(j) ? j : []);
      } catch { setErro('Falha na busca.'); } finally { setBuscando(false); }
    }, 300);
    return () => clearTimeout(id);
  }, [termo]);

  const abrir = async (u) => {
    setCarregando(true); setErro(''); setResultados(null);
    try {
      const r = await apiCall(`/api/admin-usuario-360?user_id=${encodeURIComponent(u.id)}`);
      const j = await r.json();
      if (j?.error) setErro(j.error); else setDados({ ...j, _busca: u });
    } catch { setErro('Falha ao carregar o cliente.'); } finally { setCarregando(false); }
  };

  const p = dados?.perfil || {};
  const a = dados?.auth || {};
  const email = a.email || '';
  const tel = (p.telefone || '').replace(/\D/g, '');
  const waNum = tel ? (tel.startsWith('55') ? tel : `55${tel}`) : '';
  const intencao = [
    p.perfil_investidor && ['Perfil', p.perfil_investidor],
    p.faixa_capital && ['Capital', p.faixa_capital],
    p.forma_pagamento && ['Pagamento', p.forma_pagamento],
    p.experiencia_leilao && ['Experiência', p.experiencia_leilao],
    p.consorcio_interesse && ['Consórcio', p.consorcio_interesse],
  ].filter(Boolean);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}><User size={20} /> 360º do Cliente</div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Acompanhe o que cada usuário está gerando, buscando e conversando — e contate direto.</div>
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
        <input value={termo} onChange={(e) => setTermo(e.target.value)} autoFocus placeholder="Filtrar por nome, e-mail, telefone ou CPF…"
          style={{ width: '100%', padding: '11px 14px 11px 38px', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 14, boxSizing: 'border-box' }} />
        {buscando && <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#94a3b8' }}>filtrando…</span>}
      </div>

      {erro && <div style={{ ...card, background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' }}>{erro}</div>}

      {resultados && (
        resultados.length === 0
          ? <div style={{ ...card, color: '#64748b' }}>Nenhum usuário encontrado.</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>{resultados.length} usuário(s){resultados.length >= 200 ? '+ (refine a busca para ver mais)' : ''}</div>
              {resultados.map((u) => (
                <button key={u.id} onClick={() => abrir(u)} style={{ ...card, textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{u.nome || '(sem nome)'}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{u.email}{u.telefone ? ` · ${u.telefone}` : ''}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#0D63DB', flexShrink: 0, background: '#eff6ff', padding: '3px 10px', borderRadius: 20 }}>{u.plano_label || u.role || '—'}</span>
                </button>
              ))}
            </div>
      )}

      {carregando && <div style={{ ...card, color: '#64748b' }}>Carregando…</div>}

      {dados && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Cabeçalho do cliente + contato */}
          <div style={{ ...card, background: '#111', color: 'white', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{p.nome || '(sem nome)'}</div>
              <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 2 }}>{email}{p.telefone ? ` · ${p.telefone}` : ''}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                {p.role} · plano {p.plano || '—'} · {p.ativo ? 'ativo' : 'inativo'}
                {p.inadimplente_desde ? ' · ⚠ inadimplente' : ''}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                Último acesso: {a.last_sign_in_at ? `${dataHoraBR(a.last_sign_in_at)} (${diasAtras(a.last_sign_in_at)}d atrás)` : '—'} · cadastro {dataBR(a.created_at)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {email && <a href={`mailto:${email}`} style={{ padding: '8px 14px', background: '#0D63DB', color: 'white', borderRadius: 8, fontWeight: 700, fontSize: 12, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}><Mail size={14} /> E-mail</a>}
              {waNum
                ? <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer" style={{ padding: '8px 14px', background: '#25D366', color: 'white', borderRadius: 8, fontWeight: 700, fontSize: 12, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}><MessageCircle size={14} /> WhatsApp</a>
                : <span style={{ padding: '8px 14px', background: '#334155', color: '#94a3b8', borderRadius: 8, fontWeight: 700, fontSize: 12 }}>Sem telefone</span>}
            </div>
          </div>

          {/* Intenção (triagem) */}
          {(intencao.length > 0 || p.cidades_interesse) && (
            <div style={card}>
              <div style={{ ...label, marginBottom: 8 }}>Intenção / perfil de investidor</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {intencao.map(([k, v]) => (
                  <span key={k} style={{ fontSize: 12, background: '#f1f5f9', borderRadius: 8, padding: '5px 10px', color: '#334155' }}><b>{k}:</b> {v}</span>
                ))}
                {p.cidades_interesse && <span style={{ fontSize: 12, background: '#f1f5f9', borderRadius: 8, padding: '5px 10px', color: '#334155' }}><b>Cidades:</b> {Array.isArray(p.cidades_interesse) ? p.cidades_interesse.join(', ') : String(p.cidades_interesse)}</span>}
              </div>
            </div>
          )}

          {/* Relatórios (os 3) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <RelatorioCard icone={FileText} nome="Mercadológico" dados={dados.relatorios?.mercado} />
            <RelatorioCard icone={Scale} nome="Documental / Jurídico" dados={dados.relatorios?.documental} />
            <RelatorioCard icone={ClipboardCheck} nome="Conclusão / Laudo" dados={dados.relatorios?.laudo} />
          </div>

          {/* Imóveis que visualizou (abriu a ficha, ainda sem analisar) */}
          <div style={card}>
            <div style={{ ...label, marginBottom: 8 }}>Imóveis que visualizou ({(dados.vistos || []).length})</div>
            {(dados.vistos || []).length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>Nenhuma visualização registrada ainda.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {dados.vistos.map((v, i) => (
                  <div key={v.imovel_id || i} style={{ fontSize: 12, color: '#334155', display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: i ? '1px solid #f1f5f9' : 'none', paddingTop: i ? 5 : 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.titulo || `${v.tipo || 'Imóvel'} · ${[v.cidade, v.estado].filter(Boolean).join('/') || '—'}`}
                      {v.valor ? <span style={{ color: '#059669' }}> · {brl(v.valor)}</span> : ''}
                      {v.vezes > 1 ? <span style={{ color: '#0D63DB', fontWeight: 700 }}> · {v.vezes}×</span> : ''}
                    </span>
                    <span style={{ flexShrink: 0, color: '#94a3b8' }}>{dataBR(v.visto_em)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Buscas recentes (intenções) */}
          <div style={card}>
            <div style={{ ...label, marginBottom: 8 }}>Buscas recentes ({(dados.buscas || []).length})</div>
            {(dados.buscas || []).length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>Nenhuma busca registrada.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {dados.buscas.map((b, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#334155', display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: i ? '1px solid #f1f5f9' : 'none', paddingTop: i ? 5 : 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                      <MapPin size={11} color="#94a3b8" />
                      {[b.cidade, b.estado].filter(Boolean).join('/') || 'Brasil'}
                      {b.tipo_imovel ? ` · ${b.tipo_imovel}` : ''}
                      {(brl(b.valor_min) || brl(b.valor_max)) ? ` · ${brl(b.valor_min) || '0'}–${brl(b.valor_max) || '∞'}` : ''}
                      {b.desconto_min ? ` · desc ≥${b.desconto_min}%` : ''}
                      {Array.isArray(b.pagamento_tipos) && b.pagamento_tipos.length ? ` · ${b.pagamento_tipos.join(',')}` : ''}
                      <span style={{ color: '#94a3b8' }}>· {b.resultados_count ?? 0} result.</span>
                    </span>
                    <span style={{ flexShrink: 0, color: '#94a3b8' }}>{dataBR(b.criado_em)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Chamados */}
          <div style={card}>
            <div style={{ ...label, marginBottom: 8 }}>Chamados de atendimento ({(dados.chamados || []).length})</div>
            {(dados.chamados || []).length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>Nenhum chamado.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dados.chamados.map((c) => (
                  <div key={c.id} style={{ fontSize: 12.5, color: '#334155', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span>{c.titulo || '(sem título)'} {c.atendente_nome ? <span style={{ color: '#94a3b8' }}>· {c.atendente_nome}</span> : ''}</span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}><StatusChip status={c.status} /><span style={{ color: '#94a3b8' }}>{dataBR(c.criado_em)}</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
