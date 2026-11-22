// Gatilho de palavra-chave do Instagram (22/11): casa a palavra certa, no post certo, e monta o direct.
import { normalizar, casarGatilho, montarMensagem, sortearPublica } from '../../api/instagram-gatilhos.js';
import { validarGatilho } from '../../api/admin-ig-gatilhos.js';
import { lerComentario, lerMensagem } from '../../api/instagram-webhook.js';
import { precisaRenovar } from '../../api/ig-token-cron.js';

let ok = 0, falhou = 0;
const t = (nome, cond) => { if (cond) { ok++; console.log('  ✓', nome); } else { falhou++; console.log('  ✗', nome); } };

const geral = { id: 1, palavra: 'Patrimônio', media_id: null, ativo: true, mensagem_dm: 'Oi {nome}! Segue o material:', link: 'https://x.com/m', respostas_publicas: ['A', 'B'] };
const doPost = { id: 2, palavra: 'patrimonio', media_id: 'P9', ativo: true, mensagem_dm: 'Material do post {link}', link: 'https://x.com/p' };
const pausado = { id: 3, palavra: 'leilao', ativo: false, mensagem_dm: 'x' };
const vencido = { id: 4, palavra: 'carro', ativo: true, valido_ate: '2020-01-01', mensagem_dm: 'x' };
const G = [geral, doPost, pausado, vencido];

t('normaliza acento, caixa e pontuação', normalizar('PATRIMÔNIO!!!') === 'patrimonio');
t('casa a palavra sozinha', casarGatilho('PATRIMÔNIO', 'X1', G)?.id === 1);
t('casa no meio da frase', casarGatilho('quero o material de patrimonio por favor 🙏', 'X1', G)?.id === 1);
t('casa com hashtag', casarGatilho('#patrimonio', 'X1', G)?.id === 1);
t('NÃO casa pedaço de palavra', casarGatilho('patrimoniologia', 'X1', G) === null);
t('gatilho do post ganha do geral no post dele', casarGatilho('patrimônio', 'P9', G)?.id === 2);
t('gatilho de post não vale em outro post', casarGatilho('xyz', 'P9', [doPost]) === null && casarGatilho('patrimonio', 'OUTRO', [doPost]) === null);
t('gatilho pausado não dispara', casarGatilho('leilão', 'X1', G) === null);
t('gatilho vencido não dispara', casarGatilho('carro', 'X1', G) === null);
t('comentário vazio não casa', casarGatilho('', 'X1', G) === null && casarGatilho(null, 'X1', G) === null);

const m1 = montarMensagem(geral, 'joao.silva');
t('{nome} vira o @ e o link entra no fim', m1 === 'Oi @joao.silva! Segue o material:\n\nhttps://x.com/m');
t('{link} no meio não duplica o link', montarMensagem(doPost, 'a') === 'Material do post https://x.com/p');
t('sem username não sobra espaço solto', montarMensagem(geral, null).startsWith('Oi ! ') === false);
t('sorteia entre as respostas públicas', ['A', 'B'].includes(sortearPublica(geral)) && sortearPublica({ respostas_publicas: [] }) === null);

t('validação: palavra curta recusada', !!validarGatilho({ palavra: 'a', mensagem_dm: 'mensagem ok' }));
t('validação: link sem http recusado', !!validarGatilho({ palavra: 'casa', mensagem_dm: 'mensagem ok', link: 'www.x.com' }));
t('validação: gatilho certo passa', validarGatilho({ palavra: 'casa', mensagem_dm: 'mensagem ok', link: 'https://x.com' }) === null);

const c = lerComentario({ value: { id: '77', text: 'patrimonio', from: { id: '5', username: 'z' }, media: { id: 'P9' } } }, 1700000000, 'NOSSA');
t('webhook guarda o post do comentário', c?.media_id === 'P9');
const d = lerMensagem({ sender: { id: '5' }, recipient: { id: '1' }, timestamp: 1700000000000, message: { mid: 'm1', text: 'oi' } });
t('DM tem as MESMAS chaves do comentário (insert em lote do PostgREST)', d && 'media_id' in d
  && Object.keys(d).sort().join() === Object.keys((({ username, ...r }) => r)(c)).sort().join());

const hoje = new Date('2026-11-22T12:00:00Z');
t('token novo (2 dias, vale 57) não renova', precisaRenovar({ token: 'x', renovado_em: '2026-11-20', expira_em: '2027-01-18' }, hoje) === false);
t('token de 8 dias renova', precisaRenovar({ token: 'x', renovado_em: '2026-11-14', expira_em: '2027-01-12' }, hoje) === true);
t('token perto de vencer renova mesmo novo', precisaRenovar({ token: 'x', renovado_em: '2026-11-21', expira_em: '2026-12-05' }, hoje) === true);
t('sem token não tenta', precisaRenovar(null, hoje) === false);

console.log(`\n${falhou ? '✗' : '✓'} ${ok}/${ok + falhou} asserções`);
if (falhou) process.exit(1);
