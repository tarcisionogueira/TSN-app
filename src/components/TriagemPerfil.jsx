import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { Loader2, Target, X, ChevronLeft } from 'lucide-react';
import { useVezDoModal } from '../utils/filaModais';

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

// VEÍCULOS (23/10, pedido do dono): interesse, tipos e faixa de FIPE decidem os 5 veículos do
// e-mail de oportunidades (api/_curadoria-veiculos.js). Leilão de pátio: a localização não pesa.
const VEICULOS = [
  ['sim', '🚗 Sim, tenho interesse', 'Veículos já no pátio do leiloeiro — sem retomada, só retirar ou contratar o frete.'],
  ['nao', 'Não, só imóveis'],
];
const TIPOS_VEICULO = [
  ['carro', '🚗 Carros'],
  ['moto', '🏍️ Motos'],
  ['caminhao', '🚚 Caminhões'],
  ['van_utilitario', '🚐 Vans e utilitários'],
  ['onibus', '🚌 Ônibus'],
  ['maquina', '🚜 Máquinas'],
];
const FAIXAS_FIPE = [
  ['ate_50k', 'Até R$ 50 mil'],
  ['ate_100k', 'Até R$ 100 mil'],
  ['ate_150k', 'Até R$ 150 mil'],
  ['acima_150k', 'Acima de R$ 150 mil'],
];
const semVeiculo = (f) => f.interesse_veiculos !== 'sim';
// Campo de múltipla escolha conta como respondido com 1+ item.
const preenchido = (v) => (Array.isArray(v) ? v.length > 0 : !!v);

