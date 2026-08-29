import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { Loader2, Target, X, ChevronLeft } from 'lucide-react';

// Triagem do investidor — modal ONE-TIME no 1º acesso do cliente. Define o perfil-base
// que direciona os agentes e prioriza o enriquecimento pelas cidades de interesse.
// Não aparece para equipe/admin nem depois de respondida (perfis.triagem_em).
const PERFIS = [
  ['revenda', '🔁 Comprar para revender', 'Arremato e revendo (flip), foco em margem e liquidez de saída.'],
  ['locacao', '🏠 Comprar para alugar', 'Arremato e coloco para locação, foco em renda e yield.'],
  ['uso_proprio', '🔑 Comprar para uso', 'Para morar ou usar no meu negócio, foco em economia e adequação.'],
  ['incorporacao', '🏗️ Comprar para incorporar', 'Terreno/imóvel para construir e vender, foco em potencial construtivo.'],
];
const FAIXAS = [
  ['ate_150k', 'Até R$ 150 mil'],
  ['150_400k', 'R$ 150 a 400 mil'],
  ['400k_1mi', 'R$ 400 mil a 1 milhão'],
  ['acima_1mi', 'Acima de R$ 1 milhão'],
];
const PAGAMENTO = [
  ['a_vista', 'À vista'],
  ['financiado', 'Financiado'],
  ['avaliando', 'Ainda avaliando'],
];
const CONSORCIO = [
  ['tem', 'Já tenho consórcio'],
  ['quero', 'Tenho interesse em consórcio'],
  ['nao', 'Não'],
];
const EXPERIENCIA = [
  ['primeira', 'Primeira vez'],
  ['1_2', 'Já arrematei 1 a 2'],
  ['recorrente', 'Investidor recorrente'],
];

