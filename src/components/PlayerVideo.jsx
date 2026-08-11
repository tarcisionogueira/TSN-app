import React, { useEffect, useRef } from 'react';
import { Play } from 'lucide-react';
import { videoEmbed } from '../utils/videoEmbed';

/**
 * PLAYER DA AULA — iframe (YouTube/Vimeo/Bunny/Panda) ou <video> nativo, com DETECÇÃO REAL
 * do fim do vídeo. Chama `onFim()` uma vez quando o vídeo termina.
 *
 * ─── POR QUE AGORA DÁ, E ANTES EU DISSE QUE NÃO ────────────────────────────────
 * Em 11/08 removi uma "simulação de progresso" que marcava a aula como concluída aos 80% de
 * um cronômetro — e escrevi que detectar o fim de verdade exigiria a IFrame API, "abrindo mão
 * do nocookie e carregando script de terceiro". Estava errado em dois pontos, e o dono pediu
 * exatamente esta função:
 *   • O domínio nocookie NÃO é incompatível com a API — `enablejsapi=1` funciona nele igual.
 *   • E nem precisa da API: o player do YouTube fala por `postMessage`. Basta mandar
 *     `{"event":"listening"}` para o iframe e ele passa a avisar cada mudança de estado.
 *     Zero script de terceiro, nenhuma mudança de CSP, privacidade intacta.
 *
 * A diferença que importa continua de pé: aqui o fim é MEDIDO (o player avisa), não deduzido
 * de tempo decorrido. Cronômetro marcaria como assistido o vídeo de quem deixou a aba aberta
 * e foi almoçar; isto só dispara quando o vídeo realmente acabou.
 *
 * O BOTÃO MANUAL CONTINUA. Detecção pode falhar — provedor sem protocolo (Bunny/Panda), rede
 * ruim, pessoa que assiste em tela cheia no app nativo. Sem o botão, quem não for detectado
 * ficaria preso sem conseguir concluir a aula. Automático é conveniência, não a única porta.
 */

const ORIGENS_YT = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];

export default function PlayerVideo({ url, titulo, onFim, style }) {
  const iframeRef = useRef(null);
  const jaAvisouRef = useRef(false);   // `onFim` uma única vez por vídeo
  const emb = videoEmbed(url);
  const src = emb?.src || '';

  // Reseta o "já avisou" quando troca de vídeo — senão a 2ª aula nunca marcaria sozinha.
  useEffect(() => { jaAvisouRef.current = false; }, [src]);

  useEffect(() => {
    if (emb?.tipo !== 'iframe' || !ORIGENS_YT.some((o) => src.startsWith(o))) return;

    // Handshake: o player só começa a emitir eventos depois de receber "listening".
    // Ele pode não estar pronto no primeiro aviso, então repetimos algumas vezes.
    let tentativas = 0;
    const avisar = () => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      try {
        win.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
      } catch { /* iframe ainda não montado */ }
    };
    const timer = setInterval(() => { avisar(); if (++tentativas >= 10) clearInterval(timer); }, 600);
    avisar();

    const aoReceber = (ev) => {
      // Origem conferida: qualquer página pode postar mensagem: sem este filtro, um anúncio
      // dentro de outro iframe conseguiria marcar a aula do aluno como assistida.
      if (!ORIGENS_YT.includes(ev.origin)) return;
      let dados;
      try { dados = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch { return; }
      // info === 0 é ENDED no protocolo do player. (-1 não iniciado, 1 tocando, 2 pausado…)
      const info = dados?.info;
      const terminou = dados?.event === 'onStateChange'
        && (info === 0 || info?.playerState === 0);
      if (!terminou || jaAvisouRef.current) return;
      jaAvisouRef.current = true;
      clearInterval(timer);
      onFim?.();
    };
    window.addEventListener('message', aoReceber);
    return () => { clearInterval(timer); window.removeEventListener('message', aoReceber); };
  }, [src, emb?.tipo, onFim]);

  if (!emb) return null;

  if (emb.tipo === 'iframe') {
    return (
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', ...style }}>
        <iframe
          ref={iframeRef}
          src={src}
          title={titulo || 'Vídeo da aula'}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
        />
      </div>
    );
  }

  if (emb.tipo === 'video') {
    return (
      <video
        src={emb.src}
        controls
        controlsList="nodownload"
        playsInline
        onEnded={() => { if (!jaAvisouRef.current) { jaAvisouRef.current = true; onFim?.(); } }}
        style={{ width: '100%', aspectRatio: '16/9', background: '#000', display: 'block', ...style }}
      />
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13, ...style }}>
      <Play size={18} style={{ marginRight: 8 }} /> Vídeo indisponível
    </div>
  );
}
