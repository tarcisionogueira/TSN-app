import React, { useEffect, useRef, useState } from 'react';
import { apiCall } from '../utils/apiCall';

/**
 * FILA DE WHATSAPP DA AULA — 1 clique por pessoa, com trava de tempo entre um e outro.
 *
 * ⚠️ ELA NÃO ENVIA, E ISSO ESTÁ ESCRITO NA TELA. `wa.me` abre a conversa com o texto pronto;
 * quem aperta enviar é o operador. Uma tela que dissesse "enviando…" e só abrisse abas seria a
 * mentira mais cara possível — o operador acharia que 82 pessoas foram avisadas e ninguém teria
 * sido. Por isso o botão chama "Abrir e marcar", e o contador diz "abertos", não "enviados".
 *
 * A TRAVA DE 40s É PROTEÇÃO, NÃO ENFEITE. Abrir 27 conversas em dois minutos, de um número que
 * a maioria não tem salvo, é o padrão que o WhatsApp classifica como spam — e o número em risco
 * é o do negócio, o mesmo do site e dos anúncios. O intervalo é ajustável porque a situação mudou
 * (uma lista de 6 pagantes não precisa do mesmo cuidado que uma de 55 frios), mas o padrão é o
 * conservador.
 *
 * A ORDEM VEM DO SERVIDOR e não é reordenável aqui de propósito: pagante → quem abriu o e-mail →
 * o resto, e dentro de cada faixa o cadastro mais recente primeiro. Deixar ordenar por nome
 * convidaria a começar pelo alfabeto, que é a ordem que não tem nada a ver com quem responde.
 */
