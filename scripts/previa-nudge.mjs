#!/usr/bin/env node
/**
 * PRÉVIA do e-mail de ativação — renderiza o HTML REAL, com a MESMA função que o cron usa
 * para enviar (`corpo`, exportada de api/ativacao-nudge-cron.js). Reimplementar o template
 * numa prévia não prova nada: o que o dono aprova tem de ser o que o cliente recebe.
 *
 * Uso: node scripts/previa-nudge.mjs <arquivo-de-dados.json> > previa.html
 * O JSON traz { nome, etapa, cidade, imoveis: [...] } — os dados vêm do banco, não inventados.
 */
import { readFileSync } from 'node:fs';
import { corpo } from '../api/ativacao-nudge-cron.js';

const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const html = corpo({
  nome: d.nome, etapa: d.etapa, imoveis: d.imoveis, cidade: d.cidade,
  unsubUrl: 'https://www.bidprobrasil.com.br/api/cancelar-alertas?token=EXEMPLO',
});
const assunto = d.etapa === 'd2'
  ? 'Suas 3 análises gratuitas estão esperando'
  : 'O desconto que aparece no leilão não é o desconto real';
process.stdout.write(`<div style="max-width:640px;margin:24px auto;font-family:Arial,Helvetica,sans-serif">
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:13px;color:#475569">
    <div><strong>Assunto:</strong> ${assunto}</div>
    <div><strong>Para:</strong> ${d.nome} — ${d.cidade}/${d.uf} · etapa <strong>${d.etapa}</strong> (D+${d.etapa === 'd2' ? 2 : 7})</div>
    <div style="margin-top:6px;color:#94a3b8">Prévia gerada pela MESMA função que envia. Imóveis reais do acervo de hoje.</div>
  </div>
  ${html}
</div>`);