const ROLES_CLIENTE = ['explorador', 'top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];

// Uma pergunta por vez (o cliente se assustava com a lista inteira de uma vez).
const STEPS = [
  { titulo: 'Qual seu objetivo principal ao arrematar?', campo: 'perfil_investidor', opts: PERFIS },
  { titulo: 'Faixa de capital para arrematar',           campo: 'faixa_capital',      opts: FAIXAS },
  { titulo: 'Forma de pagamento pretendida',             campo: 'forma_pagamento',    opts: PAGAMENTO },
  { titulo: 'Consórcio (nós te conectamos a um parceiro)', campo: 'consorcio_interesse', opts: CONSORCIO },
  { titulo: 'Sua experiência com leilão',                campo: 'experiencia_leilao', opts: EXPERIENCIA },
];
// CIDADE DE INTERESSE SAIU DA TRIAGEM (14/08, decisão do dono ao acompanhar um cadastro ao
// vivo): a pergunta vinha logo depois da cidade que o próprio cadastro já coletou
// (`perfis.endereco_cidade`), então a pessoa respondia "onde você mora" e, na tela seguinte,
// "qual cidade te interessa" — parecia a mesma pergunta duas vezes e alongava o funil no pior
// momento, que é o primeiro minuto de conta nova. E o dado nem era o melhor disponível: o
// interesse REAL aparece nos FILTROS SALVOS, que a pessoa monta usando o produto, com raio,
// tipo, faixa de valor e modalidade — muito mais rico que uma cidade avulsa.
// `cidades_interesse` continua existindo e sendo lido por quem usa (alertas, enriquecimento):
// esta mudança só para de PERGUNTAR aqui.
const TOTAL = STEPS.length;

export default function TriagemPerfil({ userId }) {
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ perfil_investidor: '', faixa_capital: '', forma_pagamento: '', consorcio_interesse: '', experiencia_leilao: '' });

  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    supabase.from('perfis').select('role, triagem_em, perfil_investidor').eq('id', userId).single()
      .then(({ data }) => {
        if (!vivo || !data) return;
        // Só cliente e só quem ainda NÃO respondeu o perfil. Reaparece a cada acesso
        // enquanto perfil_investidor estiver vazio (mesmo que tenha fechado antes);
        // o "fechar" (X) só dispensa na SESSÃO atual (sessionStorage).
        if (ROLES_CLIENTE.includes(data.role) && !data.perfil_investidor) {
          try { if (sessionStorage.getItem('tsn_triagem_dispensada')) return; } catch { /* ignore */ }
          setMostrar(true);
        }
      });
    return () => { vivo = false; };
  }, [userId]);

  if (!mostrar) return null;

  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const podeSalvar = f.perfil_investidor && f.faixa_capital && f.forma_pagamento && f.consorcio_interesse && f.experiencia_leilao;

  const salvar = async () => {
    setSalvando(true);
    // `.select()` prova o que gravou: um update que a RLS não alcança devolve `error: null` e
    // zero linhas, e a triagem "salva" que não salvou nada faz a pessoa responder tudo de novo
    // no próximo acesso, sem nunca entender por quê.
    const { data: salvos, error: errPerfil } = await supabase.from('perfis').update({
      perfil_investidor: f.perfil_investidor,
      faixa_capital: f.faixa_capital,
      forma_pagamento: f.forma_pagamento,
      consorcio_interesse: f.consorcio_interesse,
      experiencia_leilao: f.experiencia_leilao,
      triagem_em: new Date().toISOString(),
    }).eq('id', userId).select('id');
    if (errPerfil || !salvos?.length) {
      setSalvando(false);
      setErro('Não conseguimos salvar suas respostas agora. Tente de novo em instantes.');
      return;
    }

    setSalvando(false);
    setMostrar(false);
  };

  // Fecha na SESSÃO atual (não repete a cada volta pra Home); volta a perguntar no
  // próximo acesso enquanto o perfil não for respondido.
  const depois = () => { try { sessionStorage.setItem('tsn_triagem_dispensada', '1'); } catch { /* ignore */ } setMostrar(false); };

  const ehUltimo = step === STEPS.length - 1;
  const passo = STEPS[step];
  const avancar = () => setStep(s => Math.min(TOTAL - 1, s + 1));
  const voltar = () => setStep(s => Math.max(0, s - 1));
  // Ao escolher uma opção, marca e AVANÇA sozinho (fluxo pergunta-a-pergunta).
  const escolher = (campo, v) => { set(campo, v); setTimeout(avancar, 160); };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 18, padding: 24, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Target size={19} color="#0D63DB" /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#111' }}>Vamos personalizar suas análises</div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>Rápido (30s), uma pergunta por vez.</div>
          </div>
          <button onClick={depois} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}><X size={20} /></button>
        </div>

        {/* Barra de progresso */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {Array.from({ length: TOTAL }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 20, background: i <= step ? '#0D63DB' : '#e2e8f0' }} />
          ))}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>Pergunta {step + 1} de {TOTAL}</div>

        {/* Passo atual */}
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#111', marginBottom: 12 }}>{passo.titulo}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {passo.opts.map(([v, label, desc]) => {
              const sel = f[passo.campo] === v;
              return (
                <button key={v} onClick={() => escolher(passo.campo, v)}
                  style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                    border: sel ? '2px solid #0D63DB' : '1px solid #e2e8f0', background: sel ? '#eff6ff' : 'white' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: sel ? '#0D63DB' : '#111' }}>{label}</div>
                  {desc && <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2, lineHeight: 1.4 }}>{desc}</div>}
                </button>
              );
            })}
          </div>
        </div>

        {erro && (
          <div style={{ marginTop: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: '#b91c1c', lineHeight: 1.5 }}>
            {erro}
          </div>
        )}

        {/* Navegação */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
          {step > 0 && (
            <button onClick={voltar} style={{ padding: '11px 14px', border: '1px solid #e2e8f0', borderRadius: 10, background: 'white', color: '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <ChevronLeft size={15} /> Voltar
            </button>
          )}
          <div style={{ flex: 1 }} />
          {ehUltimo ? (
            <button onClick={salvar} disabled={!podeSalvar || salvando}
              style={{ padding: '11px 20px', background: podeSalvar ? '#0D63DB' : '#e2e8f0', color: podeSalvar ? 'white' : '#94a3b8', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: podeSalvar ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 8 }}>
              {salvando ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Salvando…</> : 'Concluir'}
            </button>
          ) : (
            <button onClick={avancar} disabled={!f[passo.campo]}
              style={{ padding: '11px 20px', background: f[passo.campo] ? '#0D63DB' : '#e2e8f0', color: f[passo.campo] ? 'white' : '#94a3b8', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: f[passo.campo] ? 'pointer' : 'not-allowed' }}>
              Próxima
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
