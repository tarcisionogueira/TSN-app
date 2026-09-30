// Teste do leitor de contato do ORGANIZADOR do evento Superbid (api/_contato-lote.js).
// Fixture = campos reais da oferta 4995864 (Montana LS 2015, evento 785731), medidos em 30/09.
import assert from 'node:assert/strict';
import { contatoDoEventoSuperbid, fonteComContatoNaPagina } from '../../api/_contato-lote.js';

const pagina = (dados) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(dados)}</script></html>`;
const evento = { id: 785731, desc: 'Tijolarte', managerId: 9, managerName: 'SOLD MAISATIVO',
  ticker: '+55 11 94782-4377 :: atendimento.infraenergia@superbid.net ::  :: ' };
const outroEvento = { id: 111, managerName: 'OUTRO', ticker: '+55 11 0000-0000 :: errado@x.com :: :: ' };
const html = pagina({ props: { pageProps: {
  offerDetails: { offers: [{ id: 4995864, auction: { id: 785731 } }] },
  eventDetails: { events: [outroEvento, evento] },
} } });

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log('ok -', nome); };

t('acha o organizador do evento certo', () => {
  const { contato, motivo } = contatoDoEventoSuperbid(html, '785731');
  assert.equal(motivo, null);
  assert.equal(contato.organizador, 'SOLD MAISATIVO');
  assert.equal(contato.email, 'atendimento.infraenergia@superbid.net');
  assert.equal(contato.telefone, '+55 11 94782-4377');
  assert.match(contato.caminho, /Sobre o evento/);
});

t('nunca usa o contato de OUTRO evento', () => {
  const { contato, motivo } = contatoDoEventoSuperbid(html, '999');
  assert.equal(contato, null);
  assert.match(motivo, /não encontrado/);
});

t('internalParameters de oferta do MESMO evento têm precedência (e só do mesmo)', () => {
  const h = pagina({ a: [
    { auction: { id: 111 }, internalParameters: { contactEmailAddress: 'errado@x.com' } },
    { auction: { id: 785731 }, internalParameters: { contactEmailAddress: 'certo@superbid.net', contactWhatsappNumber: '+55 11 90000-0000' } },
    evento] });
  const { contato } = contatoDoEventoSuperbid(h, 785731);
  assert.equal(contato.email, 'certo@superbid.net');
  assert.equal(contato.whatsapp, '+55 11 90000-0000');
  assert.equal(contato.organizador, 'SOLD MAISATIVO');
});

t('página sem __NEXT_DATA__ diz o motivo (não "sem contato")', () => {
  const { contato, motivo } = contatoDoEventoSuperbid('<html></html>', 785731);
  assert.equal(contato, null);
  assert.match(motivo, /__NEXT_DATA__/);
});

t('só SUPERBID usa contato por evento', () => {
  assert.equal(fonteComContatoNaPagina('SUPERBID'), true);
  assert.equal(fonteComContatoNaPagina('JRF'), false);
});

console.log(`${ok} ok`);
