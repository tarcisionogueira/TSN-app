// PRAZO DE RESPOSTA DA EQUIPE (07/11, decisão do dono): até 24 h quando o pedido chega em DIA ÚTIL e até 48 h
// quando chega em fim de semana ou feriado nacional. Hora de Brasília (UTC−3, sem horário de verão).
// O cliente vê a data e a hora calculadas ("até sex., 08/11 às 14:30"), não um "3 dias úteis" genérico —
// e o health-check usa a MESMA conta para dizer quem está atrasado.

const FUSO_MS = -3 * 3600 * 1000;

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), em UTC à meia-noite.
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(ano, mes - 1, dia);
}

const DIA = 86400000;
const chave = (t) => new Date(t).toISOString().slice(0, 10);

// Feriados nacionais (fixos + móveis da Páscoa: Carnaval seg/ter, Sexta-feira Santa, Corpus Christi).
export function feriadosNacionais(ano) {
  const p = pascoa(ano);
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map((md) => `${ano}-${md}`);
  return new Set([...fixos, chave(p - 48 * DIA), chave(p - 47 * DIA), chave(p - 2 * DIA), chave(p + 60 * DIA)]);
}

// Data local (Brasília) "AAAA-MM-DD" e dia da semana do instante.
function local(t) {
  const d = new Date(new Date(t).getTime() + FUSO_MS);
  return { dataIso: d.toISOString().slice(0, 10), dow: d.getUTCDay(), ano: d.getUTCFullYear() };
}

export function ehDiaUtil(t = Date.now()) {
  const { dataIso, dow, ano } = local(t);
  return dow !== 0 && dow !== 6 && !feriadosNacionais(ano).has(dataIso);
}

export function horasDoPrazo(desde = Date.now()) { return ehDiaUtil(desde) ? 24 : 48; }
// `horas` vem do banco (atendimento_prazo_horas, que aplica a regra atendimento.prazo_resposta_equipe);
// a conta local só entra quando o banco não respondeu.
export function prazoRespostaEquipe(desde = Date.now(), horas = null) {
  return new Date(new Date(desde).getTime() + (horas || horasDoPrazo(desde)) * 3600 * 1000);
}

const SEMANA = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
export function textoPrazo(desde = Date.now(), horas = null) {
  const p = new Date(prazoRespostaEquipe(desde, horas).getTime() + FUSO_MS);
  const dd = String(p.getUTCDate()).padStart(2, '0'), mm = String(p.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(p.getUTCHours()).padStart(2, '0'), mi = String(p.getUTCMinutes()).padStart(2, '0');
  return `até ${SEMANA[p.getUTCDay()]}, ${dd}/${mm} às ${hh}:${mi}`;
}

export const REGRA_PRAZO = 'até 24 h em dia útil e até 48 h em fim de semana e feriado';
