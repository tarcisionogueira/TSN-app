import React from 'react';
import { driveImage } from '../utils/driveUrl';

/**
 * CAPA DO CURSO — imagem quando existe, monograma quando não existe.
 *
 * POR QUE ISTO SUBSTITUIU O EMOJI (pedido do dono, 11/08: "retire este emoji, não fica
 * profissional"): o fallback era um 📚 renderizado em 40–72px no cabeçalho do curso, no
 * card da Área de Membros e na capa da aula sem vídeo. Emoji é desenhado pelo SISTEMA
 * OPERACIONAL — muda de forma entre Windows, Mac e Android, não respeita a paleta da marca
 * e, em tamanho grande, lê como rascunho. O monograma usa a cor do próprio curso e a mesma
 * tipografia do resto do produto: some quando há capa, e quando não há, parece intencional.
 *
 * `tamanho` é o lado do quadrado (ou a altura, quando `preencher`).
 */

/** Iniciais do título: 2 letras, ignorando conectivos ("de", "da", "e", "do"…). */
export function iniciaisCurso(titulo) {
  const palavras = String(titulo || '')
    .trim()
    .split(/\s+/)
    .filter((p) => p && !/^(de|da|do|das|dos|e|em|na|no|para|com|a|o)$/i.test(p));
  if (!palavras.length) return '•';
  if (palavras.length === 1) return palavras[0].slice(0, 2).toUpperCase();
  return (palavras[0][0] + palavras[1][0]).toUpperCase();
}

export default function CapaCurso({
  curso,
  tamanho = 56,
  raio = 12,
  preencher = false,   // ocupa 100% da largura do pai (card do curso, 16/9)
  proporcao,           // ex.: '16/9' — só faz sentido com `preencher`
  legenda,             // texto opcional embaixo do monograma (ex.: categoria)
  className,
}) {
  const cor = curso?.cor || '#0D63DB';
  const capa = curso?.capa_url;
  const base = {
    background: `linear-gradient(135deg, ${cor} 0%, ${cor}cc 100%)`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: legenda ? 10 : 0,
    flexShrink: 0,
    overflow: 'hidden',
    ...(preencher
      ? { width: '100%', aspectRatio: proporcao || '16/9', borderRadius: raio }
      : { width: tamanho, height: tamanho, borderRadius: raio }),
  };

  if (capa) {
    return (
      <img
        src={driveImage(capa)}
        alt={curso?.titulo || 'Capa do curso'}
        className={className}
        style={{ ...base, objectFit: 'cover', display: 'block', background: '#f1f5f9' }}
        // Capa quebrada não pode virar um vão branco sem explicação: cai no monograma.
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }

  // Monograma: escala com o tamanho para nunca ficar apertado nem gigante.
  const corpo = preencher ? 44 : Math.max(12, Math.round(tamanho * 0.42));
  return (
    <div className={className} style={base}>
      <span style={{
        fontSize: corpo,
        fontWeight: 900,
        color: 'white',
        letterSpacing: '-0.02em',
        lineHeight: 1,
        fontFamily: "'League Spartan', 'Inter', sans-serif",
      }}>
        {iniciaisCurso(curso?.titulo)}
      </span>
      {legenda && (
        <span style={{
          fontSize: 11, color: 'rgba(255,255,255,0.82)', fontWeight: 700,
          textTransform: 'uppercase', textAlign: 'center', padding: '0 12px', letterSpacing: '0.04em',
        }}>{legenda}</span>
      )}
    </div>
  );
}
