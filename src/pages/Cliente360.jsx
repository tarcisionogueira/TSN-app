import { useState, useEffect } from 'react';
import { apiCall } from '../utils/apiCall';
import { MapPin, Search, Mail, MessageCircle, User, FileText, Scale, ClipboardCheck, AlertTriangle } from 'lucide-react';

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

// Rótulo amigável do plano (o tier real fica no role; o campo `plano` = status de pagamento).
const PLANO_LABEL = { top2: 'Investidor Pro', assessorado: 'Assessoria', clube: 'Leilão Club', explorador: 'Explorador', admin: 'Admin', consultor: 'Consultor', analista: 'Analista', advogado: 'Advogado' };
const planoLabel = (role) => PLANO_LABEL[role] || role || '—';
const fmtCidades = (v) => Array.isArray(v)
  ? v.map((c) => (c && typeof c === 'object') ? `${c.cidade || ''}${c.uf ? '/' + c.uf : ''}${c.raio_km ? ` (${c.raio_km}km)` : ''}` : String(c)).filter(Boolean).join(', ')
  : String(v || '');

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
        {((d.com_erro || 0) + (d.vazias || 0)) > 0 && (
          <div><div style={{ fontSize: 22, fontWeight: 900, color: '#dc2626' }}>{(d.com_erro || 0) + (d.vazias || 0)}</div><div style={label}>{(d.vazias || 0) > 0 ? 'vazio/erro' : 'com erro'}</div></div>
        )}
      </div>
      {(d.latest || []).length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {d.latest.map((r, i) => (
            <div key={i} style={{ fontSize: 11.5, color: '#334155', display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: i ? '1px solid #f1f5f9' : 'none', paddingTop: i ? 5 : 0 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.titulo || `${r.cidade || '—'}${r.estado ? '/' + r.estado : ''}`}{r.arrematado ? ' 🏆' : ''}
              </span>
              <span style={{ flexShrink: 0, color: '#94a3b8' }}>{dataHoraBR(r.created_at)}</span>
            </div>
          ))}
        </div>
      ) : <div style={{ fontSize: 11.5, color: '#94a3b8' }}>Nenhum ainda.</div>}
    </div>
  );
}

const PERFIS = [
  { v: '', label: 'Todos os perfis' },
  { v: 'uso_proprio', label: 'Uso próprio' },
  { v: 'revenda', label: 'Revenda (flip)' },
  { v: 'locacao', label: 'Locação (renda)' },
];
// Filtro de ACESSO: última atividade (login OU busca OU imóvel visto OU relatório) na janela.
const JANELA_ACESSO = 14; // dias
const ACESSOS = [
  { v: '', label: 'Todos' },
  { v: 'acessando', label: `Acessando (${JANELA_ACESSO}d)` },
  { v: 'nao_acessando', label: 'Sem acesso' },
];
const PERFIL_LABEL = { uso_proprio: 'Uso próprio', revenda: 'Revenda', locacao: 'Locação' };

// Rótulo amigável do tipo de e-mail (histórico gravado a partir de agora).
const EMAIL_TIPO_LABEL = { oportunidades: 'Oportunidades', boas_vindas: 'Boas-vindas', contrato: 'Contrato', juridico: 'Jurídico', renovacao: 'Renovação', financiamento: 'Financiamento' };
const emailTipoLabel = (t) => EMAIL_TIPO_LABEL[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'E-mail');

