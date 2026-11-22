import React, { useCallback, useEffect, useState } from 'react';
import { apiCall } from '../utils/apiCall';

/**
 * GATILHOS DE PALAVRA-CHAVE DO INSTAGRAM (22/11) — o "ManyChat" da BidPro.
 * "Comenta PATRIMÔNIO que eu te mando o material": quem comentar a palavra recebe a mensagem no
 * direct na hora e ganha uma resposta pública curta sob o comentário. Quem envia é
 * api/instagram-gatilhos.js; aqui só se cadastra, liga/desliga e confere os disparos.
 */
const VAZIO = { palavra: '', media_id: '', media_legenda: '', mensagem_dm: '', link: '', respostas_publicas: '' };
const B = { padding: '7px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const IN = { width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' };
const STATUS = { enviado: ['#166534', 'enviado'], repetido: ['#64748b', 'já tinha recebido'], falhou: ['#b91c1c', 'falhou'], enviando: ['#b45309', 'enviando'] };

export default function GatilhosInstagram() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [form, setForm] = useState(null);       // null = fechado; objeto = criando/editando
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await apiCall('/api/admin-ig-gatilhos');
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) throw new Error(j?.error || `HTTP ${r.status}`);
      setDados(j); setErro('');
    } catch (e) { setErro(`Não consegui carregar os gatilhos: ${e.message || e}`); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function enviar(corpo) {
    const r = await apiCall('/api/admin-ig-gatilhos', { method: 'POST', body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.error) throw new Error(j?.error || `HTTP ${r.status}`);
    return j;
  }

  async function salvar() {
    setSalvando(true);
    try {
      const post = (dados?.posts || []).find((p) => p.id === form.media_id);
      await enviar({ acao: 'salvar', gatilho: { ...form, media_legenda: post?.legenda || form.media_legenda } });
      setForm(null); await carregar();
    } catch (e) { setErro(String(e.message || e)); }
    finally { setSalvando(false); }
  }

  async function alternar(g) {
    try { await enviar({ acao: 'ativar', id: g.id, ativo: !g.ativo }); await carregar(); }
    catch (e) { setErro(String(e.message || e)); }
  }

  const palavraDe = (id) => dados?.gatilhos?.find((g) => g.id === id)?.palavra || `#${id}`;

  return (
    <div style={{ border: '1px solid #fbcfe8', background: '#fffafc', borderRadius: 14, padding: 16, margin: '12px 0 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>📸 Gatilhos de palavra-chave</div>
        <span style={{ fontSize: 12.5, color: '#64748b' }}>comentou a palavra → recebe no direct + resposta pública</span>
        <button style={{ ...B, marginLeft: 'auto', background: '#9d174d', color: '#fff', border: 'none' }} onClick={() => setForm({ ...VAZIO })}>+ Novo gatilho</button>
      </div>

      {dados?.conta && !dados.conta.ok && (
        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 12.5 }}>
          ⚠️ <strong>O envio pelo Instagram não está funcionando:</strong> {dados.conta.motivo}. Os gatilhos ficam salvos, mas nenhum direct sai até o token ser renovado.
        </div>
      )}
      {erro && <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 12.5 }}>{erro}</div>}

      {form && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Palavra que a pessoa comenta
            <input style={IN} value={form.palavra} placeholder="PATRIMÔNIO" onChange={(e) => setForm({ ...form, palavra: e.target.value })} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Em qual post
            <select style={IN} value={form.media_id || ''} onChange={(e) => setForm({ ...form, media_id: e.target.value })}>
              <option value="">Qualquer post (gatilho geral)</option>
              {(dados?.posts || []).map((p) => (
                <option key={p.id} value={p.id}>{new Date(p.quando).toLocaleDateString('pt-BR')} — {p.legenda || '(sem legenda)'}</option>
              ))}
              {form.media_id && !(dados?.posts || []).some((p) => p.id === form.media_id) && <option value={form.media_id}>{form.media_legenda || form.media_id}</option>}
            </select>
          </label>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Mensagem do direct <span style={{ fontWeight: 400, color: '#64748b' }}>({'{nome}'} vira o @ da pessoa)</span>
            <textarea style={{ ...IN, minHeight: 90 }} value={form.mensagem_dm}
              placeholder={'Oi {nome}! Aqui está o material sobre patrimônio que prometi 👇'}
              onChange={(e) => setForm({ ...form, mensagem_dm: e.target.value })} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Link do material <span style={{ fontWeight: 400, color: '#64748b' }}>(vai no fim da mensagem)</span>
            <input style={IN} value={form.link || ''} placeholder="https://www.bidprobrasil.com.br/…" onChange={(e) => setForm({ ...form, link: e.target.value })} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Respostas públicas no comentário <span style={{ fontWeight: 400, color: '#64748b' }}>(uma por linha, sorteadas; em branco = padrão)</span>
            <textarea style={{ ...IN, minHeight: 70 }} value={form.respostas_publicas}
              placeholder={'Te mandei no direct! 📩\nEnviado no seu direct 😉'}
              onChange={(e) => setForm({ ...form, respostas_publicas: e.target.value })} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...B, background: '#111', color: '#fff', border: 'none' }} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar gatilho'}</button>
            <button style={B} onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {dados && !dados.gatilhos.length && !form && (
          <div style={{ fontSize: 13, color: '#64748b' }}>Nenhum gatilho ainda. Crie o primeiro: palavra + mensagem + link do material.</div>
        )}
        {(dados?.gatilhos || []).map((g) => (
          <div key={g.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', opacity: g.ativo ? 1 : 0.55 }}>
            <strong style={{ fontSize: 14 }}>“{g.palavra}”</strong>
            <span style={{ fontSize: 12, color: '#64748b' }}>{g.media_id ? `post: ${g.media_legenda || g.media_id}`.slice(0, 70) : 'qualquer post'}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>{g.disparos} enviados</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button style={B} onClick={() => setForm({ ...g, media_id: g.media_id || '', link: g.link || '', respostas_publicas: (g.respostas_publicas || []).join('\n') })}>Editar</button>
              <button style={B} onClick={() => alternar(g)}>{g.ativo ? 'Pausar' : 'Ativar'}</button>
            </div>
          </div>
        ))}
      </div>

      {(dados?.disparos || []).length > 0 && (
        <details style={{ marginTop: 12, fontSize: 12.5 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Últimos disparos</summary>
          {dados.disparos.map((d) => {
            const [cor, rotulo] = STATUS[d.status] || ['#64748b', d.status];
            return (
              <div key={d.id} style={{ marginTop: 4, color: '#475569' }}>
                {new Date(d.criado_em).toLocaleString('pt-BR')} · “{palavraDe(d.gatilho_id)}” · <span style={{ color: cor, fontWeight: 700 }}>{rotulo}</span>
                {d.erro && <span style={{ color: '#b91c1c' }}> — {d.erro}</span>}
              </div>
            );
          })}
        </details>
      )}
    </div>
  );
}
