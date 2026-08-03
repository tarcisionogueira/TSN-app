import React from 'react';
import { supabase } from '../utils/supabase';

/**
 * CARD DE DEMOGRAFIA E PRESSÃO HABITACIONAL da cidade.
 *
 * POR QUE ele nasce no Índice (sugestão do dono: "seria interessante aparecer no índice?"):
 * o Índice responde QUANTO vale o m² ali. Isso é a foto. O que sustenta ou corrói esse preço
 * ao longo do tempo é a demanda — gente entrando na cidade e imóvel sobrando ou faltando.
 * Ter as duas coisas na mesma tela muda a leitura: R$/m² parado numa cidade que cresce e tem
 * pouco imóvel vago é oportunidade; o MESMO R$/m² numa cidade que encolhe com 20% de
 * domicílios vazios é armadilha.
 *
 * É uma LEITURA de banco (`socio_regiao`, uma linha indexada). Não busca nada na web, não
 * pesa na consulta do Índice e some sozinho quando não há dado — nunca inventa número.
 * Todo valor sai com FONTE e ANO; a leitura derivada é rotulada como NOSSA e jamais
 * apresentada como o déficit habitacional oficial da FJP.
 */
const cidadeNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const int = (v) => (Number(v) > 0 ? Math.round(Number(v)).toLocaleString('pt-BR') : null);
const dec = (v, c = 1) => (Number.isFinite(Number(v)) ? Number(v).toFixed(c).replace('.', ',') : null);

const CLASSE = {
  demanda_reprimida: { rot: 'Demanda reprimida', cor: '#166534', fundo: '#dcfce7',
    txt: 'a cidade cresce e sobra pouco imóvel — preço tende a se sustentar, revenda com mais liquidez e menos vacância no aluguel.' },
  equilibrio: { rot: 'Equilíbrio', cor: '#475569', fundo: '#f1f5f9',
    txt: 'oferta e demanda em linha com a média do país — sem vento a favor nem contra.' },
  estoque_ocioso: { rot: 'Estoque ocioso', cor: '#9a3412', fundo: '#ffedd5',
    txt: 'muito imóvel vazio e pouco crescimento — exige desconto maior no lance, prazo de saída mais longo e cautela com projeção de valorização.' },
};

export default function CardDemografia({ cidade, uf, bairro = '' }) {
  const [d, setD] = React.useState(null);

  React.useEffect(() => {
    const cn = cidadeNorm(cidade);
    if (!cn || !uf) { setD(null); return; }
    let vivo = true;
    supabase.rpc('socio_regiao', { p_cidade_norm: cn, p_uf: String(uf).toUpperCase(), p_bairro: bairro || '' })
      .then(({ data }) => { if (vivo) setD(data && (data.populacao || data.pop_estim || data.domicilios) ? data : null); })
      .catch(() => { if (vivo) setD(null); });
    return () => { vivo = false; };
  }, [cidade, uf, bairro]);

  if (!d) return null;   // sem dado, o card simplesmente não existe

  const cls = CLASSE[d.pressao_classe];
  const pop = int(d.pop_estim) || int(d.populacao);
  const popAno = Number(d.pop_estim) > 0 ? d.pop_estim_ano : d.populacao_ano;
  const cresc = dec(d.crescimento_recente_aa_pct, 2);
  const item = (rot, val, sub) => (val ? (
    <div key={rot}>
      <div style={{ fontSize: 10, color: '#64748b' }}>{rot}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{val}</div>
      {sub && <div style={{ fontSize: 9.5, color: '#94a3b8' }}>{sub}</div>}
    </div>
  ) : null);

  return (
    <div style={{ marginTop: 12, background: 'white', borderRadius: 12, padding: '12px 16px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', marginBottom: 8 }}>
        DEMOGRAFIA E PRESSÃO HABITACIONAL — {String(cidade || '').toUpperCase()}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))', gap: 10 }}>
        {item('População', pop, popAno ? `IBGE, ${popAno}` : null)}
        {item('Crescimento', cresc ? `${cresc}% a.a.` : null, 'ritmo recente')}
        {item('Domicílios', int(d.domicilios), d.domicilios_ano ? `Censo ${d.domicilios_ano}` : null)}
        {item('Vagos', dec(d.domicilios_vagos_pct) ? `${dec(d.domicilios_vagos_pct)}%` : null,
          int(d.domicilios_vagos) ? `${int(d.domicilios_vagos)} imóveis` : null)}
        {item('Moradores/domicílio', dec(d.moradores_por_domicilio, 2))}
        {item('Nascimentos', int(d.nascimentos), d.nascimentos_ano ? `Registro Civil, ${d.nascimentos_ano}` : null)}
      </div>

      {cls && (
        <div style={{ marginTop: 10, background: cls.fundo, borderRadius: 9, padding: '9px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: cls.cor }}>Leitura BidPro: {cls.rot}</div>
          <div style={{ fontSize: 11.5, color: '#334155', marginTop: 2, lineHeight: 1.55 }}>{cls.txt}</div>
          {d.pressao_nota && <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 4 }}>{d.pressao_nota}</div>}
        </div>
      )}

      {Number(d.deficit_fjp) > 0 && (
        <div style={{ fontSize: 11, color: '#334155', marginTop: 8 }}>
          Déficit habitacional oficial (Fundação João Pinheiro, {d.deficit_fjp_ano}):{' '}
          <strong>{int(d.deficit_fjp)}</strong> domicílios.
        </div>
      )}

      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 8, lineHeight: 1.5 }}>
        Fonte: IBGE (Censo, estimativas e Registro Civil). A “Leitura BidPro” é uma interpretação
        nossa desses dados — compara a cidade aos tercis de todos os municípios do país — e
        <strong> não</strong> é o déficit habitacional oficial da Fundação João Pinheiro.
      </div>
    </div>
  );
}
