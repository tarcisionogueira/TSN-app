import React, { useState } from 'react';
import { apiCall } from '../utils/apiCall';
import { FileText, ExternalLink, Loader2, Info, Building2, Clock, CircleDollarSign } from 'lucide-react';

/**
 * Obter certidão de matrícula (leitura) — reutilizável na Análise (documental) e no
 * Registro pós-arrematação. Resolve o cartório (CRI) do imóvel na central ONR e
 * direciona o passo a passo do pedido oficial. Se o pull automático estiver ligado
 * (conta ONR confirmada), a resposta traz fonte='auto'.
 *
 * Props: { uf, cidade, matricula, titulo? }
 */
export default function CertidaoMatriculaHelper({ uf, cidade, matricula, titulo = 'Obter certidão de matrícula (leitura)' }) {
  const [estado, setEstado] = useState('idle'); // idle | carregando | ok | erro
  const [dados, setDados] = useState(null);
  const [msg, setMsg] = useState('');

  const buscar = async () => {
    if (!uf) { setMsg('Informe a UF do imóvel primeiro.'); setEstado('erro'); return; }
    setEstado('carregando'); setMsg('');
    try {
      const res = await apiCall('/api/matricula-certidao', {
        method: 'POST',
        body: JSON.stringify({ uf, cidade, matricula }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setMsg(e.error || `Não foi possível consultar (HTTP ${res.status}).`);
        setEstado('erro');
        return;
      }
      const d = await res.json();
      setDados(d);
      setEstado('ok');
    } catch (e) {
      setMsg('Falha de rede ao consultar o cartório.');
      setEstado('erro');
    }
  };

  const cartorio = dados?.cartorios?.[0] || null;
  const pedido = dados?.pedido || null;
  const auto = dados?.fonte === 'auto';

  return (
    <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <FileText size={16} color="#0369a1" />
        <span style={{ fontWeight: 800, fontSize: 13, color: '#0369a1' }}>{titulo}</span>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#0c4a6e', lineHeight: 1.6 }}>
        A certidão de matrícula é a <strong>fonte oficial</strong> para a análise documental (cadeia dominial, ônus, gravames).
        Resolvemos o cartório do imóvel e te levamos ao pedido oficial do ONR — a certidão sai digital e assinada.
      </p>

      {estado !== 'ok' && (
        <button onClick={buscar} disabled={estado === 'carregando'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', background: estado === 'carregando' ? '#94a3b8' : '#0369a1', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: estado === 'carregando' ? 'default' : 'pointer' }}>
          {estado === 'carregando'
            ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Resolvendo cartório…</>
            : <><Building2 size={14} /> Resolver cartório e gerar pedido</>}
        </button>
      )}

      {estado === 'erro' && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#b91c1c', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {msg}
        </div>
      )}

      {estado === 'ok' && dados && (
        <div style={{ marginTop: 4 }}>
          {/* Cartório resolvido */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            {cartorio ? (
              <div style={{ fontSize: 12.5, color: '#0f172a' }}>
                <strong>Cartório:</strong> {cartorio.nome} · {cartorio.cidade}/{cartorio.uf}
                {dados.cartorios.length > 1 && <span style={{ color: '#64748b' }}> (+{dados.cartorios.length - 1} na cidade)</span>}
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: '#92400e' }}>
                {dados.consulta_onr === 'indisponivel'
                  ? 'Não foi possível resolver o cartório automaticamente agora — use "Buscar cartório" no pedido abaixo.'
                  : `Cidade não localizada na central ONR${cidade ? ` para "${cidade}/${uf}"` : ''}. Selecione o cartório manualmente no pedido.`}
              </div>
            )}
          </div>

          {/* Custo / prazo */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#0f172a', fontWeight: 600 }}>
              <CircleDollarSign size={13} color="#059669" /> {dados.custo}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#0f172a', fontWeight: 600 }}>
              <Clock size={13} color="#0369a1" /> {dados.prazo}
            </span>
          </div>

          {auto && (
            <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 8, padding: '8px 10px', marginBottom: 12, fontSize: 12, color: '#166534', fontWeight: 600 }}>
              Emissão automática habilitada — o pedido é disparado pela nossa conta ONR.
            </div>
          )}

          {/* Passo a passo */}
          {pedido?.passos && (
            <ol style={{ margin: '0 0 12px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {pedido.passos.map(p => (
                <li key={p.n} style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>{p.texto}</li>
              ))}
            </ol>
          )}

          {/* Ações */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <a href={pedido?.portal} target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#0369a1', color: 'white', borderRadius: 8, fontWeight: 700, fontSize: 12.5, textDecoration: 'none' }}>
              <ExternalLink size={13} /> Abrir pedido no ONR
            </a>
            <a href={pedido?.buscar_cartorio} target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'white', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: 8, fontWeight: 700, fontSize: 12.5, textDecoration: 'none' }}>
              <ExternalLink size={13} /> Buscar cartório
            </a>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
