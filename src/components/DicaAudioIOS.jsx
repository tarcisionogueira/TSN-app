import React from 'react';
import { VolumeX } from 'lucide-react';

/**
 * DICA DE ÁUDIO NO IPHONE — só aparece no iOS, e só uma linha.
 *
 * POR QUE EXISTE (11/08): o dono relatou vídeo sem áudio na plataforma, com áudio normal no
 * app do YouTube. Não há nada no nosso código que mute — a URL do embed não tem `mute=1`,
 * o iframe não tem `muted` e o `allow` inclui `autoplay` e `encrypted-media`.
 *
 * A causa é do sistema: no iOS, o interruptor lateral de SILENCIOSO deixa mudo o vídeo
 * tocado dentro de uma página web (WebKit — vale para Safari e também para Chrome/Firefox no
 * iPhone, que usam o mesmo motor). O APP do YouTube ignora esse interruptor, e é por isso que
 * o mesmo vídeo tem som lá e não tem aqui. No print do relato o status bar mostra o sino
 * cortado, indicador de silencioso.
 *
 * Não dá para consertar por código: o iframe do YouTube só aceitaria comando de volume pela
 * IFrame API, que exigiria abrir mão do domínio nocookie e carregar script de terceiro em
 * toda aula. Trocar privacidade do aluno por um botão de volume é um mau negócio — então
 * resolvemos com informação, que é o que evita o chamado de suporte.
 */
const EH_IOS = typeof navigator !== 'undefined' && (
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS 13+ se identifica como Mac; o toque é o que o denuncia.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);

export default function DicaAudioIOS({ style }) {
  if (!EH_IOS) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      fontSize: 12, color: '#64748b', lineHeight: 1.5, ...style,
    }}>
      <VolumeX size={14} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        Sem áudio? No iPhone, a <strong>chavinha de silencioso</strong> deixa o vídeo mudo dentro do
        navegador. Desligue o silencioso ou toque no ícone de som do player.
      </span>
    </div>
  );
}
