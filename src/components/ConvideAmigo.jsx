import React, { useState } from 'react';

/**
 * CONVIDE UM AMIGO — o link pessoal de indicação, pronto para ir ao WhatsApp.
 *
 * POR QUE EXISTE (29/08, pedido do dono): o encanamento da indicação já funcionava inteiro —
 * `/aula/<slug>?ref=CODIGO` é repassado por `api/og-share`, guardado pela landing e resolvido
 * por `api/live-inscrever`, que grava `indicado_por` e `indicacao_origem = 'link_parceiro'`.
 * O que faltava era uma PORTA: o link só existia em `/minha-rede`, e o menu "Indicações" só
 * aparece para quem aceitou o termo de parceria — 10 de 73 contas. Os outros 63 clientes não
 * tinham por onde pegar o próprio link.
 *
 * BOTÃO DE WHATSAPP, NÃO "COPIE ESTE LINK". Copiar URL e colar em outro app é um passo que
 * quase ninguém dá; `wa.me/?text=` abre o WhatsApp com a mensagem pronta e a pessoa só escolhe
 * para quem mandar. O botão de copiar fica como alternativa, não como caminho principal.
 *
 * SEM CÓDIGO, NÃO RENDERIZA. Cair no UUID cru do usuário (o comportamento antigo) mandaria o
 * id interno da conta para o WhatsApp de terceiros, e produziria um link feio justamente na
 * peça que precisa dar vontade de clicar. Desde a migração
 * `codigo_indicacao_para_todos_desde_o_cadastro` todo perfil nasce com código, então este
 * caminho só acontece enquanto a leitura ainda está carregando.
 */
export default function ConvideAmigo({ codigo, aula, tema = 'claro', alinhamento = 'left' }) {
  const [copiado, setCopiado] = useState(false);
  if (!codigo) return null;

  const origem = window.location.origin;
  // Rota SEM "#" quando há aula: robô de preview (WhatsApp, Instagram, Telegram) não lê nada
  // depois do "#", e `/aula/<slug>` é servida por `api/og-share` com título, data e capa. Com
  // "#" o amigo receberia o cartão genérico do site em cima de um convite com hora marcada.
  const link = aula?.slug
    ? `${origem}/aula/${aula.slug}?ref=${codigo}`
    : `${origem}/#/?ref=${codigo}`;

  const quando = (() => {
    if (!aula?.data_hora) return '';
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Bahia', weekday: 'long', day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(aula.data_hora));
    } catch { return ''; }
  })();

  // Mensagem em PRIMEIRA PESSOA: quem manda é o cliente, não a plataforma. "Vou participar"
  // convida junto; "conheça a BidPro" seria o amigo recebendo propaganda de um amigo.
  const mensagem = aula?.slug
    ? `Vou participar de uma aula ao vivo sobre leilão de imóveis${quando ? `, ${quando}` : ''}. É grátis e dá para assistir de casa. Se quiser ir junto, a inscrição é por aqui: ${link}`
    : `Tenho usado a BidPro Brasil para achar e avaliar imóveis de leilão. Se quiser dar uma olhada, é por aqui: ${link}`;

  const escuro = tema === 'escuro';
  const C = escuro
    ? { fundo: 'rgba(255,255,255,0.06)', borda: 'rgba(255,255,255,0.16)', titulo: '#fff', texto: '#cbd5e1', linkFundo: 'rgba(0,0,0,0.25)', linkTexto: '#e2e8f0' }
    : { fundo: '#f8fafc', borda: '#e2e8f0', titulo: '#0f172a', texto: '#475569', linkFundo: '#fff', linkTexto: '#475569' };

  const copiar = () => {
    navigator.clipboard?.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    // O card SEGUE o alinhamento do container em vez de impor o seu: na confirmação da
    // inscrição tudo é centralizado, na Home tudo é alinhado à esquerda. Fixar um dos dois
    // deixaria o card torto em uma das telas.
    <div style={{ marginTop: 22, padding: '16px 18px', background: C.fundo, border: `1px solid ${C.borda}`, borderRadius: 14, textAlign: alinhamento }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: C.titulo, marginBottom: 5 }}>
        Convide um amigo
      </div>
      <p style={{ fontSize: 13.5, color: C.texto, lineHeight: 1.6, margin: alinhamento === 'center' ? '0 auto 13px' : '0 0 13px', maxWidth: alinhamento === 'center' ? 360 : undefined }}>
        {aula?.slug
          ? 'Leilão é bem mais fácil de entender com alguém junto. Este link é seu — quem entrar por ele fica ligado à sua conta.'
          : 'Este link é seu. Quem criar conta por ele fica ligado à sua, e você participa do que essa pessoa contratar.'}
      </p>
      <a href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`} target="_blank" rel="noopener noreferrer"
        style={{ display: 'block', textAlign: 'center', background: '#16a34a', color: '#fff', textDecoration: 'none', padding: '13px', borderRadius: 11, fontWeight: 800, fontSize: 14.5 }}>
        Enviar pelo WhatsApp →
      </a>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap', justifyContent: alinhamento === 'center' ? 'center' : 'flex-start' }}>
        <code style={{ flex: '1 1 180px', minWidth: 0, fontSize: 11.5, color: C.linkTexto, background: C.linkFundo, border: `1px solid ${C.borda}`, borderRadius: 8, padding: '9px 11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {link.replace(/^https?:\/\/(www\.)?/, '')}
        </code>
        <button onClick={copiar}
          style={{ padding: '9px 14px', background: 'transparent', color: copiado ? '#16a34a' : C.texto, border: `1px solid ${copiado ? '#16a34a' : C.borda}`, borderRadius: 8, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
          {copiado ? 'Copiado!' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}