export default function Cliente360() {
  const [termo, setTermo] = useState('');
  const [perfilFiltro, setPerfilFiltro] = useState('');
  const [acessoFiltro, setAcessoFiltro] = useState('');
  const [resolvendo, setResolvendo] = useState(false);
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [stats, setStats] = useState(null);
  const [aprend, setAprend] = useState(null);   // corpus de aprendizado dos arremates
  const [importando, setImportando] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const [verInteresses, setVerInteresses] = useState(false); // interesses gerados sob demanda

  // Estatísticas (triagem) — carrega uma vez ao abrir a tela.
  useEffect(() => {
    apiCall('/api/admin-usuario-360?stats=1').then((r) => r.json()).then((j) => { if (j && !j.error) setStats(j); }).catch(() => {});
    apiCall('/api/arremate-aprendizado').then((r) => r.json()).then((j) => { if (j && !j.error) setAprend(j); }).catch(() => {});
  }, []);

  // Busca AO VIVO: já carrega a lista ao abrir (termo vazio) e filtra a cada dígito
  // (debounce de 300ms) e ao trocar o filtro de perfil. Sem botão.
  // Monta a URL de busca com os filtros ativos (perfil + acesso).
  const urlBusca = (t) => `/api/admin-usuario-360?q=${encodeURIComponent(t)}`
    + (perfilFiltro ? `&perfil=${perfilFiltro}` : '')
    + (acessoFiltro ? `&acesso=${acessoFiltro}&janela=${JANELA_ACESSO}` : '');

  useEffect(() => {
    const t = termo.trim();
    if (t.length === 1) return;
    const id = setTimeout(async () => {
      setBuscando(true); setErro(''); setDados(null);
      try {
        const r = await apiCall(urlBusca(t));
        const j = await r.json();
        // Distingue FALHA (erro/HTTP não-ok) de resultado VAZIO — antes, uma falha do
        // backend virava "Nenhum usuário encontrado" (a busca parecia zerada à toa).
        if (!r.ok || j?.error || !Array.isArray(j)) { setErro(j?.error || 'Falha na busca.'); setResultados([]); }
        else setResultados(j);
      } catch { setErro('Falha na busca.'); } finally { setBuscando(false); }
    }, 300);
    return () => clearTimeout(id);
  }, [termo, perfilFiltro, acessoFiltro]); // eslint-disable-line

  const abrir = async (u) => {
    // NÃO apaga a lista antes de carregar — se o detalhe falhar, o admin não fica num
    // beco sem saída (lista sumia e só restava a busca). Só troca de tela no sucesso.
    setCarregando(true); setErro('');
    try {
      const r = await apiCall(`/api/admin-usuario-360?user_id=${encodeURIComponent(u.id)}`);
      const j = await r.json();
      if (!r.ok || j?.error) setErro(j?.error || 'Falha ao carregar o cliente.');
      else { setResultados(null); setDados({ ...j, _busca: u }); }
    } catch { setErro('Falha ao carregar o cliente.'); } finally { setCarregando(false); }
  };

  // Volta do 360 do cliente para a lista (recarrega com o termo atual).
  const voltar = () => {
    setDados(null); setErro(''); setBuscando(true); setImportMsg(null);
    apiCall(urlBusca(termo.trim()))
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!ok || j?.error || !Array.isArray(j)) { setErro(j?.error || 'Falha na busca.'); setResultados([]); } else setResultados(j); })
      .catch(() => setErro('Falha na busca.'))
      .finally(() => setBuscando(false));
  };

  // Marca os erros do cliente aberto como resolvidos → limpa a tag "erro" na lista.
  const resolverErros = async () => {
    const uid = dados?._busca?.id || dados?.perfil?.id;
    if (!uid || resolvendo) return;
    setResolvendo(true);
    try {
      const r = await apiCall('/api/admin-usuario-360', { method: 'POST', body: JSON.stringify({ acao: 'resolver_erros', user_id: uid }) });
      const j = await r.json();
      if (r.ok && j?.ok) { if (dados?._busca) await abrir(dados._busca); }
    } catch { /* silencioso */ } finally { setResolvendo(false); }
  };

  // Gera o DOSSIÊ do cliente (aceites/datas + indicações + saques + relatórios + atividade)
  // numa janela imprimível → o admin "Salvar em PDF" para uma eventual ocorrência jurídica.
  const gerarDossie = () => {
    if (!dados) return;
    const pf = dados.perfil || {}, au = dados.auth || {}, par = dados.parceria || {}, fin = dados.financeiro || {}, rel = dados.relatorios || {};
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const brlv = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dt = (s) => { try { return s ? new Date(s).toLocaleString('pt-BR') : '—'; } catch { return '—'; } };
    const dta = (s) => { try { return s ? new Date(s).toLocaleDateString('pt-BR') : '—'; } catch { return '—'; } };
    const emitido = new Date().toLocaleString('pt-BR');
    const linhasFin = (fin.lancamentos || []).map(l => `<tr><td>${dt(l.criado_em)}</td><td>${esc(l.tipo)}</td><td>${esc(l.descricao || '')}</td><td style="text-align:right">${brlv(l.valor)}</td><td>${esc(l.status)}</td></tr>`).join('');
    const linhasDir = (par.diretos || []).map(x => `<tr><td>${esc(x.nome || '—')}</td><td>${esc(x.role || '')}</td><td>${x.parceiro_aceite_em ? 'aderiu ' + dta(x.parceiro_aceite_em) : 'não aderiu'}</td><td>${dta(x.created_at)}</td></tr>`).join('');
    const atividade = (dados.atividade || []).slice(0, 60).map(a => `<tr><td>${dt(a.em || a.criado_em || a.data)}</td><td>${esc(a.tipo || a.evento || '')}</td><td>${esc(a.descricao || a.detalhe || a.motivo || '')}</td></tr>`).join('');
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Dossiê — ${esc(pf.nome || '')}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:12px;line-height:1.5}h1{font-size:18px;margin:0}h2{font-size:13px;border-bottom:2px solid #0D63DB;padding-bottom:4px;margin:22px 0 8px;color:#0D63DB}table{width:100%;border-collapse:collapse;margin-top:6px}th,td{border:1px solid #e2e8f0;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f1f5f9}.muted{color:#64748b}.kv{margin:2px 0}.box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px}@media print{.noprint{display:none}}</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:10px">
<div><h1>BidPro Brasil — Dossiê do Cliente</h1><div class="muted">Documento de uso interno / jurídico</div></div>
<div class="muted" style="text-align:right">Emitido em ${emitido}</div></div>
<h2>Identificação</h2><div class="box">
<div class="kv"><b>Nome:</b> ${esc(pf.nome || '—')}</div>
<div class="kv"><b>E-mail:</b> ${esc(au.email || '—')} &nbsp; <b>Telefone:</b> ${esc(pf.telefone || '—')}</div>
<div class="kv"><b>Plano:</b> ${esc(pf.role || '—')} &nbsp; <b>Status:</b> ${pf.ativo ? 'ativo' : 'inativo'}${pf.inadimplente_desde ? ' (inadimplente)' : ''}</div>
<div class="kv"><b>Cadastro:</b> ${dt(au.created_at)} &nbsp; <b>Último acesso:</b> ${dt(au.last_sign_in_at)}</div></div>
<h2>Programa de Parceiros — Termo de Adesão</h2><div class="box">
${par.aceite_em ? `<div class="kv"><b>Aderiu ao Programa em:</b> ${dt(par.aceite_em)} &nbsp; <b>Versão do termo:</b> ${esc(par.aceite_versao || '—')}</div>` : `<div class="kv">O usuário <b>NÃO</b> aderiu ao Programa de Parceiros.</div>`}
<div class="kv"><b>Indicado por:</b> ${par.indicado_por && par.indicado_por.nome ? esc(par.indicado_por.nome) : '—'}</div>
<div class="kv"><b>Indicados diretos:</b> ${par.diretos_total || 0}</div></div>
${(par.diretos || []).length ? `<table><thead><tr><th>Indicado</th><th>Plano</th><th>Aderiu ao termo</th><th>Cadastro</th></tr></thead><tbody>${linhasDir}</tbody></table>` : ''}
<h2>Financeiro — Comissões e Saques</h2><div class="box">
<div class="kv"><b>Saldo disponível:</b> ${brlv(fin.saldo)} &nbsp; <b>Total de comissões apuradas:</b> ${brlv(fin.comissoes_total)}</div></div>
${(fin.lancamentos || []).length ? `<table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th style="text-align:right">Valor</th><th>Status</th></tr></thead><tbody>${linhasFin}</tbody></table>` : '<div class="muted" style="margin-top:6px">Sem lançamentos financeiros.</div>'}
<h2>Relatórios gerados</h2><div class="box"><div class="kv"><b>Mercadológico:</b> ${rel.mercado?.total || 0} &nbsp; <b>Documental:</b> ${rel.documental?.total || 0} &nbsp; <b>Laudo:</b> ${rel.laudo?.total || 0}</div></div>
${atividade ? `<h2>Atividade recente</h2><table><thead><tr><th>Data</th><th>Evento</th><th>Detalhe</th></tr></thead><tbody>${atividade}</tbody></table>` : ''}
<div style="margin-top:26px;border-top:1px solid #e2e8f0;padding-top:8px" class="muted">Documento gerado automaticamente pela plataforma BidPro Brasil em ${emitido}. Uso restrito. Contém dados pessoais protegidos pela LGPD (Lei nº 13.709/2018) — tratar com confidencialidade.</div>
<div class="noprint" style="margin-top:16px"><button onclick="window.print()" style="padding:8px 16px;font-size:13px;cursor:pointer">Imprimir / Salvar em PDF</button></div>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { setErro('Permita pop-ups para gerar o dossiê em PDF.'); return; }
    w.document.write(html); w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* usuário imprime pelo botão */ } }, 500);
  };

  // Puxa o histórico do Resend p/ emails_log e recarrega o cliente aberto. É global
  // (não filtra por cliente — o Resend lista tudo), mas o efeito aparece na ficha.
  const importarResend = async () => {
    if (importando) return;
    setImportando(true); setImportMsg(null);
    try {
      const r = await apiCall('/api/importar-emails-resend', { method: 'POST' });
      const j = await r.json();
      if (!r.ok || j?.error) { setImportMsg({ ok: false, texto: j?.error || 'Falha ao importar.' }); return; }
      setImportMsg({ ok: true, texto: `${j.importados} novo(s) e-mail(s) importado(s) (${j.vistos} verificados no Resend).` });
      if (dados?._busca?.id) await abrir(dados._busca); // recarrega a ficha p/ mostrar os novos
    } catch { setImportMsg({ ok: false, texto: 'Falha ao importar.' }); }
    finally { setImportando(false); }
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

      {/* Filtros: perfil de investidor + acesso (acessando × sem acesso) */}
      {!dados && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PERFIS.map((op) => (
              <button key={op.v} onClick={() => setPerfilFiltro(op.v)}
                style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid',
                  background: perfilFiltro === op.v ? '#111' : '#fff', color: perfilFiltro === op.v ? '#fff' : '#475569',
                  borderColor: perfilFiltro === op.v ? '#111' : '#cbd5e1' }}>
                {op.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ ...label }}>Acesso:</span>
            {ACESSOS.map((op) => (
              <button key={op.v} onClick={() => setAcessoFiltro(op.v)}
                style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid',
                  background: acessoFiltro === op.v ? '#0D63DB' : '#fff', color: acessoFiltro === op.v ? '#fff' : '#475569',
                  borderColor: acessoFiltro === op.v ? '#0D63DB' : '#cbd5e1' }}>
                {op.label}
              </button>
            ))}
            <span style={{ fontSize: 11, color: '#94a3b8' }}>última atividade: login, busca, imóvel visto ou relatório</span>
          </div>
        </div>
      )}

      {/* Estatísticas (triagem do tipo de cliente) */}
      {!dados && stats && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...label }}>Estatísticas · triagem de clientes</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            {[
              ['Clientes', stats.total_clientes, '#0D63DB'],
              ['Sem perfil', stats.sem_perfil, stats.sem_perfil > 0 ? '#d97706' : '#059669'],
              ['Buscas', stats.buscas_total, '#7c3aed'],
              ['Imóveis vistos', stats.vistos_total, '#0891b2'],
              ['Relat. mercado', stats.relatorios?.mercado, '#059669'],
              ['Relat. documental', stats.relatorios?.documental, '#059669'],
              ['Relat. laudo', stats.relatorios?.laudo, '#059669'],
              ['Clientes c/ erro', stats.clientes_com_erro, stats.clientes_com_erro > 0 ? '#dc2626' : '#059669'],
              ['Relat. falha (24h)', stats.relatorios_falha_24h, stats.relatorios_falha_24h > 0 ? '#dc2626' : '#059669'],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: c }}>{v ?? 0}</div>
                <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ ...label, marginBottom: 5 }}>Por perfil de investidor</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(stats.por_perfil || {}).map(([k, n]) => (
                  <span key={k} style={{ fontSize: 12, background: '#ede9fe', color: '#5b21b6', borderRadius: 8, padding: '4px 9px', fontWeight: 600 }}>{PERFIL_LABEL[k] || k}: <b>{n}</b></span>
                ))}
              </div>
            </div>
            <div>
              <div style={{ ...label, marginBottom: 5 }}>Por plano</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(stats.por_plano || {}).map(([k, n]) => (
                  <span key={k} style={{ fontSize: 12, background: '#eff6ff', color: '#0D63DB', borderRadius: 8, padding: '4px 9px', fontWeight: 600 }}>{planoLabel(k)}: <b>{n}</b></span>
                ))}
              </div>
            </div>
          </div>
          {(stats.top_cidades?.length > 0 || stats.top_tipos?.length > 0) && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {stats.top_cidades?.length > 0 && (
                <div><div style={{ ...label, marginBottom: 5 }}>Cidades mais buscadas</div>
                  <div style={{ fontSize: 12, color: '#334155' }}>{stats.top_cidades.map((c) => `${c.cidade} (${c.n})`).join(' · ')}</div></div>
              )}
              {stats.top_tipos?.length > 0 && (
                <div><div style={{ ...label, marginBottom: 5 }}>Tipos mais buscados</div>
                  <div style={{ fontSize: 12, color: '#334155' }}>{stats.top_tipos.map((t) => `${t.tipo_imovel} (${t.n})`).join(' · ')}</div></div>
              )}
            </div>
          )}
          {/* FALHAS DE RELATÓRIO (24h) — o que quebrou, em qual cidade e POR QUÊ (causa da API).
              Torna visível de relance uma falha como a de hoje (BH/Goiânia, busca abortada). */}
          {stats.falhas_recentes?.length > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ ...label, marginBottom: 6, color: '#b91c1c' }}>Relatórios que falharam (24h) — {stats.relatorios_falha_24h} evento(s) · o que quebrou e por quê</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {stats.falhas_recentes.map((f, i) => {
                  const evRot = { relatorio_mercado_vazio: 'Mercado vazio', relatorio_mercado_erro: 'Erro mercado', relatorio_documental_erro: 'Erro documental', relatorio_documental_faltam_docs: 'Faltam docs', relatorio_laudo_erro: 'Erro laudo' }[f.evento] || f.evento;
                  return (
                    <div key={i} style={{ fontSize: 11.5, color: '#7f1d1d', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        <b>{f.n}×</b> {evRot}{f.cidade ? ` · ${f.cidade}` : ''} · <span style={{ color: '#b45309' }}>{f.motivo}</span>
                      </span>
                      <span style={{ flexShrink: 0, color: '#94a3b8' }}>{dataHoraBR(f.ultimo)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Aprendizado da IA a partir dos arremates reais (previsto × realizado) */}
      {!dados && aprend && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...label }}>Aprendizado da IA · arremates reais</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#0D63DB' }}>{aprend.total ?? 0}</div>
              <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>arremates no corpus</div>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#059669' }}>{aprend.com_assertividade ?? 0}</div>
              <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>já calibrando a IA</div>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#7c3aed' }}>{(aprend.itens || []).filter((x) => x.realizado?.juridico?.encerrado).length}</div>
              <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>desembaraços concluídos (CNJ)</div>
            </div>
          </div>
          {(aprend.resumo || []).length === 0 ? (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Ainda sem assertividade calculada. Conforme os arremates atribuídos geram relatórios e registram revenda/aluguel/desfecho, a IA passa a se calibrar por modalidade aqui.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {aprend.resumo.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: '#334155', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: i ? '1px solid #f1f5f9' : 'none', paddingTop: i ? 6 : 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#5b21b6', background: '#ede9fe', padding: '3px 8px', borderRadius: 20 }}>
                    {s.modalidade || 'n/d'}{s.tipo_aquisicao ? ` · ${s.tipo_aquisicao}` : ''} · {s.n}
                  </span>
                  {s.desconto_real_pct_med != null && <span>desconto real médio <b>{s.desconto_real_pct_med}%</b></span>}
                  {s.valor_delta_pct_med != null && <span>· mercado {s.valor_delta_pct_med > 0 ? '+' : ''}{s.valor_delta_pct_med}% vs revenda</span>}
                  {s.locacao_delta_pct_med != null && <span>· aluguel {s.locacao_delta_pct_med > 0 ? '+' : ''}{s.locacao_delta_pct_med}% vs real</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
                    {(() => {
                      const d = u.ultima_atividade ? diasAtras(u.ultima_atividade) : null;
                      const ativo = d != null && d <= JANELA_ACESSO;
                      return (
                        <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2, color: ativo ? '#059669' : '#94a3b8' }}>
                          {d == null ? '○ nunca acessou' : ativo ? `● ativo · há ${d === 0 ? 'menos de 1 dia' : d + 'd'}` : `○ sem acesso · há ${d}d`}
                        </div>
                      );
                    })()}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {u.tem_erro && <span title="Tem erro de navegação em aberto" style={{ fontSize: 10.5, fontWeight: 700, color: '#b91c1c', background: '#fee2e2', padding: '3px 8px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 3 }}><AlertTriangle size={11} /> erro</span>}
                    {u.perfil_investidor
                      ? <span style={{ fontSize: 10.5, fontWeight: 700, color: '#5b21b6', background: '#ede9fe', padding: '3px 8px', borderRadius: 20 }}>{PERFIL_LABEL[u.perfil_investidor] || u.perfil_investidor}</span>
                      : <span style={{ fontSize: 10.5, fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '3px 8px', borderRadius: 20 }}>sem perfil</span>}
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#0D63DB', background: '#eff6ff', padding: '3px 10px', borderRadius: 20 }}>{u.plano_label || u.role || '—'}</span>
                  </div>
                </button>
              ))}
            </div>
      )}

      {carregando && <div style={{ ...card, color: '#64748b' }}>Carregando…</div>}

      {dados && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <button onClick={voltar} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, background: 'white', border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
            ← Voltar para a lista
          </button>
          {/* Cabeçalho do cliente + contato */}
          <div style={{ ...card, background: '#111', color: 'white', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{p.nome || '(sem nome)'}</div>
              <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 2 }}>{email}{p.telefone ? ` · ${p.telefone}` : ''}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                <span style={{ background: '#1e293b', color: '#93c5fd', fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>{planoLabel(p.role)}</span>
                {' · '}{p.ativo ? 'ativo' : 'inativo'}
                {p.inadimplente_desde ? ' · ⚠ inadimplente' : ''}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                Último acesso: {a.last_sign_in_at ? `${dataHoraBR(a.last_sign_in_at)} (${diasAtras(a.last_sign_in_at)}d atrás)` : '—'} · cadastro {dataBR(a.created_at)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <button onClick={gerarDossie} title="Gera o dossiê (aceites, indicações, saques, relatórios) para salvar em PDF"
                style={{ padding: '8px 14px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={14} /> Dossiê (PDF)</button>
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
                {p.cidades_interesse && <span style={{ fontSize: 12, background: '#f1f5f9', borderRadius: 8, padding: '5px 10px', color: '#334155' }}><b>Cidades:</b> {fmtCidades(p.cidades_interesse)}</span>}
              </div>
            </div>
          )}

          {/* Parceria & Financeiro — trilho jurídico (aceite do termo, indicações, saques) */}
          {(() => {
            const par = dados.parceria || {}, fin = dados.financeiro || {};
            const brlv = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            return (
              <div style={card}>
                <div style={{ ...label, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><Scale size={13} /> Parceria & financeiro (trilho jurídico)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
                  <div style={{ background: '#faf5ff', border: '1px solid #ede9fe', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10.5, color: '#7c3aed', fontWeight: 700 }}>ADESÃO AO PROGRAMA</div>
                    <div style={{ fontSize: 12.5, color: '#334155', marginTop: 2 }}>{par.aceite_em ? `✓ em ${dataHoraBR(par.aceite_em)}` : 'não aderiu'}</div>
                    {par.aceite_versao && <div style={{ fontSize: 10.5, color: '#94a3b8' }}>termo {par.aceite_versao}</div>}
                  </div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>INDICAÇÕES</div>
                    <div style={{ fontSize: 12.5, color: '#334155', marginTop: 2 }}>{par.diretos_total || 0} direto(s)</div>
                    <div style={{ fontSize: 10.5, color: '#94a3b8' }}>indicado por: {par.indicado_por?.nome || '—'}</div>
                  </div>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10.5, color: '#16a34a', fontWeight: 700 }}>SALDO</div>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#111', marginTop: 2 }}>{brlv(fin.saldo)}</div>
                    <div style={{ fontSize: 10.5, color: '#94a3b8' }}>comissões: {brlv(fin.comissoes_total)}</div>
                  </div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>LANÇAMENTOS</div>
                    <div style={{ fontSize: 12.5, color: '#334155', marginTop: 2 }}>{(fin.lancamentos || []).length} registro(s)</div>
                    <div style={{ fontSize: 10.5, color: '#94a3b8' }}>comissões e saques</div>
                  </div>
                </div>
                <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 8 }}>Use “Dossiê (PDF)” no topo para exportar o registro completo (aceites, indicações, saques, relatórios e atividade).</div>
              </div>
            );
          })()}

          {/* Filtros salvos — o que o cliente monitora (características do imóvel que busca) */}
          <div style={card}>
            <div style={{ ...label, marginBottom: 8 }}>Filtros salvos ({(dados.filtros_salvos || []).length}) — imóveis que procura</div>
            {(dados.filtros_salvos || []).length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>Nenhum filtro salvo. {p.perfil_investidor ? '' : '(Cliente ainda sem perfil respondido.)'}</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dados.filtros_salvos.map((fs, i) => {
                  const f = fs.filtros || {};
                  const tags = [
                    (Array.isArray(f.cidades) && f.cidades.length) ? `📍 ${fmtCidades(f.cidades)}` : (f.estado ? `📍 ${f.estado}` : null),
                    (Array.isArray(f.tipos) && f.tipos.length) ? `🏠 ${f.tipos.join(', ')}` : null,
                    (Array.isArray(f.modalidades) && f.modalidades.length) ? `⚖ ${f.modalidades.join(', ')}` : null,
                    (f.valorMin || f.valorMax) ? `R$ ${f.valorMin || '0'}–${f.valorMax || '∞'}` : null,
                    f.descontoMin ? `desc ≥${f.descontoMin}%` : null,
                    (Array.isArray(f.bairros) && f.bairros.length) ? `bairros: ${f.bairros.join(', ')}` : null,
                  ].filter(Boolean);
                  return (
                    <div key={i} style={{ borderTop: i ? '1px solid #f1f5f9' : 'none', paddingTop: i ? 8 : 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 4 }}>{fs.nome || `Filtro ${i + 1}`}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {tags.length ? tags.map((t, j) => <span key={j} style={{ fontSize: 11.5, background: '#f1f5f9', color: '#334155', borderRadius: 8, padding: '3px 9px' }}>{t}</span>)
                          : <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Sem critérios específicos.</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

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
                    <span style={{ flexShrink: 0, color: '#94a3b8' }}>{dataHoraBR(v.visto_em)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Atividade recente (log de movimentos — diagnóstico; validade 90 dias) */}
          <div style={card}>
            <div style={{ ...label, marginBottom: 8 }}>Atividade recente ({(dados.atividade || []).length}) — diagnóstico (últimos 90 dias)</div>
            {(dados.atividade || []).length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>Sem movimentos registrados.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {dados.atividade.map((a, i) => {
                  const ev = a.evento || '';
                  const ehErro = /erro$/.test(ev);
                  const ehPendencia = /(vazio|faltam_docs)$/.test(ev);
                  const cor = ehErro ? '#dc2626' : (ehPendencia ? '#b45309' : '#059669');
                  const rot = {
                    relatorio_mercado_ok: 'Relatório mercadológico', relatorio_mercado_vazio: 'Mercado não estimado', relatorio_mercado_erro: 'Erro no relatório mercadológico',
                    relatorio_documental_ok: 'Relatório documental', relatorio_documental_erro: 'Erro no documental', relatorio_documental_faltam_docs: 'Documental: faltam documentos',
                    relatorio_laudo_ok: 'Laudo / conclusão', relatorio_laudo_erro: 'Erro no laudo',
                    arremate: 'Arremate sinalizado', revenda: 'Revenda sinalizada',
                  }[ev] || ev;
                  // Diagnóstico (o que o dono pediu: PORQUÊ · FONTE · IMPACTO · qual imóvel) —
                  // vem do meta do log; só surfaça quando é FALHA/pendência (não polui os OK).
                  const m = a.meta || {};
                  const diag = [];
                  if (ehErro || ehPendencia) {
                    if (m.erroApi) diag.push(`Causa: ${String(m.erroApi).slice(0, 90)}`);
                    if (m.fonte) diag.push(`Fonte: ${m.fonte}`);
                    if (m.comparaveis != null) diag.push(`Comparáveis: ${m.comparaveis}`);
                    if (m.cidade) diag.push(`Cidade: ${m.cidade}`);
                    if (m.imovelId) diag.push(`Imóvel: ${String(m.imovelId).slice(0, 8)}`);
                  }
                  return (
                    <div key={i} style={{ fontSize: 12, color: '#334155', borderTop: i ? '1px solid #f1f5f9' : 'none', paddingTop: i ? 5 : 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                          <span style={{ color: cor, fontWeight: 700 }}>{rot}</span>
                          {a.detalhe ? <span style={{ color: '#64748b' }}> · {a.detalhe}</span> : ''}
                        </span>
                        <span style={{ flexShrink: 0, color: '#94a3b8' }}>{dataHoraBR(a.criado_em)}</span>
                      </div>
                      {diag.length > 0 && <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2, whiteSpace: 'normal' }}>{diag.join(' · ')}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Navegação e cliques (clickstream) — o que o usuário fez no site; diagnóstico de falhas */}
          <div style={card}>
            <div style={{ ...label, marginBottom: 8 }}>Navegação e cliques ({(dados.navegacao || []).length}) — diagnóstico (últimos 30 dias)</div>
            {(dados.navegacao || []).length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>Sem navegação registrada ainda.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 320, overflowY: 'auto' }}>
                {dados.navegacao.map((n, i) => {
                  const meta = { pageview: { rot: 'Tela', cor: '#64748b' }, click: { rot: 'Clique', cor: '#0D63DB' }, api_erro: { rot: 'Falha API', cor: '#dc2626' }, api_vazio: { rot: 'Sem resultado', cor: '#b45309' } }[n.tipo] || { rot: n.tipo, cor: '#64748b' };
                  return (
                    <div key={i} style={{ fontSize: 12, color: '#334155', display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: i ? '1px solid #f1f5f9' : 'none', paddingTop: i ? 5 : 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        <span style={{ color: meta.cor, fontWeight: 700 }}>{meta.rot}</span>
                        {n.alvo ? <span> · {n.alvo}</span> : ''}
                        {n.rota ? <span style={{ color: '#94a3b8' }}> · {n.rota}</span> : ''}
                        {n.detalhe ? <span style={{ color: '#b45309' }}> · {n.detalhe}</span> : ''}
                      </span>
                      <span style={{ flexShrink: 0, color: '#94a3b8' }}>{dataHoraBR(n.criado_em)}</span>
                    </div>
                  );
                })}
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
                    <span style={{ flexShrink: 0, color: '#94a3b8' }}>{dataHoraBR(b.criado_em)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Erros de navegação — telas de erro / inconsistências que o cliente bateu
              (window.onerror / unhandledrejection / ErrorBoundary → erros_cliente). */}
          <div style={card}>
            <div style={{ ...label, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <AlertTriangle size={12} color={dados.erros_abertos > 0 ? '#dc2626' : '#94a3b8'} />
              Erros de navegação ({(dados.erros || []).length}){dados.erros_abertos > 0 ? ` · ${dados.erros_abertos} aberto(s)` : ''}
              {dados.erros_abertos > 0 && (
                <button onClick={resolverErros} disabled={resolvendo}
                  style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 11, fontWeight: 700, cursor: resolvendo ? 'default' : 'pointer' }}>
                  {resolvendo ? 'Resolvendo…' : '✓ Marcar como resolvidos'}
                </button>
              )}
            </div>
            {(dados.erros || []).length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>Nenhum erro registrado — navegação sem incidentes.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dados.erros.map((e, i) => (
                  <div key={i} style={{ borderTop: i ? '1px solid #f1f5f9' : 'none', paddingTop: i ? 6 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: e.resolvido ? '#64748b' : '#b91c1c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.msg || '(erro sem mensagem)'}
                      </span>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                        {e.ocorrencias > 1 && <span style={{ fontSize: 10, fontWeight: 700, color: '#0D63DB' }}>{e.ocorrencias}×</span>}
                        {e.resolvido
                          ? <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#dcfce7', color: '#15803d' }}>resolvido</span>
                          : <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#fee2e2', color: '#b91c1c' }}>aberto</span>}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.rota || '—'}</span>
                      <span style={{ flexShrink: 0 }}>{dataHoraBR(e.ultima_em)}</span>
                    </div>
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
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}><StatusChip status={c.status} /><span style={{ color: '#94a3b8' }}>{dataHoraBR(c.criado_em)}</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* E-mails recebidos (histórico) — importável do Resend + registrado nos envios */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ ...label, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 0 }}>
                <Mail size={12} color="#0D63DB" /> E-mails recebidos ({dados.emails_total ?? (dados.emails || []).length})
              </div>
              <button onClick={importarResend} disabled={importando}
                title="Puxa do Resend os e-mails ainda disponíveis e grava no histórico"
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: importando ? '#f1f5f9' : '#eff6ff', color: importando ? '#94a3b8' : '#0D63DB', border: '1px solid #dbeafe', borderRadius: 8, padding: '5px 10px', fontSize: 11.5, fontWeight: 700, cursor: importando ? 'default' : 'pointer' }}>
                {importando ? 'Importando…' : '↓ Importar histórico (Resend)'}
              </button>
            </div>
            {importMsg && (
              <div style={{ marginBottom: 8, fontSize: 11.5, fontWeight: 600, color: importMsg.ok ? '#15803d' : '#b91c1c' }}>
                {importMsg.ok ? '✓ ' : '✕ '}{importMsg.texto}
              </div>
            )}
            {(dados.emails || []).length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>Nenhum e-mail registrado ainda. Use "Importar histórico (Resend)" para puxar o que ainda estiver disponível; novos envios já entram automaticamente.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dados.emails.map((e, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#334155', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', borderTop: i ? '1px solid #f1f5f9' : 'none', paddingTop: i ? 6 : 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#eff6ff', color: '#0D63DB', flexShrink: 0 }}>{emailTipoLabel(e.tipo)}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.assunto || '(sem assunto)'}</span>
                      {e.status === 'falha' && <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: '#fee2e2', color: '#b91c1c', flexShrink: 0 }}>falhou</span>}
                    </span>
                    <span style={{ flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                      {e.aberto_em
                        ? <span title={`Lido em ${dataHoraBR(e.aberto_em)}`} style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: '#f0fdf4', color: '#15803d' }}>✓ lido</span>
                        : e.entregue_em
                          ? <span title={`Entregue em ${dataHoraBR(e.entregue_em)}`} style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: '#eff6ff', color: '#0D63DB' }}>entregue</span>
                          : null}
                      <span style={{ color: '#94a3b8' }}>{dataHoraBR(e.enviado_em)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Imóveis enviados (e-mail/push) — auditoria da seleção: bate com cidade/UF e filtros? */}
          <div style={card}>
            <div style={{ ...label, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              📤 Imóveis enviados por e-mail/push ({dados.enviados_total ?? (dados.enviados || []).length})
            </div>
            {(dados.enviados || []).length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>Nenhum imóvel enviado ainda. Aqui você audita se os imóveis encaminhados batem com a cidade/UF e os filtros do cliente.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dados.enviados.map((im, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#334155', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', borderTop: i ? '1px solid #f1f5f9' : 'none', paddingTop: i ? 6 : 0 }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <b>{[im.cidade, im.estado].filter(Boolean).join('/') || '—'}</b> · {im.titulo || 'Imóvel'}
                    </span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                      {im.desconto_percentual ? <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#f0fdf4', color: '#059669' }}>{Math.round(im.desconto_percentual)}% OFF</span> : null}
                      <span style={{ color: '#94a3b8' }}>{dataHoraBR(im.enviado_em)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Interesse × desinteresse — gerado sob demanda (sem painel fixo). O que o cliente
                curtiu/rejeitou no widget "Sugestão para você" e vira aprendizado da seleção. */}
            <div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
              <button onClick={() => setVerInteresses(v => !v)}
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 10px', fontSize: 11.5, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                {verInteresses ? 'Ocultar' : '↓ Gerar'} interesses do cliente · {(dados.interesses || []).length} ✔ / {(dados.sem_interesse || []).length} ✕
              </button>
              {verInteresses && (
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ ...label, marginBottom: 4, color: '#059669' }}>✔ Demonstrou interesse</div>
                    {(dados.interesses || []).length === 0 ? <div style={{ fontSize: 11.5, color: '#94a3b8' }}>Nenhum registrado.</div> :
                      (dados.interesses || []).map((im, i) => (<div key={i} style={{ fontSize: 11.5, color: '#334155', padding: '3px 0' }}>{[im.cidade, im.estado].filter(Boolean).join('/')} · {im.titulo || im.tipo || 'Imóvel'}</div>))}
                  </div>
                  <div>
                    <div style={{ ...label, marginBottom: 4, color: '#b91c1c' }}>✕ Sem interesse</div>
                    {(dados.sem_interesse || []).length === 0 ? <div style={{ fontSize: 11.5, color: '#94a3b8' }}>Nenhum registrado.</div> :
                      (dados.sem_interesse || []).map((im, i) => (<div key={i} style={{ fontSize: 11.5, color: '#334155', padding: '3px 0' }}>{[im.cidade, im.estado].filter(Boolean).join('/')} · {im.titulo || im.tipo || 'Imóvel'}</div>))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
