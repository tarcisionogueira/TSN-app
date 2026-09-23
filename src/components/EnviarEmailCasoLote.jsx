import { useState } from 'react';
import { apiCall } from '../utils/apiCall';

/**
 * "Enviar e-mail" — jurídico ou leiloeiro do lote, com um clique incluindo todos os
 * documentos (e os pessoais, se o cliente do caso for assessorado). Pedido do dono (20/09,
 * ampliado 21/09): usado em `Caso.jsx` (casoId — tem cliente, então confere assessorado),
 * `ImovelDetalhe.jsx` (imovelId — a tela do lote não é 1:1 com cliente, só os anexos do
 * lote) e `VeiculoDetalhe.jsx` (veiculoId — mesmo caso de imovelId, sem cliente único).
 * Mesmo componente, três pontos de entrada — evita cópias da mesma lógica de preview/envio
 * divergindo com o tempo.
 *
 * SEM CONTATO CADASTRADO: a maioria das fontes ainda não tem e-mail salvo (7 de 57 fontes
 * ativas, medido em 21/09) — o campo de e-mail aparece pra digitar na hora, e se o envio der
 * certo o contato é GRAVADO automaticamente (leiloeiro_contato/juridico_destinatarios) para
 * os próximos envios não pedirem de novo.
 *
 * ACESSO: só a equipe (staff) — o servidor (`api/enviar-email-caso.js`) é quem garante isso de
 * verdade; o `isStaff` do chamador aqui é só para não desenhar o botão para o cliente.
 */
