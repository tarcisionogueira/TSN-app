import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const event = req.body;
  const tipo = event?.action;

  // Só processa eventos de transcrição concluída
  if (tipo !== 'transcription-ready') {
    return res.status(200).json({ ok: true, skipped: tipo });
  }

  const roomName = event?.room_name || event?.room;
  const transcricao = event?.transcription?.text || event?.transcript || '';
  const duracaoSeg = event?.duration || null;

  if (!roomName) return res.status(200).json({ ok: true, skipped: 'sem_room' });

  // Busca a solicitação pelo nome da sala (prefixo tsn-{8chars})
  const prefixo = roomName.match(/^tsn-([a-f0-9]{8})/)?.[1];
  if (!prefixo) return res.status(200).json({ ok: true, skipped: 'room_desconhecida' });

  const { data: sol } = await supabase
    .from('solicitacoes')
    .select('id')
    .ilike('google_meet_link', `%${prefixo}%`)
    .maybeSingle();

  if (!sol) {
    console.warn('Daily webhook: solicitação não encontrada para room', roomName);
    return res.status(200).json({ ok: true, skipped: 'solicitacao_nao_encontrada' });
  }

  const { error } = await supabase.from('transcricoes_reuniao').insert({
    solicitacao_id: sol.id,
    transcricao,
    duracao_seg: duracaoSeg,
    daily_room_name: roomName,
  });

  if (error) {
    console.error('Daily webhook Supabase error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true, solicitacao_id: sol.id });
}
