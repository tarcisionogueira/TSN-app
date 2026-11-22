// WhatsApp via Evolution (22/11): (1) a leitura do webhook separa pessoa, eco nosso/equipe, status e
// conexão, e ignora grupo/reação; (2) o envio só conta com o id devolvido; (3) a fila monta a abertura
// com o primeiro nome e respeita o horário; (4) SAIR, interesse e código do cliente são reconhecidos.
import assert from 'node:assert/strict';
const { lerEntregaEvolution, contatoDoJid, textoEvolution, autorizadoEvolution, carimboEvolution } = await import('../../api/whatsapp-evolution-webhook.js');
const { enviarTextoEvolution, destinoEvolution, canalWhatsapp, regrasDoCanal, faltaParaEnviar } = await import('../../api/_whatsapp-envio.js');
const { montarAbertura, primeiroNome, emHorarioComercial } = await import('../../api/whatsapp-disparos-cron.js');
const { pedidoDeSaida, interesseDoPerfil, codigoClienteDoTexto } = await import('../../api/whatsapp-responder.js');
const { desfechoDaConversa, transcricao } = await import('../../api/whatsapp-sdr-aprendizado-cron.js');

// ── 1. leitura do webhook ──
const upsert = {
  event: 'messages.upsert', instance: 'bidpro', apikey: 'k',
  data: [
    { key: { remoteJid: '5511964079726@s.whatsapp.net', fromMe: false, id: 'A1' }, pushName: 'Maria', message: { conversation: 'Quero saber de veículos' }, messageType: 'conversation', messageTimestamp: 1790000000 },
    { key: { remoteJid: '5511964079726@s.whatsapp.net', fromMe: false, id: 'A2' }, message: { extendedTextMessage: { text: 'e imóveis' } }, messageTimestamp: { low: 1790000001 } },
    { key: { remoteJid: '5511964079726@s.whatsapp.net', fromMe: false, id: 'A3' }, message: { reactionMessage: { text: '👍' } } },
    { key: { remoteJid: '120363000000@g.us', fromMe: false, id: 'G1' }, message: { conversation: 'grupo' } },
    { key: { remoteJid: '5511977776666@s.whatsapp.net', fromMe: true, id: 'E1' }, message: { conversation: 'Oi, aqui é o Tarcisio' } },
    { key: { remoteJid: '9999@lid', remoteJidAlt: '5571988887777@s.whatsapp.net', fromMe: false, id: 'L1' }, message: { imageMessage: { caption: 'print do lote' } } },
  ],
};
const r = lerEntregaEvolution(upsert);
assert.equal(r.mensagens.length, 3, 'reação e grupo não entram');
assert.deepEqual(r.mensagens.map((m) => m.wamid), ['A1', 'A2', 'L1']);
assert.equal(r.mensagens[0].resposta_status, 'pendente');
assert.equal(r.mensagens[2].telefone, '5571988887777', '@lid usa o telefone alternativo');
assert.equal(r.mensagens[2].texto, '[imagem: print do lote]');
assert.equal(r.conversas.find((c) => c.telefone === '5511964079726').nome, 'Maria');
assert.equal(r.ecos.length, 1); assert.equal(r.ecos[0].autor, 'equipe'); assert.equal(r.ecos[0].telefone, '5511977776666');
assert.equal(contatoDoJid({ remoteJid: '8888@lid' }), '8888@lid', '@lid sem alternativo: guarda o JID para responder');
assert.equal(contatoDoJid({ remoteJid: 'status@broadcast' }), null);
assert.equal(textoEvolution({ ephemeralMessage: { message: { conversation: 'temporária' } } }), 'temporária');
assert.equal(textoEvolution({ protocolMessage: {} }), null);
assert.equal(carimboEvolution('1790000000'), new Date(1790000000 * 1000).toISOString());

const upd = lerEntregaEvolution({ event: 'MESSAGES_UPDATE', data: { keyId: 'X1', status: 'READ' } });
assert.deepEqual(upd.statuses, [{ wamid: 'X1', status: 'read' }]);
assert.equal(lerEntregaEvolution({ event: 'connection.update', data: { state: 'close' } }).conexao, 'close');

assert.equal(autorizadoEvolution('tok', null, { WA_EVOLUTION_WEBHOOK_TOKEN: 'tok' }), true);
assert.equal(autorizadoEvolution(null, 'k', { EVOLUTION_APIKEY: 'k' }), true);
assert.equal(autorizadoEvolution('x', 'y', { WA_EVOLUTION_WEBHOOK_TOKEN: 'tok', EVOLUTION_APIKEY: 'k' }), false);
assert.equal(autorizadoEvolution(null, null, {}), false, 'sem segredo configurado, recusa');

