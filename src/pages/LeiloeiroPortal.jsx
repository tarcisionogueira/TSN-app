import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { Copy, Check, Gavel, BarChart3, Link2, Settings, RefreshCw, AlertCircle } from 'lucide-react';

export default function LeiloeiroPortal() {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const [perfil, setPerfil] = useState(null);
  const [stats, setStats] = useState({ imoveis: 0, visualizacoes: 0, interessados: 0 });
  const [webhookKey, setWebhookKey] = useState('');
  const [copiado, setCopiado] = useState('');
  const [loading, setLoading] = useState(true);
  const [gerandoKey, setGerandoKey] = useState(false);

  useEffect(() => {
    if (!user) { nav('/login'); return; }
    if (role !== 'leiloeiro' && role !== 'admin') { nav('/membros'); return; }
    carregar();
  }, [user, role]);

  async function carregar() {
    setLoading(true);
    const { data: p } = await supabase.from('perfis').select('*').eq('id', user.id).single();
    setPerfil(p);
    setWebhookKey(p?.leiloeiro_webhook_key || '');

    // Estatísticas dos imóveis vinculados
    const { count: totalImoveis } = await supabase
      .from('imoveis_leiloeiro')
      .select('*', { count: 'exact', head: true })
      .eq('leiloeiro_id', user.id);

    setStats({ imoveis: totalImoveis || 0, visualizacoes: 0, interessados: 0 });
    setLoading(false);
  }

  async function gerarWebhookKey() {
    setGerandoKey(true);
    const key = 'leil_' + Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    await supabase.from('perfis').update({ leiloeiro_webhook_key: key }).eq('id', user.id);
    setWebhookKey(key);
    setGerandoKey(false);
  }

  function copiar(texto, label) {
    navigator.clipboard.writeText(texto);
    setCopiado(label);
    setTimeout(() => setCopiado(''), 2500);
  }

  const webhookUrl = `${window.location.origin}/api/leiloeiro-webhook`;

  if (loading) return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <RefreshCw size={24} color="#94a3b8" style={{ animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px 80px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 32 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Gavel size={24} color="#ea580c" />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#111', margin: 0 }}>Portal do Leiloeiro</h1>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
            {perfil?.nome} · {perfil?.matricula || 'Matrícula não informada'} · {perfil?.junta || ''}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '4px 12px', fontSize: 12, fontWeight: 700, color: '#c2410c' }}>
          🔨 Leiloeiro Oficial
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 32 }}>
        {[
          { icon: Gavel,    label: 'Imóveis na plataforma', value: stats.imoveis,       cor: '#ea580c' },
          { icon: BarChart3,label: 'Visualizações',         value: stats.visualizacoes,  cor: '#0D63DB' },
          { icon: Link2,    label: 'Interessados',          value: stats.interessados,   cor: '#10b981' },
        ].map(({ icon: Icon, label, value, cor }) => (
          <div key={label} style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '20px 22px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ background: cor + '15', borderRadius: 8, padding: 7 }}>
                <Icon size={16} color={cor} />
              </div>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</span>
            </div>
            <div style={{ fontSize: 32, fontWeight: 900, color: cor }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Integração via Webhook */}
      <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '28px 28px', marginBottom: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: '#111', margin: '0 0 6px' }}>Integração via Webhook</h2>
        <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7, margin: '0 0 24px' }}>
          Configure o seu sistema para enviar imóveis automaticamente para a plataforma TSN. Cada lote publicado no seu site pode aparecer aqui em tempo real para milhares de investidores.
        </p>

        {!webhookKey ? (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '16px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <AlertCircle size={18} color="#dc2626" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#dc2626' }}>Chave de integração não gerada</div>
              <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 2 }}>Gere a chave abaixo para liberar o endpoint de integração.</div>
            </div>
          </div>
        ) : null}

        {/* Webhook URL */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Endpoint (POST)</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontFamily: 'monospace', fontSize: 13, color: '#334155', wordBreak: 'break-all' }}>
              {webhookUrl}
            </div>
            <button onClick={() => copiar(webhookUrl, 'url')}
              style={{ padding: '10px 14px', background: copiado === 'url' ? '#10b981' : '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer', color: copiado === 'url' ? 'white' : '#475569', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
              {copiado === 'url' ? <Check size={14} /> : <Copy size={14} />}
              {copiado === 'url' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>

        {/* Chave API */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Sua chave de API (header: X-Leiloeiro-Key)</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontFamily: 'monospace', fontSize: 13, color: webhookKey ? '#334155' : '#94a3b8', wordBreak: 'break-all' }}>
              {webhookKey || 'Nenhuma chave gerada ainda'}
            </div>
            {webhookKey && (
              <button onClick={() => copiar(webhookKey, 'key')}
                style={{ padding: '10px 14px', background: copiado === 'key' ? '#10b981' : '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer', color: copiado === 'key' ? 'white' : '#475569', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                {copiado === 'key' ? <Check size={14} /> : <Copy size={14} />}
                {copiado === 'key' ? 'Copiada' : 'Copiar'}
              </button>
            )}
            <button onClick={gerarWebhookKey} disabled={gerandoKey}
              style={{ padding: '10px 16px', background: '#ea580c', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, flexShrink: 0, opacity: gerandoKey ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={13} /> {webhookKey ? 'Reger' : 'Gerar chave'}
            </button>
          </div>
          {webhookKey && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>⚠️ Tratar como senha. Não compartilhe publicamente.</div>}
        </div>

        {/* Payload de exemplo */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Exemplo de payload (JSON)</div>
          <pre style={{ background: '#0f172a', borderRadius: 10, padding: '16px 18px', color: '#e2e8f0', fontSize: 12, lineHeight: 1.7, overflow: 'auto', margin: 0 }}>{`POST ${webhookUrl}
Content-Type: application/json
X-Leiloeiro-Key: ${webhookKey || 'SUA_CHAVE_AQUI'}

{
  "action": "upsert_lote",
  "lote": {
    "id_externo": "lote-12345",
    "titulo": "Apartamento 2/4 — Bairro da Vitória",
    "tipo": "apartamento",
    "endereco": "Rua das Flores, 100",
    "cidade": "Salvador",
    "estado": "BA",
    "valor_avaliacao": 320000,
    "valor_minimo": 192000,
    "area_m2": 72,
    "data_leilao": "2026-07-15T10:00:00-03:00",
    "modalidade": "judicial",
    "url_lote": "https://seuleilao.com.br/lote/12345",
    "descricao": "Apartamento em bom estado, 1 vaga."
  }
}`}</pre>
        </div>
      </div>

      {/* Documentação rápida */}
      <div style={{ background: '#f8fafc', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px 28px' }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111', margin: '0 0 16px' }}>Actions disponíveis</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { action: 'upsert_lote',  desc: 'Cria ou atualiza um lote. Use id_externo como chave única.',    badge: 'POST', cor: '#0D63DB' },
            { action: 'fechar_lote',  desc: 'Marca o lote como encerrado (arrematado ou cancelado).',         badge: 'POST', cor: '#f59e0b' },
            { action: 'listar_lotes', desc: 'Retorna todos os lotes ativos vinculados à sua conta.',          badge: 'GET',  cor: '#10b981' },
          ].map(({ action, desc, badge, cor }) => (
            <div key={action} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: 'white', borderRadius: 10, padding: '12px 16px', border: '1px solid #e2e8f0' }}>
              <span style={{ background: cor + '15', color: cor, borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 800, flexShrink: 0, marginTop: 1 }}>{badge}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111', fontFamily: 'monospace' }}>{action}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
          Dúvidas técnicas sobre a integração?{' '}
          <span style={{ color: '#0D63DB', cursor: 'pointer', fontWeight: 600 }}
            onClick={() => window.dispatchEvent(new CustomEvent('tsn:open-chat'))}>
            Fale com nossa equipe pelo chat
          </span>
        </div>
      </div>
    </div>
  );
}
