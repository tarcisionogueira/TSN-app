export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

const DAILY_API = 'https://api.daily.co/v1';
const DOMAIN = 'tsn-reunioes';

export default async function handler(req) {

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (!['admin', 'consultor', 'analista', 'advogado'].includes(role)) return forbidden('Apenas consultores podem criar salas de reunião');

  const DAILY_KEY = process.env.DAILY_API_KEY;
  if (!DAILY_KEY) return new Response(JSON.stringify({ error: 'DAILY_API_KEY não configurada' }), { status: 500 });

  const { solicitacaoId, reuniaoEm, duracaoMin = 30 } = await req.json();
  if (!solicitacaoId || !reuniaoEm) {
    return new Response(JSON.stringify({ error: 'solicitacaoId e reuniaoEm são obrigatórios' }), { status: 400 });
  }

  const inicioTs = Math.floor(new Date(reuniaoEm).getTime() / 1000);
  // Sala expira 2h após o horário agendado (segurança)
  const expiracaoTs = inicioTs + (duracaoMin + 90) * 60;
  const roomName = `tsn-${solicitacaoId.slice(0, 8)}-${Date.now()}`;

  const res = await fetch(`${DAILY_API}/rooms`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DAILY_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: roomName,
      privacy: 'private',
      properties: {
        exp: expiracaoTs,
        transcription_enabled_default: true,
        max_participants: 2,
        lang: 'pt',
        redirect_on_meeting_exit: process.env.APP_BASE_URL || 'https://tsn-app-two.vercel.app',
        advanced_chat: false,
        // Tela de entrada com aviso legal de transcrição (Lei 9.296/1996 Art. 10 + LGPD Art. 7º, I)
        enable_prejoin_ui: true,
        prejoin_ui_title: 'Reunião TSN Ativos',
        prejoin_ui_description: '⚠️ Esta reunião é automaticamente transcrita para fins de qualidade e auditoria interna. Ao entrar, você declara ciência da transcrição, conforme Lei 9.296/1996, Art. 10 e LGPD (Lei 13.709/2018), Art. 7º, I.',
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Daily criar sala erro:', err);
    return new Response(JSON.stringify({ error: 'Erro ao criar sala Daily', detail: err }), { status: 500 });
  }

  const sala = await res.json();
  const meetLink = `https://${DOMAIN}.daily.co/${roomName}`;

  return new Response(JSON.stringify({ meetLink, roomName, sala }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