// ── 2. envio ──
const fake = (status, corpo, ver) => async (url, init) => { ver?.(url, init); return new Response(JSON.stringify(corpo), { status }); };
let visto;
const id = await enviarTextoEvolution('5511964079726', 'oi', { url: 'https://evo.x/', apikey: 'k', instancia: 'bidpro', fetchImpl: fake(201, { key: { id: 'OK1' } }, (u, i) => { visto = { u, i }; }) });
assert.equal(id, 'OK1');
assert.equal(visto.u, 'https://evo.x/message/sendText/bidpro');
assert.equal(visto.i.headers.apikey, 'k');
assert.equal(JSON.parse(visto.i.body).number, '5511964079726');
await assert.rejects(enviarTextoEvolution('55', 'oi', { url: 'https://evo.x', apikey: 'k', instancia: 'b', fetchImpl: fake(200, {}) }), /sem id/, '200 sem id = falha');
await assert.rejects(enviarTextoEvolution('55', 'oi', { url: 'https://evo.x', apikey: 'k', instancia: 'b', fetchImpl: fake(400, { response: { message: ['not exists'] } }) }), /Evolution 400/);
assert.equal(destinoEvolution('+55 (11) 96407-9726'), '5511964079726');
assert.equal(destinoEvolution('8888@lid'), '8888@lid');
assert.equal(canalWhatsapp({ EVOLUTION_URL: 'x' }), 'evolution');
assert.equal(canalWhatsapp({}), 'oficial');
assert.equal(canalWhatsapp({ WA_CANAL: 'oficial', EVOLUTION_URL: 'x' }), 'oficial');
assert.equal(regrasDoCanal('evolution').janela24h, false);
assert.equal(regrasDoCanal('oficial').ativaTextoLivre, false);
assert.deepEqual(faltaParaEnviar('evolution', { EVOLUTION_URL: 'x' }), ['EVOLUTION_APIKEY', 'EVOLUTION_INSTANCIA']);

// ── 3. fila ativa ──
assert.equal(montarAbertura('Oi{nome}! Tudo bem?', 'MARIA DA SILVA'), 'Oi Maria! Tudo bem?');
assert.equal(montarAbertura('Olá{nome}, tudo bem?', ''), 'Olá, tudo bem?');
assert.equal(montarAbertura('Oi{nome}!', '123'), 'Oi!', 'nome que não é nome some');
assert.equal(primeiroNome('josé'), 'José');
assert.equal(emHorarioComercial(new Date('2026-11-23T14:00:00Z')), true, 'segunda 11h em Brasília');
assert.equal(emHorarioComercial(new Date('2026-11-23T23:30:00Z')), false, 'segunda 20h30');
assert.equal(emHorarioComercial(new Date('2026-11-22T14:00:00Z')), false, 'domingo');

// ── 4. SAIR, interesse, código ──
for (const t of ['SAIR', 'sair.', 'Parar', 'não quero mais receber', 'stop']) assert.equal(pedidoDeSaida(t), true, t);
for (const t of ['quero sair do aluguel e comprar um imóvel de leilão', 'como faço para parar de pagar aluguel?', 'oi']) assert.equal(pedidoDeSaida(t), false, t);
assert.equal(interesseDoPerfil('busca=veiculo; objetivo=revender; interesse=veiculos'), 'veiculos');
assert.equal(interesseDoPerfil('interesse=plano'), 'investidor_pro', 'formato antigo continua valendo');
assert.equal(interesseDoPerfil('interesse=qualquer'), null);
assert.equal(codigoClienteDoTexto('Olá! Sou Ana (código BP-1A2b3c4d). Preciso de ajuda'), '1a2b3c4d');
assert.equal(codigoClienteDoTexto('sem código'), null);

// ── 5. aprendizado ──
assert.equal(desfechoDaConversa({ optout_em: 'x' }, 'top2'), 'pediu para sair');
assert.match(desfechoDaConversa({ user_id: 'u' }, 'combo'), /pagante/);
assert.equal(desfechoDaConversa({}, null), 'sem conversão até agora');
assert.equal(transcricao([{ autor: 'pessoa', texto: 'oi' }, { autor: 'ia', texto: 'olá!' }, { autor: 'pessoa', texto: null }]), 'LEAD: oi\nIA: olá!');

console.log('✓ whatsapp evolution: webhook, envio, fila ativa, SAIR/interesse/código e aprendizado conferidos');
