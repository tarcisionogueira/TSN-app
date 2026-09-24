// WhatsApp oficial: (1) a leitura do webhook separa mensagem da pessoa, echo da equipe (pausa a
// IA) e status de entrega; (2) a assinatura HMAC recusa corpo adulterado; (3) o envio só conta
// como enviado com o id da Meta no corpo — 200 sem id é falha (forma nº 1 do CLAUDE.md).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
const { lerEntregaWa, assinaturaWaConfere, textoDaMensagem } = await import('../../api/whatsapp-webhook.js');
const { variantesTelefone, enviarTextoWa } = await import('../../api/whatsapp-responder.js');

const corpo = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
  contacts: [{ wa_id: '5575999998888', profile: { name: 'Maria' } }],
  messages: [
    { from: '5575999998888', id: 'wamid.A', timestamp: '1790000000', type: 'text', text: { body: 'Quero saber da assessoria' } },
    { from: '5575999998888', id: 'wamid.B', timestamp: '1790000001', type: 'image', image: { caption: 'print' } },
    { from: '5575999998888', id: 'wamid.R', timestamp: '1790000002', type: 'reaction', reaction: { emoji: '👍' } },
  ],
  statuses: [{ id: 'wamid.X', status: 'read' }],
  message_echoes: [{ from: '5575911112222', to: '5575977776666', id: 'wamid.E', timestamp: '1790000003', type: 'text', text: { body: 'Oi, aqui é o Tarcisio' } }],
} }] }] };
const { conversas, mensagens, statuses } = lerEntregaWa(corpo);
assert.equal(mensagens.filter((m) => m.autor === 'pessoa').length, 2, 'reação não é mensagem a responder');
assert.equal(mensagens.find((m) => m.wamid === 'wamid.B').texto, '[imagem: print]');
assert.equal(mensagens.find((m) => m.wamid === 'wamid.A').resposta_status, 'pendente');
const echo = mensagens.find((m) => m.wamid === 'wamid.E');
assert.equal(echo.autor, 'equipe'); assert.equal(echo.telefone, '5575977776666', 'echo: a pessoa é o DESTINATÁRIO');
assert.ok(conversas.find((c) => c.telefone === '5575977776666').ia_pausada_ate, 'humano respondeu → IA pausa');
assert.equal(conversas.find((c) => c.telefone === '5575999998888').nome, 'Maria');
assert.deepEqual(statuses, [{ wamid: 'wamid.X', status: 'read', erro: null }]);
assert.equal(textoDaMensagem({ type: 'reaction' }), null);

const bytes = new TextEncoder().encode(JSON.stringify(corpo));
const sig = 'sha256=' + createHmac('sha256', 'segredo').update(bytes).digest('hex');
assert.equal(await assinaturaWaConfere(bytes, sig, ['segredo']), true);
assert.equal(await assinaturaWaConfere(new TextEncoder().encode('{}'), sig, ['segredo']), false);
assert.equal(await assinaturaWaConfere(bytes, sig, ['outro']), false);

const vs = variantesTelefone('5575999998888');
assert.ok(vs.includes('75999998888') && vs.includes('7599998888') && vs.includes('(75) 99999-8888'), vs.join(' | '));

const fake = (status, corpoResp) => async () => new Response(JSON.stringify(corpoResp), { status });
assert.equal(await enviarTextoWa('5575999998888', 'oi', { token: 't', phoneId: '1', fetchImpl: fake(200, { messages: [{ id: 'wamid.OK' }] }) }), 'wamid.OK');
await assert.rejects(enviarTextoWa('5575999998888', 'oi', { token: 't', phoneId: '1', fetchImpl: fake(200, {}) }), /sem id/);
await assert.rejects(enviarTextoWa('5575999998888', 'oi', { token: 't', phoneId: '1', fetchImpl: fake(400, { error: { message: 'Re-engagement message' } }) }), /Re-engagement/);
console.log('✓ whatsapp: escuta, assinatura, telefone e envio conferidos');
