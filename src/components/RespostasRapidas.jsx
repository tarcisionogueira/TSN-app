import React from 'react';

// RESPOSTAS RÁPIDAS (23/11, dono: "se fez uma pergunta, seria mais fácil aparecer um botão sim e um botão
// não do que esperar que o usuário escreva"). Botões sob a ÚLTIMA mensagem da conversa, só quando ela é da
// IA e veio com `opcoes` (api/chat-suporte.js grava {Sim,Não} quando a resposta termina em pergunta de
// sim/não). Respondeu — por botão ou digitando — a última mensagem passa a ser do cliente e os botões somem.
export default function RespostasRapidas({ mensagens, bloqueado, onEscolher }) {
  const ultima = mensagens?.[mensagens.length - 1];
  if (bloqueado || ultima?.autor_tipo !== 'ia' || !Array.isArray(ultima.opcoes) || !ultima.opcoes.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: 26 }}>
      {ultima.opcoes.map((o) => (
        <button key={o} type="button" onClick={() => onEscolher(o)}
          style={{ padding: '7px 18px', borderRadius: 999, border: '1.5px solid #0D63DB', background: 'white', color: '#0D63DB', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          {o}
        </button>
      ))}
    </div>
  );
}
