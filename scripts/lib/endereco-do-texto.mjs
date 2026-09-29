// Endereço do lote a partir do TEXTO (título+descrição). Ver scripts/endereco-da-descricao.mjs.
import { extrairEnderecoMatricula } from '../../api/_registro-matricula.js';

const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const TIPOS = 'rua|avenida|av\\.?|travessa|estrada|rodovia|alameda|ladeira|largo|pra[çc]a';
const RE_LOGR = new RegExp(`\\b(?:${TIPOS})\\s+[A-Za-zÀ-ú0-9'’.\\- ]{3,50}?(?=\\s*[,;.]|\\s+n[º°o]|\\s+\\d|$)`, 'gi');
const RE_LEILOEIRO = /leiloeir|escrit[óo]rio|audit[óo]rio|\bsede\b|atendimento|visita[çc][ãa]o\s+agendad/i;

export function enderecoDoTexto(texto, cidade) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const f = extrairEnderecoMatricula(t);
  if (!f?.logradouro) return { motivo: 'sem_logradouro' };
  if (f.municipio && cidade && norm(f.municipio) !== norm(cidade)) return { motivo: 'outro_municipio' };
  const i = t.toLowerCase().indexOf(f.logradouro.toLowerCase());
  if (i >= 0 && RE_LEILOEIRO.test(t.slice(Math.max(0, i - 120), i + 80))) return { motivo: 'endereco_do_leiloeiro' };
  const distintos = new Set([...t.matchAll(RE_LOGR)].map((m) => norm(m[0]).slice(0, 30)));
  if (distintos.size > 1) return { motivo: 'varios_logradouros' };
  const depois = i >= 0 ? t.slice(i + f.logradouro.length, i + f.logradouro.length + 25) : '';
  const num = (depois.match(/^[,\s]*(?:n[º°o.]*\s*)?(\d{1,5})\b/i) || [])[1];
  const ceps = [...new Set([...t.matchAll(/\b(\d{5})-?(\d{3})\b/g)].map((m) => `${m[1]}${m[2]}`))];
  return {
    endereco: num ? `${f.logradouro}, ${num}` : f.logradouro,
    bairro: f.bairro || null,
    cep: ceps.length === 1 ? ceps[0] : null,
  };
}