export default function DisparoWhatsApp() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [enviados, setEnviados] = useState(() => new Set());
  const [intervalo, setIntervalo] = useState(40);
  const [espera, setEspera] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await apiCall('/api/admin-whatsapp-fila');
        const j = await r.json().catch(() => ({}));
        // `.ok` conferido: o endpoint devolve 502 com corpo JSON quando uma LEITURA falha, e um
        // `.json()` direto viraria "fila vazia" — "ninguém para convidar" e "não consegui ler"
        // se parecem na tela e levam a decisões opostas.
        if (!r.ok || j?.error) throw new Error(j?.error || 'Falhou ao carregar a fila');
        if (vivo) setDados(j);
      } catch (e) { if (vivo) setErro(String(e.message || e)); }
      finally { if (vivo) setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, []);

  // Contagem regressiva da trava. Guardada em ref para o clear acontecer no desmonte —
  // timer solto continua rodando depois que a tela sai e reabre a contagem do nada.
  useEffect(() => {
    if (espera <= 0) return undefined;
    timerRef.current = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(timerRef.current);
  }, [espera]);

  async function abrirEMarcar(p) {
    // A ABERTURA VEM PRIMEIRO, e é ela que precisa do gesto do clique: navegador bloqueia
    // window.open que não nasce direto de uma interação. Marcar antes e abrir depois faria
    // o bloqueio virar "marcado como enviado sem nunca ter aberto".
    window.open(p.wa, '_blank', 'noopener,noreferrer');
    setEnviados((s) => new Set(s).add(p.user_id));
    setEspera(intervalo);
    try {
      const r = await apiCall('/api/admin-whatsapp-fila', {
        method: 'POST', body: JSON.stringify({ user_id: p.user_id }),
      });
      const j = await r.json().catch(() => ({}));
      // Falha ao gravar precisa VOLTAR o item para a fila: se a marcação não persistiu, ao
      // recarregar a pessoa reaparece — e sem este aviso o operador mandaria de novo sem saber.
      if (!r.ok || j?.error) {
        setEnviados((s) => { const n = new Set(s); n.delete(p.user_id); return n; });
        setErro(`Não gravei o envio de ${p.nome}. Ela volta para a fila — confira antes de repetir.`);
      }
    } catch (e) {
      // O motivo VAI para o console: a mensagem na tela é para o operador decidir o que fazer
      // agora, e o motivo técnico é para descobrir DEPOIS por que a gravação falhou. Engolir
      // `e` aqui transformaria "a rede caiu" e "o banco recusou" no mesmo sintoma.
      console.error('[whatsapp-fila] falha ao gravar o envio', p.user_id, e);
      setEnviados((s) => { const n = new Set(s); n.delete(p.user_id); return n; });
      setErro(`Não gravei o envio de ${p.nome} (${String(e?.message || e)}). Ela volta para a fila — confira antes de repetir.`);
    }
  }

  if (carregando) return <div style={{ padding: 28, fontFamily: 'system-ui' }}>Carregando a fila…</div>;
  if (erro && !dados) return <div style={{ padding: 28, color: '#991b1b', fontFamily: 'system-ui' }}>{erro}</div>;
  if (!dados?.evento) return <div style={{ padding: 28, fontFamily: 'system-ui' }}>Nenhuma aula futura ativa.</div>;

  const pendentes = dados.fila.filter((p) => !enviados.has(p.user_id));
  const proximo = pendentes[0];
  const feitos = dados.fila.length - pendentes.length;
  const CORES = { 1: '#166534', 2: '#1d4ed8', 3: '#64748b' };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 18px 60px', fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Convite por WhatsApp</h1>
      <p style={{ fontSize: 14, color: '#475569', margin: '0 0 6px' }}>
        {dados.evento.titulo} — <strong>{dados.evento.quando}</strong>
      </p>
      <p style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 9, padding: '10px 12px', lineHeight: 1.6 }}>
        Esta tela <strong>não envia</strong>. Cada clique abre o WhatsApp com o texto já escrito —
        você confere e aperta enviar. O contador conta conversas <strong>abertas</strong>.
      </p>

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0' }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{feitos} de {dados.fila.length}</div>
        <label style={{ fontSize: 13, color: '#475569' }}>
          Intervalo:{' '}
          <select value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))}
            style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid #cbd5e1', fontFamily: 'inherit' }}>
            <option value={0}>sem trava</option>
            <option value={20}>20s</option>
            <option value={40}>40s</option>
            <option value={60}>60s</option>
          </select>
        </label>
        {dados.ja_enviados === null && (
          <span style={{ fontSize: 12.5, color: '#b45309' }}>(não consegui contar quantos já receberam nesta edição)</span>
        )}
        {dados.ja_enviados > 0 && (
          <span style={{ fontSize: 12.5, color: '#64748b' }}>({dados.ja_enviados} já receberam nesta edição e ficaram fora da fila)</span>
        )}
      </div>

      {erro && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 9, padding: '10px 12px', fontSize: 13, marginBottom: 14 }}>{erro}</div>
      )}

      {proximo ? (
        <div style={{ border: '2px solid #16a34a', borderRadius: 14, padding: 16, marginBottom: 22, background: '#f0fdf4' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: CORES[proximo.prioridade], textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Próximo · {proximo.motivo}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, margin: '4px 0 2px' }}>{proximo.nome}</div>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>
            {proximo.cidade ? `${proximo.cidade}${proximo.uf ? `/${proximo.uf}` : ''}` : 'cidade não informada'}
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, background: '#fff', border: '1px solid #d1fae5', borderRadius: 10, padding: 12, margin: '0 0 14px', fontFamily: 'inherit', color: '#334155' }}>{proximo.texto}</pre>
          <button onClick={() => abrirEMarcar(proximo)} disabled={espera > 0}
            style={{ width: '100%', padding: 15, background: espera > 0 ? '#cbd5e1' : '#16a34a', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: espera > 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {espera > 0 ? `Aguarde ${espera}s` : 'Abrir e marcar →'}
          </button>
        </div>
      ) : (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, marginBottom: 22, textAlign: 'center', fontSize: 15, fontWeight: 700, color: '#166534' }}>
          Fila zerada. {feitos} conversas abertas.
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', margin: '0 0 8px' }}>Na fila ({pendentes.length})</div>
      {pendentes.slice(0, 40).map((p, i) => (
        // `flexWrap` com o rótulo de largura fixa: sem ele, num celular estreito o nome
        // comprime até sumir atrás da tarja de prioridade — e esta tela vai ser usada no
        // celular, que é onde o WhatsApp está.
        <div key={p.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 2px', borderBottom: '1px solid #f1f5f9', opacity: i === 0 ? 1 : 0.75 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: CORES[p.prioridade], minWidth: 108 }}>{p.motivo}</span>
          <span style={{ fontSize: 13.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nome}</span>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{p.cidade || '—'}</span>
        </div>
      ))}
      {pendentes.length > 40 && (
        <div style={{ fontSize: 12.5, color: '#94a3b8', paddingTop: 10 }}>+ {pendentes.length - 40} depois destes</div>
      )}
    </div>
  );
}
