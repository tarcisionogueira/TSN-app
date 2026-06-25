import React from 'react';

function scoreColor(score) {
  if (score === null || score === undefined) return { color: '#94a3b8', bg: '#f1f5f9' };
  if (score >= 70) return { color: '#059669', bg: '#f0fdf4' };
  if (score >= 40) return { color: '#d97706', bg: '#fef3c7' };
  return { color: '#dc2626', bg: '#fee2e2' };
}

/**
 * ScoreRisco — dual risk score badges
 * Props:
 *   scoreFinanceiro  (0-100 or null)
 *   scoreJuridico    (0-100 or null)
 *   size             'sm' | 'md'  (default 'sm')
 */
export default function ScoreRisco({ scoreFinanceiro, scoreJuridico, size = 'sm' }) {
  // Render nothing if both are null/undefined
  const hasFinanceiro = scoreFinanceiro !== null && scoreFinanceiro !== undefined;
  const hasJuridico   = scoreJuridico   !== null && scoreJuridico   !== undefined;
  if (!hasFinanceiro && !hasJuridico) return null;

  const isMd = size === 'md';

  const pillStyle = (score, hasValue) => {
    const { color, bg } = scoreColor(hasValue ? score : null);
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: isMd ? 5 : 3,
      background: bg,
      color,
      fontSize: isMd ? 12 : 11,
      fontWeight: 700,
      padding: isMd ? '4px 10px' : '2px 8px',
      borderRadius: 20,
      whiteSpace: 'nowrap',
      lineHeight: 1.2,
    };
  };

  const labelStyle = {
    fontSize: 10,
    fontWeight: 700,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  };

  const dotStyle = (score, hasValue) => {
    const { color } = scoreColor(hasValue ? score : null);
    return {
      width: isMd ? 8 : 6,
      height: isMd ? 8 : 6,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
    };
  };

  const financeiroPill = (
    <div style={pillStyle(scoreFinanceiro, hasFinanceiro)}>
      <div style={dotStyle(scoreFinanceiro, hasFinanceiro)} />
      {hasFinanceiro ? `Financeiro: ${scoreFinanceiro}` : 'Financeiro: —'}
    </div>
  );

  const juridicoPill = (
    <div style={pillStyle(scoreJuridico, hasJuridico)}>
      <div style={dotStyle(scoreJuridico, hasJuridico)} />
      {hasJuridico ? `Jurídico: ${scoreJuridico}` : <span style={{ fontStyle: 'italic' }}>Sem laudo</span>}
    </div>
  );

  if (isMd) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={labelStyle}>Risco</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {financeiroPill}
          {juridicoPill}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {financeiroPill}
      {juridicoPill}
    </div>
  );
}
