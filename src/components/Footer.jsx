import React from 'react';
import { Link } from 'react-router-dom';
import LogoB from './LogoB';

export default function Footer() {
  return (
    <footer style={{ background: '#111111', color: '#94a3b8', padding: '32px 20px 24px', marginTop: 40 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: '#0D63DB', borderRadius: 8, padding: '6px 8px' }}><LogoB size={16} /></div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 14, color: 'white' }}>BidPro Brasil</div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#475569' }}>Leilão & Investimentos</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Link REAL (sem #) para as páginas públicas de acervo — é por aqui que o robô do
              Google entra no catálogo. Sem um caminho a partir da home, as 33 mil páginas de
              imóvel dependeriam só do sitemap para serem descobertas. */}
          <a href="/leiloes" style={{ color: '#64748b', textDecoration: 'none', fontSize: 12 }}>Imóveis em leilão por estado</a>
          <Link to="/termos" style={{ color: '#64748b', textDecoration: 'none', fontSize: 12 }}>Termos de Uso</Link>
          <Link to="/privacidade" style={{ color: '#64748b', textDecoration: 'none', fontSize: 12 }}>Política de Privacidade</Link>
        </div>
      </div>
      <div style={{ maxWidth: 1100, margin: '20px auto 0', paddingTop: 16, borderTop: '1px solid #111111', fontSize: 11, color: '#334155', textAlign: 'center' }}>
        © {new Date().getFullYear()} BidPro Brasil. Todos os direitos reservados.
        {/* A grafia separada existe de propósito: quem procura "bid pro brasil" hoje é
            corrigido pelo Google para "byd". Ter a forma com espaço escrita na página ajuda
            o buscador a aprender que o termo existe e é uma marca. */}
        <span style={{ display: 'block', marginTop: 4, color: '#1e293b' }}>BidPro Brasil, também escrito Bid Pro Brasil.</span>
        {/* IDENTIFICAÇÃO DO ANUNCIANTE (18/08). O rodapé trazia só a marca: nenhuma razão
            social, CNPJ ou contato — os dados existiam apenas na página de Termos. Isso importa
            por dois motivos concretos: (1) a verificação de anunciante do Google passou a exibir
            NOME e LOCAL nas declarações dos anúncios, e o site precisa dizer a mesma coisa que
            foi declarada, senão a inconsistência é motivo de reprovação; (2) é a informação que
            um cliente procura antes de pagar. Os dados são os MESMOS já publicados em /termos —
            não há divulgação nova aqui. */}
        <span style={{ display: 'block', marginTop: 10, color: '#334155', lineHeight: 1.6 }}>
          Nogueira Empreendimentos LTDA — CNPJ 02.311.492/0001-61
          <br />
          {/* Endereço IGUAL ao declarado na verificação do Google/G2RS (fonte: cartão CNPJ) —
              o site precisa dizer a mesma coisa que os documentos, letra por letra. */}
          Rua Barra Avenida, SN, Conj. Barra do Mendes, Mangabeira, Feira de Santana/BA — CEP 44.056-536
          <br />
          <a href="mailto:contato@bidprobrasil.com.br" style={{ color: '#334155' }}>contato@bidprobrasil.com.br</a>
        </span>
      </div>
    </footer>
  );
}