const btnLocal = (color = '#0D63DB') => ({ padding: '10px 20px', background: color, color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' });
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function EnviarEmailCasoLote({ casoId, imovelId, veiculoId, cardStyle }) {
  const [emailPreview, setEmailPreview] = useState(null); // { destino, texto, destinatarioEmail, contatoDisponivel, ... }
  const [enviando, setEnviando] = useState(false);
  const [carregando, setCarregando] = useState(null); // 'juridico'|'leiloeiro'|null
  const [emailManual, setEmailManual] = useState('');
  const [msg, setMsg] = useState('');

  const corpoAlvo = () => (casoId ? { caso_id: casoId } : veiculoId ? { veiculo_id: veiculoId } : { imovel_id: imovelId });

  const abrirPreview = async (destino) => {
    setCarregando(destino);
    setMsg('');
    try {
      const r = await apiCall('/api/enviar-email-caso', { method: 'POST', body: JSON.stringify({ ...corpoAlvo(), destino, action: 'preview' }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao montar o e-mail');
      setEmailManual('');
      setEmailPreview({ destino, ...d });
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    } finally {
      setCarregando(null);
    }
  };

  const enviar = async () => {
    if (!emailPreview) return;
    setEnviando(true);
    setMsg('');
    try {
      const r = await apiCall('/api/enviar-email-caso', { method: 'POST', body: JSON.stringify({ ...corpoAlvo(), destino: emailPreview.destino, action: 'enviar', texto: emailPreview.texto, emailManual: emailManual || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao enviar o e-mail');
      if (d.semContato) { setMsg('Informe um e-mail válido — não há contato cadastrado para este destino ainda.'); return; }
      setMsg(`📨 E-mail enviado para ${d.destinatario} com ${d.anexos} anexo(s).${d.contatoSalvo ? ' Contato salvo para os próximos envios.' : ''}`);
      setEmailPreview(null);
      setEmailManual('');
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    } finally {
      setEnviando(false);
    }
  };

  const emailManualValido = RE_EMAIL.test(emailManual.trim());
  const podeEnviar = emailPreview && (emailPreview.contatoDisponivel || emailManualValido);

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 15, fontWeight: 900, color: '#111', marginBottom: 4 }}>📧 Enviar e-mail</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
        Um clique inclui todos os documentos do lote (e os documentos pessoais do cliente, se ele for assessorado). Escolha o destino:
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => abrirPreview('juridico')} disabled={carregando === 'juridico'} style={{ ...btnLocal('#0D63DB'), fontSize: 12, opacity: carregando === 'juridico' ? 0.6 : 1 }}>
          {carregando === 'juridico' ? 'Preparando…' : 'Enviar ao Jurídico'}
        </button>
        <button onClick={() => abrirPreview('leiloeiro')} disabled={carregando === 'leiloeiro'} style={{ ...btnLocal('#475569'), fontSize: 12, opacity: carregando === 'leiloeiro' ? 0.6 : 1 }}>
          {carregando === 'leiloeiro' ? 'Preparando…' : 'Enviar ao Leiloeiro deste lote'}
        </button>
      </div>

      {emailPreview && (
        <div style={{ marginTop: 14, padding: '14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#111', marginBottom: 6 }}>
            Prévia — {emailPreview.destino === 'juridico' ? 'Jurídico' : 'Leiloeiro deste lote'}
          </div>

          {emailPreview.contatoDisponivel ? (
            <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 8 }}>Destinatário: <strong>{emailPreview.destinatarioEmail}</strong></div>
          ) : (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 6 }}>⚠️ Nenhum e-mail de contato cadastrado para este destino ainda — digite um para enviar (fica salvo para os próximos envios):</div>
              <input type="email" value={emailManual} onChange={e => setEmailManual(e.target.value)} placeholder="email@exemplo.com.br"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${emailManual && !emailManualValido ? '#fca5a5' : '#e2e8f0'}`, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          )}

          {emailPreview.redator && (
            <div style={{ fontSize: 11.5, margin: '0 0 6px', color: emailPreview.redator.usado ? '#15803d' : '#92400e' }}>
              {emailPreview.redator.usado
                ? `✍️ Rascunho escrito no seu estilo, aprendido dos seus ${emailPreview.redator.exemplos} último(s) e-mail(s) a leiloeiros — revise antes de enviar.`
                : `Texto padrão (o redator não usou: ${emailPreview.redator.motivo}).`}
              {emailPreview.redator.usado && emailPreview.textoPadrao && (
                <button type="button" onClick={() => setEmailPreview(p => ({ ...p, texto: p.textoPadrao, redator: { ...p.redator, usado: false, motivo: 'você voltou ao texto padrão' } }))}
                  style={{ marginLeft: 8, background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, cursor: 'pointer', fontSize: 11.5 }}>usar texto padrão</button>
              )}
            </div>
          )}
          <textarea value={emailPreview.texto} onChange={e => setEmailPreview(p => ({ ...p, texto: e.target.value }))}
            rows={7} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
            Anexos do lote ({emailPreview.anexosLote?.length || 0}): {emailPreview.anexosLote?.length ? emailPreview.anexosLote.join(', ') : '— nenhum documento do lote ainda —'}
          </div>
          {emailPreview.ehAssessorado && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              Documentos pessoais do cliente ({emailPreview.anexosPessoais?.length || 0}): {emailPreview.anexosPessoais?.length ? emailPreview.anexosPessoais.join(', ') : '— nenhum documento pessoal cadastrado ainda —'}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={enviar} disabled={enviando || !podeEnviar} style={{ ...btnLocal('#059669'), fontSize: 12, opacity: (enviando || !podeEnviar) ? 0.6 : 1 }}>
              {enviando ? 'Enviando…' : 'Confirmar envio'}
            </button>
            <button onClick={() => { setEmailPreview(null); setEmailManual(''); }} disabled={enviando} style={{ ...btnLocal('#94a3b8'), fontSize: 12 }}>Cancelar</button>
          </div>
        </div>
      )}

      {msg && <div style={{ marginTop: 10, fontSize: 12, color: msg.startsWith('Erro') ? '#b91c1c' : '#065f46' }}>{msg}</div>}
    </div>
  );
}
