import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, TrendingUp, Bell } from 'lucide-react';

// Painel global + calendário da tela de Assessorados (26/11, pedido do dono). Os dados vêm
// prontos de /api/admin-assessorados (api/_agenda-leiloes.js) — a mesma agenda que dispara o
// e-mail de véspera e do dia (api/leiloes-agenda-cron.js).

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const TZ = 'America/Sao_Paulo';
const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Um bloco por classe de ativo (26/11: imóveis + veículos). Mesma régua nos dois — o rótulo da
// avaliação muda (FIPE no veículo) e as notas dizem o que ficou de fora ou usou outra base.
function BlocoTotais({ t, nome, rotuloAval, semAvalTxt, rotuloMercadoFonte }) {
  // Economia = quanto a aquisição ficou abaixo do VALOR DE MERCADO (26/11, dono): a avaliação
  // do leiloeiro aparece só como referência, porque muitas vezes está errada.
  const economia = t.base_lucro_aquisicao > 0 && t.lucro_bruto
    ? Math.round((t.lucro_bruto / (t.lucro_bruto + t.base_lucro_aquisicao)) * 100) : null;
  const notasMercado = [
    t.mercado_pela_venda ? `${t.mercado_pela_venda} pelo valor de venda` : null,
    t.mercado_pela_avaliacao ? `${t.mercado_pela_avaliacao} sem ${rotuloMercadoFonte}: usou ${rotuloAval.toLowerCase()}` : null,
    t.sem_mercado ? `${t.sem_mercado} sem referência` : null,
  ].filter(Boolean).join(' · ');
  const cards = [
    { t: `${nome} realizados`, v: t.qtd, num: true, cor: '#0f172a',
      sub: `${t.em_andamento} em andamento · ${t.concluidas} concluído${t.concluidas === 1 ? '' : 's'}${t.proprias ? ` · ${t.proprias} próprio${t.proprias === 1 ? '' : 's'}` : ''}` },
    { t: 'Valor de mercado', v: brl(t.valor_mercado), cor: '#7c3aed', sub: notasMercado || `pelo ${rotuloMercadoFonte}` },
    { t: rotuloAval, v: brl(t.valor_avaliacao), cor: '#64748b', sub: t.sem_avaliacao ? `${t.sem_avaliacao} ${semAvalTxt}` : 'referência do leilão' },
    { t: 'Valor de aquisição', v: brl(t.valor_aquisicao), cor: '#0D63DB', sub: t.sem_aquisicao ? `${t.sem_aquisicao} sem valor de arremate` : 'soma dos arremates' },
    { t: 'Lucro bruto projetado', v: brl(t.lucro_bruto), cor: '#15803d',
      sub: economia != null ? `economia de ${economia}% sobre o mercado${t.base_lucro_qtd < t.qtd ? ` · ${t.base_lucro_qtd} de ${t.qtd}` : ''}` : 'mercado − aquisição' },
  ];
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#475569', marginBottom: 6 }}>{nome}</div>
      {t.qtd === 0
        ? <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Nenhuma operação registrada ainda.</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 10 }}>
            {cards.map((c) => (
              <div key={c.t} style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
                <div style={{ fontSize: c.num ? 22 : 16, fontWeight: 900, color: c.cor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.v}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{c.t}</div>
                <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{c.sub}</div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

export function PainelGlobal({ totais }) {
  // `null` = o servidor não conseguiu ler. Mostrar R$ 0 aqui seria inventar resultado.
  if (totais === null) {
    return <div style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', borderRadius: 12, padding: '10px 14px', fontSize: 12.5, marginBottom: 14 }}>
      Não consegui ler os valores das operações realizadas agora. Recarregue em instantes.
    </div>;
  }
  if (!totais?.imoveis) return null;
  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 800, color: '#15803d', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        <TrendingUp size={15} /> Operações realizadas pelo sistema
      </div>
      <BlocoTotais t={totais.imoveis} nome="Imóveis" rotuloAval="Avaliação do leiloeiro" semAvalTxt="sem avaliação informada" rotuloMercadoFonte="relatório mercadológico" />
      {totais.veiculos && <BlocoTotais t={totais.veiculos} nome="Veículos" rotuloAval="FIPE" semAvalTxt="sem FIPE informada (preencha em Veículos arrematados)" rotuloMercadoFonte="relatório (média de anúncios)" />}
    </div>
  );
}

function horaDe(ev) {
  if (!ev.hora_conhecida) return 'horário a confirmar';
  return new Date(ev.quando).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}
function dataLonga(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d, 12)).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' });
}

function ItemEvento({ ev, hoje, onAbrir }) {
  const passado = ev.dia < hoje;
  const ehHoje = ev.dia === hoje;
  return (
    <div onClick={() => onAbrir(ev)} style={{ display: 'flex', gap: 10, padding: '10px 12px', borderTop: '1px solid #f1f5f9', cursor: 'pointer', opacity: passado ? 0.55 : 1 }}>
      <div style={{ minWidth: 62, textAlign: 'center' }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: ehHoje ? '#c2410c' : '#0D63DB', textTransform: 'capitalize' }}>{ehHoje ? 'Hoje' : dataLonga(ev.dia)}</div>
        <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{horaDe(ev)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{ev.cliente_nome}</div>
        <div style={{ fontSize: 12, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ev.titulo}{ev.cidade ? ` · ${ev.cidade}${ev.uf ? `/${ev.uf}` : ''}` : ''}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          {ev.praca ? `${ev.praca}ª praça · ` : ''}{ev.lance_minimo ? `lance mín. ${brl(ev.lance_minimo)}` : ''}{ev.avaliacao ? ` · aval. ${brl(ev.avaliacao)}` : ''}
          {ev.origem === 'aprovada' ? ' · aprovado pelo cliente' : ' · caso contratado'}
          {!ev.lote_ativo && <span style={{ color: '#c2410c' }}> · lote saiu do acervo: conferir</span>}
        </div>
      </div>
    </div>
  );
}

export function CalendarioLeiloes({ agenda, onAbrirCliente }) {
  const hoje = hojeISO();
  const [ano0, mes0] = hoje.split('-').map(Number);
  const [ref, setRef] = useState({ ano: ano0, mes: mes0 - 1 });
  const [diaSel, setDiaSel] = useState(null);

  const porDia = useMemo(() => {
    const m = new Map();
    for (const ev of agenda || []) { if (!m.has(ev.dia)) m.set(ev.dia, []); m.get(ev.dia).push(ev); }
    return m;
  }, [agenda]);

  if (agenda === null) {
    return <div style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', borderRadius: 12, padding: '10px 14px', fontSize: 12.5, marginBottom: 14 }}>
      Não consegui ler a agenda de leilões agora — o calendário não está vazio, está sem dados. Recarregue em instantes.
    </div>;
  }
  if (!agenda) return null;

  const primeiro = new Date(Date.UTC(ref.ano, ref.mes, 1));
  const diasNoMes = new Date(Date.UTC(ref.ano, ref.mes + 1, 0)).getUTCDate();
  const offset = primeiro.getUTCDay();
  const celulas = [...Array(offset).fill(null), ...Array.from({ length: diasNoMes }, (_, i) => i + 1)];
  const isoDia = (d) => `${ref.ano}-${String(ref.mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const mover = (n) => { setDiaSel(null); setRef((r) => { const d = new Date(Date.UTC(r.ano, r.mes + n, 1)); return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() }; }); };

  const proximos = agenda.filter((e) => e.dia >= hoje);
  const lista = diaSel ? (porDia.get(diaSel) || []) : proximos.slice(0, 12);

  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '12px 16px 4px', fontSize: 12, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        <CalendarDays size={15} /> Agenda de leilões em andamento
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: '#94a3b8', textTransform: 'none', letterSpacing: 0 }}>
          <Bell size={11} /> aviso por e-mail na véspera e no dia
        </span>
      </div>
      <div style={{ padding: '4px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 8px' }}>
          <button onClick={() => mover(-1)} aria-label="Mês anterior" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', display: 'flex' }}><ChevronLeft size={18} /></button>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#111', textTransform: 'capitalize' }}>{MESES[ref.mes]} {ref.ano}</div>
          <button onClick={() => mover(1)} aria-label="Próximo mês" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', display: 'flex' }}><ChevronRight size={18} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3, textAlign: 'center' }}>
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <div key={i} style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', padding: '2px 0' }}>{d}</div>)}
          {celulas.map((d, i) => {
            if (!d) return <div key={`v${i}`} />;
            const iso = isoDia(d);
            const evs = porDia.get(iso) || [];
            const sel = diaSel === iso;
            const ehHoje = iso === hoje;
            return (
              <button key={iso} onClick={() => evs.length && setDiaSel(sel ? null : iso)} style={{
                border: sel ? '1.5px solid #0D63DB' : ehHoje ? '1.5px solid #cbd5e1' : '1px solid transparent',
                background: evs.length ? (iso < hoje ? '#f1f5f9' : '#eff6ff') : 'white',
                borderRadius: 8, padding: '6px 0 4px', cursor: evs.length ? 'pointer' : 'default', minHeight: 38,
              }}>
                <div style={{ fontSize: 12.5, fontWeight: evs.length ? 800 : 500, color: evs.length ? (iso < hoje ? '#64748b' : '#0D63DB') : '#334155' }}>{d}</div>
                {evs.length > 0 && <div style={{ fontSize: 9.5, fontWeight: 800, color: iso < hoje ? '#94a3b8' : '#0D63DB' }}>{evs.length} leil.</div>}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ borderTop: '1px solid #e2e8f0' }}>
        <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, display: 'flex', justifyContent: 'space-between' }}>
          <span>{diaSel ? `Leilões de ${dataLonga(diaSel)}` : 'Próximos leilões'}</span>
          {diaSel && <button onClick={() => setDiaSel(null)} style={{ border: 'none', background: 'none', color: '#0D63DB', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>ver próximos</button>}
        </div>
        {lista.length === 0
          ? <div style={{ padding: '4px 16px 14px', fontSize: 12.5, color: '#94a3b8' }}>Nenhum leilão agendado. Entram aqui os imóveis aprovados pelo cliente e os casos contratados com data de praça.</div>
          : lista.map((ev) => <ItemEvento key={ev.chave} ev={ev} hoje={hoje} onAbrir={onAbrirCliente} />)}
      </div>
    </div>
  );
}
