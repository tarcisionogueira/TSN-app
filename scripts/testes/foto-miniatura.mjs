// Foto leve na busca (30/09): CDN pesada → miniatura pelo proxy primeiro, original de reserva;
// hotlink protegido por Referer → nunca tenta direto; demais → direto primeiro, como antes.
import assert from 'node:assert/strict';
import { fotoCandidatos } from '../../src/utils/foto.js';

const pesada = 'https://static.suporteleiloes.com.br/x/bens/1/arquivos/a.jpg';
const c1 = fotoCandidatos({ foto: pesada, fonte: 'SUPORTE', imovelId: null });
assert.equal(c1[0], `/api/img-proxy?url=${encodeURIComponent(pesada)}&w=480`);
assert.equal(c1[1], pesada, 'original direto fica de reserva');
assert.equal(fotoCandidatos({ foto: pesada, fonte: 'SUPORTE', largura: 800 })[0].endsWith('&w=800'), true);

const hasta = 'https://s3-sa-east-1.amazonaws.com/cdnhp/fotos/1.jpg';
const c2 = fotoCandidatos({ foto: hasta, fonte: 'HASTAPUBLICA' });
assert.ok(!c2.includes(hasta), 'hotlink protegido não é tentado direto');
assert.ok(c2[0].includes('&w=480'));

const leve = 'https://cdn1.megaleiloes.com.br/batches/1/a_320x240.jpg';
assert.equal(fotoCandidatos({ foto: leve, fonte: 'MEGA' })[0], leve, 'CDN leve continua direta');
assert.deepEqual(fotoCandidatos({ foto: 'https://x.supabase.co/a.jpg', fonte: 'CEF' }), ['https://x.supabase.co/a.jpg']);
console.log('foto-miniatura: todos os casos passaram');