const ROLES_CLIENTE = ['explorador', 'top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];

// Uma pergunta por vez (o cliente se assustava com a lista inteira de uma vez).
const STEPS = [
  { titulo: 'Qual seu objetivo principal ao arrematar?', campo: 'perfil_investidor', opts: PERFIS },
  { titulo: 'Faixa de capital para arrematar',           campo: 'faixa_capital',      opts: FAIXAS },
  { titulo: 'Forma de pagamento pretendida',             campo: 'forma_pagamento',    opts: PAGAMENTO },
  { titulo: 'Consórcio (nós te conectamos a um parceiro)', campo: 'consorcio_interesse', opts: CONSORCIO },
  { titulo: 'Sua experiência com leilão',                campo: 'experiencia_leilao', opts: EXPERIENCIA },
  { titulo: 'Tem interesse em leilão de veículos?',      campo: 'interesse_veiculos', opts: VEICULOS },
  { titulo: 'Que tipo de veículo? (pode marcar mais de um)', campo: 'veiculo_tipos', opts: TIPOS_VEICULO, multiplo: true, pular: semVeiculo },
  { titulo: 'Valor médio de FIPE do veículo que você procura', campo: 'veiculo_faixa_fipe', opts: FAIXAS_FIPE, pular: semVeiculo },
];
const CAMPOS_VEICULO = ['interesse_veiculos', 'veiculo_tipos', 'veiculo_faixa_fipe'];
const SO_COM_INTERESSE = CAMPOS_VEICULO.slice(1);
const CAMPOS = STEPS.map(s => s.campo);
// CIDADE DE INTERESSE SAIU DA TRIAGEM (14/08, decisão do dono ao acompanhar um cadastro ao
// vivo): a pergunta vinha logo depois da cidade que o próprio cadastro já coletou
// (`perfis.endereco_cidade`), então a pessoa respondia "onde você mora" e, na tela seguinte,
// "qual cidade te interessa" — parecia a mesma pergunta duas vezes e alongava o funil no pior
// momento, que é o primeiro minuto de conta nova. E o dado nem era o melhor disponível: o
// interesse REAL aparece nos FILTROS SALVOS, que a pessoa monta usando o produto, com raio,
// tipo, faixa de valor e modalidade — muito mais rico que uma cidade avulsa.
// `cidades_interesse` continua existindo e sendo lido por quem usa (alertas, enriquecimento):
// esta mudança só para de PERGUNTAR aqui.
// `forcar` (23/10): aberto pelo link do e-mail (/perfil?responder=1) — aparece mesmo se a pessoa
// dispensou na sessão. Respondeu tudo? Mostra as de veículo já preenchidas, para revisar.
export default function TriagemPerfil({ userId, forcar = false, onSalvo }) {
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [step, setStep] = useState(0);
  const [f, setF] = useState(Object.fromEntries(CAMPOS.map(c => [c, c === 'veiculo_tipos' ? [] : ''])));
  // Quem respondeu a triagem antes de 23/10 vê SÓ o que falta (as perguntas de veículo), não tudo de novo.
  const [pendentes, setPendentes] = useState(CAMPOS);

  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    supabase.from('perfis').select(`role, triagem_em, ${CAMPOS.join(', ')}`).eq('id', userId).single()
      .then(({ data, error }) => {
        if (error) console.warn('[triagem] leitura do perfil falhou:', error.message);
        if (!vivo || !data) return;
        // Tipos e faixa só faltam para quem disse 'sim' (ou ainda não respondeu o interesse).
        const faltam = CAMPOS.filter(c => !preenchido(data[c])
          && !(SO_COM_INTERESSE.includes(c) && data.interesse_veiculos === 'nao'));
        if (forcar && !faltam.length) faltam.push(...CAMPOS_VEICULO);
        // Só cliente e só quem ainda tem pergunta SEM resposta. Reaparece a cada acesso
        // enquanto faltar alguma (mesmo que tenha fechado antes);
        // o "fechar" (X) só dispensa na SESSÃO atual (sessionStorage).
        if ((forcar || ROLES_CLIENTE.includes(data.role)) && faltam.length) {
          setF(Object.fromEntries(CAMPOS.map(c => [c, data[c] || (c === 'veiculo_tipos' ? [] : '')])));
          setPendentes(faltam);
          try { if (!forcar && sessionStorage.getItem('tsn_triagem_dispensada')) return; } catch { /* ignore */ }
          setMostrar(true);
        }
      });
    return () => { vivo = false; };
  }, [userId, forcar]);

  // 19/09 — entra na fila de modais (era o único a furar: z-index fixo, cobria o vídeo de
  // boas-vindas em conta nova). Continua decidindo SOZINHO se quer aparecer; só a EXIBIÇÃO
  // agora espera a vez.
  const podeMostrar = useVezDoModal('triagem', mostrar);
  if (!podeMostrar) return null;

  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const passos = STEPS.filter(s => pendentes.includes(s.campo) && !(s.pular && s.pular(f)));
  const TOTAL = passos.length;
  const podeSalvar = passos.every(s => preenchido(f[s.campo]));

  const salvar = async () => {
    setSalvando(true);
    const novo = Object.fromEntries(passos.map(s => [s.campo, f[s.campo]]));
    if (novo.interesse_veiculos === 'nao') for (const c of SO_COM_INTERESSE) novo[c] = null;
    const { data: salvo, error } = await supabase.from('perfis')
      .update({ ...novo, triagem_em: new Date().toISOString() }).eq('id', userId).select('id');
    setSalvando(false);
    // Fechar sem ter gravado faria a pessoa achar que respondeu — e o e-mail seguiria genérico.
    if (error || !salvo?.length) { alert('Não consegui salvar suas respostas agora. Tente de novo em instantes.'); return; }
    setMostrar(false);
    onSalvo?.();
  };

  // Fecha na SESSÃO atual (não repete a cada volta pra Home); volta a perguntar no
  // próximo acesso enquanto o perfil não for respondido.
  const depois = () => { try { sessionStorage.setItem('tsn_triagem_dispensada', '1'); } catch { /* ignore */ } setMostrar(false); };

  const soVeiculos = pendentes.every(c => CAMPOS_VEICULO.includes(c));
  const ehUltimo = step >= TOTAL - 1;
  const passo = passos[Math.min(step, TOTAL - 1)];
  if (!passo) return null;
  const avancar = () => setStep(s => Math.min(TOTAL - 1, s + 1));
  const voltar = () => setStep(s => Math.max(0, s - 1));
  // Ao escolher uma opção, marca e AVANÇA sozinho (fluxo pergunta-a-pergunta).
  const escolher = (campo, v) => {
    // Múltipla escolha: marca/desmarca e espera o "Próxima" (não dá para adivinhar quando acabou).
    if (passo.multiplo) { setF(p => { const a = p[campo] || []; return { ...p, [campo]: a.includes(v) ? a.filter(x => x !== v) : [...a, v] }; }); return; }
    set(campo, v); setTimeout(avancar, 160);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 18, padding: 24, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Target size={19} color="#0D63DB" /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#111' }}>{soVeiculos ? 'Novidade: leilão de veículos 🚗' : 'Vamos personalizar suas análises'}</div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>{soVeiculos
              ? 'Agora também temos leilão de veículos já no pátio do leiloeiro — mais simples e seguro. Perguntas rápidas para acertar no que você recebe.'
              : 'Rápido (30s), uma pergunta por vez.'}</div>
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
              const sel = passo.multiplo ? (f[passo.campo] || []).includes(v) : f[passo.campo] === v;
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
            <button onClick={avancar} disabled={!preenchido(f[passo.campo])}
              style={{ padding: '11px 20px', background: preenchido(f[passo.campo]) ? '#0D63DB' : '#e2e8f0', color: preenchido(f[passo.campo]) ? 'white' : '#94a3b8', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: preenchido(f[passo.campo]) ? 'pointer' : 'not-allowed' }}>
              Próxima
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
