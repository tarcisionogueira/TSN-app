/**
 * POST /api/relatorio-pdf  { html } → { pdf: <base64> }  (só equipe)
 *
 * POR QUÊ (12/11, print do dono): o "Enviar ao Jurídico" anexava a Análise Documental / Parecer Final como
 * arquivo .html. Baixado e aberto no navegador o relatório aparece certo, mas a PRÉVIA do Gmail mostra .html
 * como CÓDIGO-FONTE — o advogado recebeu uma parede de <div style=…>. Aqui o MESMO HTML do "Baixar PDF" vira
 * PDF de verdade (texto selecionável, abre em qualquer prévia), no Chrome headless da função.
 *
 * O envio (api/enviar-email-caso.js) é Edge e não roda Chrome: quem chama este endpoint é a TELA
 * (EnviarEmailCasoLote.jsx), antes de enviar; se falhar, a tela cai para o .html e AVISA.
 *
 * Segurança: o HTML vem do navegador da equipe, montado pelo nosso código, mas o Chrome roda no servidor —
 * JavaScript desligado e nenhuma requisição sai, exceto a fonte do Google (o relatório usa Inter). Sem isso,
 * um <img src="http://interno…"> viraria SSRF.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { getUser, getUserRoleById } from './_auth.js';

const EQUIPE = ['admin', 'analista', 'consultor', 'advogado'];
const MAX_HTML = 1_500_000;          // mesmo teto do anexo .html em enviar-email-caso.js
const MAX_PDF = 3_000_000;           // a resposta (base64) precisa caber no limite de 4,5 MB da função
const HOSTS_PERMITIDOS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }
  const user = await getUser(req);
  if (!user?.id) { res.status(401).json({ error: 'Faça login' }); return; }
  if (!EQUIPE.includes(await getUserRoleById(user.id))) { res.status(403).json({ error: 'Só equipe' }); return; }

  const html = String(req.body?.html || '');
  if (!html.startsWith('<!DOCTYPE html>')) { res.status(400).json({ error: 'HTML do relatório inválido' }); return; }
  if (html.length > MAX_HTML) { res.status(413).json({ error: 'Relatório grande demais para PDF' }); return; }

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args, executablePath: await chromium.executablePath(), headless: true, defaultViewport: { width: 1240, height: 1754 },
    });
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (u.startsWith('data:') || u === 'about:blank') return r.continue();
      try { if (HOSTS_PERMITIDOS.has(new URL(u).hostname)) return r.continue(); } catch { /* URL inválida: cai no abort abaixo */ }
      return r.abort();
    });
    // A fonte é enfeite: se o Google demorar, o PDF sai com a fonte de reserva em vez de falhar.
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20000 }).catch(async (e) => {
      console.warn('[relatorio-pdf] setContent sem networkidle (segue com o que carregou):', e?.message);
    });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '9mm', bottom: '9mm', left: '9mm', right: '9mm' } });
    if (!pdf?.length || Buffer.from(pdf.subarray(0, 5)).toString() !== '%PDF-') throw new Error('o Chrome não devolveu um PDF');
    if (pdf.length > MAX_PDF) { res.status(413).json({ error: `PDF grande demais (${Math.round(pdf.length / 1024)} KB)` }); return; }
    res.status(200).json({ pdf: Buffer.from(pdf).toString('base64'), bytes: pdf.length });
  } catch (e) {
    console.error('[relatorio-pdf] falhou:', e?.message);
    res.status(502).json({ error: `Não consegui gerar o PDF: ${e?.message || 'erro'}` });
  } finally {
    if (browser) await browser.close().catch((e) => console.warn('[relatorio-pdf] fechar o Chrome:', e?.message));
  }
}
