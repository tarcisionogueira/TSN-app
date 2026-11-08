// O aviso do Mercado Pago se perde no 308 do domínio sem www (08/11): a URL precisa sair no destino final.
import assert from 'node:assert/strict';
import { urlWebhookMp } from '../../api/_mp-webhook-url.js';

const FINAL = 'https://www.bidprobrasil.com.br/api/mp-webhook';
assert.equal(urlWebhookMp('https://bidprobrasil.com.br'), FINAL);
assert.equal(urlWebhookMp('https://bidprobrasil.com.br/'), FINAL);
assert.equal(urlWebhookMp('http://bidprobrasil.com.br'), FINAL);
assert.equal(urlWebhookMp('https://www.bidprobrasil.com.br'), FINAL);
assert.equal(urlWebhookMp(''), FINAL);
assert.equal(urlWebhookMp('https://preview.vercel.app'), 'https://preview.vercel.app/api/mp-webhook');
console.log('ok: URL do webhook do MP sem redirect');
