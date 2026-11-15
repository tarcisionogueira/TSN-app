// O link do anúncio existe? (15/11) — casos reais de Capão da Canoa medidos via pg_net.
import assert from 'node:assert/strict';
import { vereditoLink } from '../../api/_link-anuncio.js';

const zap = 'https://www.zapimoveis.com.br/imovel/venda/apartamento-2-quartos-centro-capao-da-canoa-rs-75m2-id-2503947480/';
assert.equal(vereditoLink({ url: zap, status: 404, final: zap }), 'morto', 'Zap 404 (ID sequencial inventado)');
assert.equal(vereditoLink({ url: zap, status: 410, final: zap }), 'morto');
const olx = 'https://www.olx.com.br/imoveis/anuncio/apartamento-a-venda-rua-do-copo-de-leite-posto-4-capao-novo-id-1547488380';
assert.equal(vereditoLink({ url: olx, status: 200, final: 'https://www.olx.com.br/imoveis' }), 'morto', 'OLX joga anúncio inexistente na listagem');
assert.equal(vereditoLink({ url: olx, status: 200, final: 'https://olx.com.br/' }), 'morto', 'raiz, com ou sem www');
assert.equal(vereditoLink({ url: olx, status: 200, final: olx }), 'vivo');
assert.equal(vereditoLink({ url: olx, status: 403, final: olx }), 'incerto', 'anti-robô não é prova');
assert.equal(vereditoLink({ url: olx, status: 429, final: olx }), 'incerto', 'Vercel Security Checkpoint (Crédito Real)');
assert.equal(vereditoLink({ url: olx, status: 503, final: olx }), 'incerto');
assert.equal(vereditoLink({ url: olx, status: 200, final: 'https://outro.com.br/' }), 'vivo', 'redirecionar para OUTRO domínio não condena');
assert.equal(vereditoLink({ url: 'https://imob.com.br/', status: 200, final: 'https://imob.com.br/' }), 'vivo', 'link que já era a raiz não é "caiu na raiz"');
console.log('link-anuncio: ok');
