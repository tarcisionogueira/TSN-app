import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { Calendar, Clock, Loader2, CheckCircle2, Video } from 'lucide-react';

const DIAS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function fmtHora(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}
function fmtDia(iso) {
  const d = new Date(iso);
  const dd = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: 'short' });
  return dd;
}
function chaveData(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * AgendarReuniao — exibe slots disponíveis e permite o cliente agendar.
 * Props:
 *   casoId       — UUID do caso
 *   analistaId   — UUID do analista (filtra slots)
 *   reuniaoNum   — 1 ou 2
 *   titulo       — texto exibido no topo
 *   onAgendado   — callback após agendar com sucesso ({ reuniao_id, data_hora, meet_link })
 *   onCancelar   — callback para fechar o modal
 */
export default function AgendarReuniao({ casoId, analistaId, reuniaoNum, titulo, onAgendado, onCancelar }) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [slotSel, setSlotSel] = useState(null);
  const [agendando, setAgendando] = useState(false);
  const [sucesso, setSucesso] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    carregarSlots();
  }, [analistaId]);

  async function carregarSlots() {
    setLoading(true);
    const agora = new Date().toISOString();
    let q = supabase
      .from('slots_reuniao')
      .select('id, data_hora, analista_id')
      .eq('disponivel', true)
      .gte('data_hora', agora)
      .order('data_hora')
      .limit(120);

    if (analistaId) q = q.eq('analista_id', analistaId);

    const { data } = await q;
    setSlots(data || []);
    setLoading(false);
  }

  // Agrupa slots por dia
  const porDia = (slots || []).reduce((acc, s) => {
    const k = chaveData(s.data_hora);
    if (!acc[k]) acc[k] = [];
    acc[k].push(s);
    return acc;
  }, {});

  async function confirmar() {
    if (!slotSel) return;
    setAgendando(true);
    setErro('');
    try {
      const res = await apiCall('/api/agendar-reuniao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_id: slotSel.id, caso_id: casoId, reuniao_numero: reuniaoNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao agendar');
      setSucesso(data);
      onAgendado?.(data);
    } catch (e) {
      setErro(e.message);
    }
    setAgendando(false);
  }

  if (sucesso) return (
    <div style={{ textAlign: 'center', padding: '24px 16px' }}>
      <CheckCircle2 size={48} color="#10b981" style={{ margin: '0 auto 12px' }} />
      <div style={{ fontWeight: 800, fontSize: 16, color: '#111', marginBottom: 8 }}>Reunião agendada!</div>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        {fmtDia(sucesso.data_hora)} às {fmtHora(sucesso.data_hora)}<br />
        Você receberá um email com o link e o convite para o Google Agenda.
      </div>
      {sucesso.meet_link && (
        <a href={sucesso.meet_link} target="_blank" rel="noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#0D63DB', color: 'white', borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
          <Video size={14} /> Acessar videochamada
        </a>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 15, color: '#111', marginBottom: 4 }}>
        <Calendar size={15} style={{ verticalAlign: 'middle', marginRight: 6, color: '#0D63DB' }} />
        {titulo || 'Escolha um horário'}
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
        Sessões de 30 minutos via videochamada (transcrita, sem gravação de vídeo, para registro e melhoria da análise).
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : Object.keys(porDia).length === 0 ? (
        <div style={{ padding: 20, background: '#f8fafc', borderRadius: 10, fontSize: 13, color: '#64748b', textAlign: 'center' }}>
          Nenhum horário disponível no momento.<br />
          <span style={{ fontSize: 12 }}>Tente novamente em breve ou entre em contato pelo chat.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: 360, overflowY: 'auto' }}>
          {Object.entries(porDia).map(([dia, slotsD]) => (
            <div key={dia}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 1 }}>
                {dia}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {slotsD.map(s => (
                  <button key={s.id} onClick={() => setSlotSel(s)}
                    style={{
                      padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      border: slotSel?.id === s.id ? '2px solid #0D63DB' : '1px solid #e2e8f0',
                      background: slotSel?.id === s.id ? '#eff6ff' : 'white',
                      color: slotSel?.id === s.id ? '#0D63DB' : '#374151',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}>
                    <Clock size={11} />
                    {fmtHora(s.data_hora)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {erro && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#dc2626' }}>
          {erro}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        {onCancelar && (
          <button onClick={onCancelar}
            style={{ flex: 1, padding: '10px', border: '1px solid #e2e8f0', borderRadius: 8, background: 'white', color: '#64748b', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Cancelar
          </button>
        )}
        <button onClick={confirmar} disabled={!slotSel || agendando}
          style={{ flex: 2, padding: '10px', background: slotSel ? '#0D63DB' : '#e2e8f0', color: slotSel ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: slotSel ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {agendando ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Agendando...</> : 'Confirmar agendamento'}
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
