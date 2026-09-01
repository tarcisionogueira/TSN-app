/**
 * npm run testar:ig-motor — as decisões do motor, travadas antes de existir envio.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Este teste roda inteiro SEM REDE e sem permissão da Meta, que é o ponto: as decisões
 * caras do motor são puras de propósito, para poderem ser verificadas hoje em vez de
 * descobertas em produção, numa conta com 9.730 seguidores.
 *
 * O que ele trava, e por que cada um é silencioso se quebrar:
 *
 *  1. FALHA DE LEITURA VIRANDO CLASSE PLAUSÍVEL. Se `lerClasse` devolvesse uma classe
 *     quando não conseguiu parsear, um erro de leitura viraria resposta automática sobre
 *     um assunto que ninguém confirmou. Forma de falha nº 1 desta base, agora em cima de
 *     mensagem de gente real.
 *
 *  2. O PISO DE CONFIANÇA APLICADO NO LUGAR ERRADO. Se cada chamador aplicasse o piso, um
 *     deles esqueceria — e a mensagem sairia com a classe que o modelo chutou. O piso mora
 *     dentro de `lerClasse`, e o teste prova que 0.69 vira `outro`.
 *
 *  3. A TRAVA DA PERSONA DERROTADA POR UM ACENTO. `normalize` + remoção de diacrítico não é
 *     capricho: "lucro garantído" passaria por um `includes` ingênuo, e promessa de retorno
 *     em leilão é risco regulatório.
 *
 *  4. ORDEM DAS TRAVAS. A persona é checada ANTES da autonomia. Se fosse depois, um texto
 *     proibido numa classe não-autônoma sairia com motivo "classe_nao_autonoma" — e o dono
 *     nunca saberia que o modelo prometeu lucro.
 */
import {
  lerClasse, violaPersona, decidirEnvio, montarExemplos, montarPromptRedacao, PISO_CONFIANCA,
} from '../../api/_ig-motor.js';

const CLASSES = ['quer_link', 'duvida_leilao', 'quem_e_voce', 'elogio', 'preco', 'reclamacao', 'juridico', 'spam', 'outro'];
const PERSONA = { instrucao: 'Escreva como o Tarcisio.', nunca_dizer: ['lucro garantido', 'sem risco'] };

let ok = 0, falhas = 0;
function checa(nome, cond, detalhe = '') {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}

console.log('\n── 1. "Não consegui ler" nunca vira classe ──');
for (const [rotulo, entrada] of [
  ['texto solto', 'não sei dizer'],
  ['JSON quebrado', '{"classe":"preco", "confianca":'],
  ['nulo', null],
  ['número', 42],
  ['vazio', ''],
]) {
  const r = lerClasse(entrada, CLASSES);
  checa(`${rotulo} → outro/0`, r.classe === 'outro' && r.confianca === 0, JSON.stringify(r));
}
checa('classe inventada pelo modelo é recusada',
  lerClasse('{"classe":"vender_curso","confianca":0.99}', CLASSES).classe === 'outro');
checa('confiança fora de 0-1 é recusada',
  lerClasse('{"classe":"preco","confianca":7}', CLASSES).classe === 'outro');
checa('confiança ausente é recusada',
  lerClasse('{"classe":"preco"}', CLASSES).classe === 'outro');

console.log('\n── 2. O piso de confiança mora dentro do leitor ──');
checa('acima do piso mantém a classe',
  lerClasse(`{"classe":"preco","confianca":${PISO_CONFIANCA}}`, CLASSES).classe === 'preco');
const abaixo = lerClasse(`{"classe":"preco","confianca":${PISO_CONFIANCA - 0.01}}`, CLASSES);
checa('logo abaixo do piso vira outro', abaixo.classe === 'outro', JSON.stringify(abaixo));
checa('e preserva a confiança medida, para dar para auditar', abaixo.confianca === PISO_CONFIANCA - 0.01);
checa('JSON dentro de cerca markdown ainda é lido',
  lerClasse('```json\n{"classe":"elogio","confianca":0.9}\n```', CLASSES).classe === 'elogio');
checa('texto ANTES do JSON ainda é lido',
  lerClasse('Claro! {"classe":"elogio","confianca":0.9}', CLASSES).classe === 'elogio');

console.log('\n── 3. A trava da persona não cai por acento nem por caixa ──');
checa('frase exata é pega', violaPersona('aqui tem lucro garantido', PERSONA.nunca_dizer) === 'lucro garantido');
checa('MAIÚSCULA é pega', violaPersona('LUCRO GARANTIDO', PERSONA.nunca_dizer) === 'lucro garantido');
checa('acento é pego', violaPersona('lucro garantído no leilão', PERSONA.nunca_dizer) === 'lucro garantido');
checa('acento + caixa é pego', violaPersona('LUCRO GARANTÍDO', PERSONA.nunca_dizer) === 'lucro garantido');
checa('texto limpo passa', violaPersona('o risco existe e eu mostro qual é', PERSONA.nunca_dizer) === null);
checa('lista vazia não trava nada', violaPersona('qualquer coisa', []) === null);
// Devolver QUAL frase, e não `true`, é o que faz o rascunho chegar ao dono com motivo.
checa('devolve a frase, não um booleano', typeof violaPersona('sem risco nenhum', PERSONA.nunca_dizer) === 'string');

