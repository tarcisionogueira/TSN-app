/**
 * scripts/testes/reforco-so-fala-com-quem-nao-respondeu.mjs
 *
 * O QUE ESTE TESTE SEGURA. O reforço do convite da aula manda e-mail para a base inteira de
 * clientes. Três coisas, se saírem erradas, saem erradas para ~70 caixas de entrada de uma vez
 * e não voltam:
 *
 *   1. A RÉGUA DE ETAPA. As faixas têm de ser contíguas e SEM SOBREPOSIÇÃO — duas etapas
 *      ativas no mesmo instante mandariam dois e-mails no mesmo dia para segmentos vizinhos.
 *   2. O PORTÃO DE HORÁRIO. Reforço às 3h da manhã é reforço queimado: a pessoa acorda com ele
 *      já enterrado. A janela larga (que existe para sobreviver a uma rodada perdida) só é
 *      segura porque este portão decide a HORA.
 *   3. OS ASSUNTOS. A etapa `assunto` existe justamente porque o assunto do convite não foi
 *      aberto por 52 pessoas. Reenviar com o MESMO assunto seria repetir o que falhou — e é o
 *      tipo de regressão que ninguém percebe lendo o diff.
 *
 * Por que `process.env` antes do import: o cron cria o cliente do Supabase no escopo do módulo
 * (como os outros crons desta base), então importar sem URL lança. Aqui só precisamos das
 * funções puras; os valores são de brinquedo e nenhuma chamada de rede acontece.
 */
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'teste';

const { etapaReforco, emHoraDeEnviar, horaNoFuso, corpoReforco } =
  await import('../../api/live-reforco-cron.js');