console.log('\n── 4. A decisão, e a ordem em que ela testa ──');
const base = { estado: 'bot', classe: 'quer_link', autonomo: true, expirado: false, janela: 'dm_24h' };

checa('classe autônoma + texto limpo → enviar',
  decidirEnvio({ item: base, texto: 'te mando o link', persona: PERSONA }).acao === 'enviar');
checa('classe NÃO autônoma → rascunho',
  decidirEnvio({ item: { ...base, autonomo: false }, texto: 'oi', persona: PERSONA }).motivo === 'classe_nao_autonoma');
checa('conversa assumida pelo dono → rascunho',
  decidirEnvio({ item: { ...base, estado: 'humano' }, texto: 'oi', persona: PERSONA }).motivo === 'conversa_humano');
checa('spam → ignorar (não é rascunho: não é conversa)',
  decidirEnvio({ item: { ...base, classe: 'spam' }, texto: 'oi', persona: PERSONA }).acao === 'ignorar');
checa('texto vazio → rascunho, nunca enviar',
  decidirEnvio({ item: base, texto: '   ', persona: PERSONA }).acao === 'rascunho');

// A ordem importa: expirado é testado ANTES de tudo, e não vira rascunho — vira PERDA.
// Um rascunho de janela expirada seria pior que inútil: sugeriria ao dono que ainda dá
// tempo de mandar, e não dá.
const exp = decidirEnvio({ item: { ...base, expirado: true }, texto: 'oi', persona: PERSONA });
checa('janela expirada → perdido, não rascunho', exp.acao === 'perdido' && exp.motivo === 'janela_expirada');

// A persona vence a autonomia — e o motivo tem de dizer PERSONA, não "classe".
const proibido = decidirEnvio({ item: base, texto: 'é lucro garantido', persona: PERSONA });
checa('texto proibido em classe autônoma → rascunho', proibido.acao === 'rascunho');
checa('e o motivo nomeia a frase proibida', proibido.motivo === 'persona_proibida:lucro garantido', proibido.motivo);
const proibidoNaoAuto = decidirEnvio({ item: { ...base, autonomo: false }, texto: 'sem risco', persona: PERSONA });
checa('persona é checada ANTES da autonomia (motivo não é "classe_nao_autonoma")',
  proibidoNaoAuto.motivo === 'persona_proibida:sem risco', proibidoNaoAuto.motivo);
checa('toda decisão carrega motivo',
  ['enviar', 'rascunho', 'perdido', 'ignorar'].every((_) => true)
  && !!decidirEnvio({ item: base, texto: 'ok', persona: PERSONA }).motivo);

console.log('\n── 5. O corpus de treino é só do dono ──');
const historico = [
  { autor: 'dono',   texto: 'depende da praça. me diz a cidade' },
  { autor: 'bot',    texto: 'Olá! Como posso ajudar você hoje? 😊' },
  { autor: 'pessoa', texto: 'e aí' },
  { autor: 'dono',   texto: 'esse eu não pegaria. a matrícula tem penhora' },
  { autor: 'dono',   texto: '   ' },
];
const ex = montarExemplos(historico);
checa('inclui o que o dono escreveu', ex.includes('depende da praça'));
// Se o bot entrasse aqui, ele reforçaria o próprio estilo a cada rodada e derivaria.
checa('NÃO inclui o que o bot escreveu', !ex.includes('Como posso ajudar'));
checa('NÃO inclui o que a pessoa escreveu', !ex.includes('e aí'));
checa('descarta exemplo em branco do dono', !ex.includes('- \n') && ex.split('\n- ').length === 3);
checa('sem exemplo nenhum devolve string vazia, não texto de molde', montarExemplos([]) === '');
checa('histórico só de bot devolve vazio', montarExemplos([{ autor: 'bot', texto: 'x' }]) === '');

console.log('\n── 6. O prompt sabe qual janela está gastando ──');
const pr = montarPromptRedacao({ item: { janela: 'private_reply' }, persona: PERSONA, oferta: null });
checa('private reply avisa que é tiro único', pr.includes('ÚNICA'));
checa('e proíbe o "te chamei no direct"', pr.toLowerCase().includes('te chamei no direct'));
const dm = montarPromptRedacao({ item: { janela: 'dm_24h' }, persona: PERSONA, oferta: null });
checa('dm pede UMA pergunta', dm.includes('UMA pergunta'));
// Sem oferta cadastrada o modelo tem de ser proibido de inventar link — senão ele inventa,
// e um link inventado numa DM é pior do que não responder.
checa('sem oferta, proíbe inventar link', dm.includes('NÃO invente link'));
const comOferta = montarPromptRedacao({
  item: { janela: 'dm_24h' }, persona: PERSONA,
  oferta: { titulo: 'Aula ao vivo', link: 'https://x/aula', intencao: 'se inscrever' },
});
checa('com oferta, o link entra', comOferta.includes('https://x/aula'));
checa('e a intenção também', comOferta.includes('se inscrever'));

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 38) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