let falhas = 0;
const ok = (cond, oque, extra = '') => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra ? ` — ${extra}` : ''}`); }
};

// ── 1. A régua ───────────────────────────────────────────────────────────────
console.log('\nRÉGUA DE ETAPA');
const reguaEsperada = [
  [-1,   null],      [0,    null],      [2.9,  null],
  [3,    'ultima'],  [10,   'ultima'],  [19.9, 'ultima'],
  [20,   'prova'],   [34,   'prova'],   [43.9, 'prova'],
  [44,   'assunto'], [58,   'assunto'], [69.9, 'assunto'],
  [70,   null],      [83,   null],      [200,  null],
];
for (const [horas, esperado] of reguaEsperada) {
  const got = etapaReforco(horas);
  ok(got === esperado, `${String(horas).padStart(5)}h → ${esperado ?? 'nada'}`, `veio ${got}`);
}

// Contiguidade e exclusão mútua, varridas de meia em meia hora: em nenhum instante pode haver
// duas etapas, e dentro de [3, 70) não pode haver buraco.
console.log('\nSEM SOBREPOSIÇÃO E SEM BURACO EM [3h, 70h)');
let buracos = 0;
for (let h = 3; h < 70; h += 0.5) if (!etapaReforco(h)) buracos++;
ok(buracos === 0, 'toda hora entre 3h e 70h tem exatamente uma etapa', `${buracos} sem etapa`);

// ── 2. O calendário real: aula quarta 19h BRT, convite domingo 11h UTC ────────
console.log('\nCALENDÁRIO REAL (aula quarta 02/09 19h BRT = 22h UTC)');
const aula = Date.parse('2026-09-02T22:00:00Z');
const emQue = (iso) => etapaReforco((aula - Date.parse(iso)) / 3600000);
ok(emQue('2026-08-30T11:00:00Z') === null,      'domingo 11h (hora do convite, 83h antes) → nada');
ok(emQue('2026-08-31T12:00:00Z') === 'assunto', 'segunda 12h UTC (58h antes) → assunto');
ok(emQue('2026-09-01T12:00:00Z') === 'prova',   'terça 12h UTC (34h antes) → prova');
ok(emQue('2026-09-02T12:00:00Z') === 'ultima',  'quarta 12h UTC (10h antes) → ultima');
ok(emQue('2026-09-02T20:00:00Z') === null,      'quarta 20h UTC (2h antes) → nada: o lembrete "agora" cuida');

// ── 3. O portão de horário ───────────────────────────────────────────────────
console.log('\nPORTÃO DE HORÁRIO (fuso do evento, UTC-3)');
const emBRT = (iso, h) => { ok(horaNoFuso(Date.parse(iso)) === h, `${iso} é ${h}h no fuso do evento`, `veio ${horaNoFuso(Date.parse(iso))}h`); };
emBRT('2026-08-31T12:00:00Z', 9);
emBRT('2026-08-31T06:00:00Z', 3);
ok(emHoraDeEnviar(Date.parse('2026-08-31T06:00:00Z')) === false, '03h BRT (madrugada) NÃO envia');
ok(emHoraDeEnviar(Date.parse('2026-08-31T12:00:00Z')) === true,  '09h BRT envia');
ok(emHoraDeEnviar(Date.parse('2026-09-01T00:00:00Z')) === true,  '21h BRT ainda envia');
ok(emHoraDeEnviar(Date.parse('2026-09-01T01:00:00Z')) === false, '22h BRT não envia');

// ── 4. Os textos ─────────────────────────────────────────────────────────────
console.log('\nTEXTOS');
const ASSUNTO_DO_CONVITE = 'Quarta, 19h: eu avalio um imóvel de leilão ao vivo com você';
const ev = { slug: 'leilao-ao-vivo', titulo: 'Aula ao vivo', data_hora: '2026-09-02T22:00:00Z' };
const LINK = 'https://exemplo.test/aula/leilao-ao-vivo?utm_source=email';

const assuntos = new Set();
for (const etapa of ['assunto', 'prova', 'ultima']) {
  const c = corpoReforco(etapa, { nome: 'Maria Silva', ev, link: LINK, agora: aula - 10 * 3600000 });
  ok(!!c.subject, `[${etapa}] tem assunto`);
  ok(c.subject !== ASSUNTO_DO_CONVITE, `[${etapa}] assunto DIFERENTE do convite que já falhou`, c.subject);
  ok(!assuntos.has(c.subject), `[${etapa}] assunto diferente das outras etapas`, c.subject);
  assuntos.add(c.subject);
  ok(c.html.includes(LINK) && c.text.includes(LINK), `[${etapa}] o link está no HTML e no texto`);
  ok(c.html.includes('{{UNSUB}}'), `[${etapa}] o HTML traz o marcador de descadastro para o handler resolver`);
  ok(!c.text.includes('{{UNSUB}}'), `[${etapa}] a versão texto não vaza o marcador cru`);
  ok(c.html.includes('Maria'), `[${etapa}] chama pelo primeiro nome`);
  ok(!c.html.includes('Olá, !'), `[${etapa}] não produz saudação vazia`);
}

// Sem nome, a saudação não pode virar "Olá, !" — o detalhe que só aparece depois de já ter
// saído para todo mundo.
for (const nome of ['', null, '   ']) {
  const c = corpoReforco('prova', { nome, ev, link: LINK, agora: aula - 30 * 3600000 });
  ok(c.html.includes('Olá!') && !c.html.includes('Olá, !'), `nome ${JSON.stringify(nome)} → saudação sem vírgula solta`);
}

// "hoje" é afirmação de calendário: só pode aparecer quando de fato falta menos de um dia.
const ultimaHoje  = corpoReforco('ultima', { nome: 'Ana', ev, link: LINK, agora: aula - 10 * 3600000 });
const ultimaLonge = corpoReforco('ultima', { nome: 'Ana', ev, link: LINK, agora: aula - 30 * 3600000 });
ok(ultimaHoje.subject.includes('hoje'),  'ultima a 10h da aula diz "hoje"');
ok(!ultimaLonge.subject.includes('hoje'), 'ultima a 30h da aula NÃO diz "hoje"', ultimaLonge.subject);

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
