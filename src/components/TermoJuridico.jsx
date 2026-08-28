// TERMO DE ADESÃO DO ADVOGADO PARCEIRO — o contrato que faltava.
//
// POR QUE EXISTE (28/08): o Programa de Parceiros tinha termo desde o início; o jurídico não
// tinha nenhum. O advogado era convidado por `ConviteEquipe`, informava OAB e área de atuação,
// e passava a receber casos e a ter direito a 4,5% do valor arrematado — o MAIOR repasse da
// casa — sem um documento dizendo o que ele deve, quando recebe, o que é sigiloso e o que
// acontece se ele sair no meio de um caso. Trabalho de advogado sem contrato escrito é o tipo
// de lacuna que só aparece quando já virou conflito.
//
// ⚠️ OS PERCENTUAIS DO ITEM 6 SÃO CÓPIA de `config_honorarios` (id = 1) — mesma regra do
// "R$ 2.500,00" no termo do parceiro: termo jurídico precisa do número por extenso, não de um
// ponteiro, mas cópia envelhece. Quem mudar o split no banco sobe a versão DESTE termo no mesmo
// commit. Consulta para conferir antes de mexer:
//   select total_pct, advogado_pct, admin_pct, analista_pct, consultor_pct from config_honorarios where id = 1;
//   select valor->>'pct' from regra_negocio where chave = 'comissao.venda_assessoria';  -- item 5
//
// A estrutura espelha `ConviteParceiro.jsx` de propósito (versão + preâmbulo + array de
// cláusulas + modal): a auditoria de LGPD do Admin já sabe ler esse formato, e um segundo
// formato significaria uma segunda tela de auditoria para manter.
//
// ⚠️ O ITEM 4 (agenda) PROMETE UM MECANISMO — o advogado publica disponibilidade e o investidor
// reserva. Isso só é verdade porque a tela de Agenda do Admin passou a listar `advogado` entre
// quem pode ter horários (v3, 28/08); antes só `analista` e `admin` podiam, e o termo estaria
// obrigando a algo que a plataforma não deixava fazer. Se alguém restringir aquela lista de
// novo, esta cláusula vira letra morta — mexeu num, confira o outro.
import React from 'react';

export const TERMO_JURIDICO_VERSAO = 'v5-2026-08';

export const TERMO_JURIDICO_PREAMBULO = 'Este Termo de Adesão rege a sua atuação como Advogado Parceiro da BidPro Brasil na análise jurídica de editais, matrículas e processos de leilão, e na condução jurídica dos casos que lhe forem designados. Ele complementa os Termos de Uso e a Política de Privacidade da plataforma. Ao aceitar, você concorda com as condições abaixo.';

export const TERMO_JURIDICO = [
  {
    t: '1. Natureza da relação',
    d: 'Você atua como profissional autônomo, inscrito na OAB, por conta e risco próprios e sem exclusividade. Este Termo NÃO cria vínculo empregatício, societário ou de subordinação com a BidPro Brasil. A responsabilidade técnica pelos pareceres e pelos atos praticados é sua, nos termos do Estatuto da Advocacia (Lei nº 8.906/1994) e do Código de Ética e Disciplina da OAB.',
  },
  {
    t: '2. Elegibilidade e habilitação',
    d: 'Para atuar você deve manter inscrição REGULAR e ativa na OAB durante todo o período de parceria, informando o número de inscrição e a seccional. A suspensão, o licenciamento ou o cancelamento da inscrição devem ser comunicados imediatamente e suspendem novas designações. Você declara não estar impedido nem em conflito de interesses com os casos que aceitar.',
  },
  {
    t: '3. O que você faz',
    d: 'Ao aceitar um caso designado na plataforma, você se responsabiliza por: (a) analisar edital, matrícula, ônus e gravames e a situação processual do bem; (b) emitir parecer jurídico fundamentado sobre riscos e viabilidade da arrematação; (c) apontar as diligências necessárias; (d) ATENDER O INVESTIDOR NA REUNIÃO que ele agendar, esclarecendo as dúvidas sobre a operação e sobre o seu parecer e apresentando a Assessoria quando ela couber (item 5); e (e) acompanhar juridicamente o caso até a etapa contratada. Aceitar um caso é assumir o prazo dele. Se não puder cumprir, recuse ou devolva a designação ANTES do prazo — devolver a tempo é conduta esperada; o silêncio no prazo é que prejudica o cliente.',
  },
  {
    t: '4. Agenda e atendimento ao investidor',
    d: 'Ao aderir, você se compromete a MANTER AGENDA DISPONÍVEL na plataforma para as reuniões com os investidores dos casos que aceitar. Você define os dias e as faixas de horário da sua disponibilidade, e a partir delas o sistema publica os horários que o investidor pode reservar; a reunião acontece por vídeo, pela própria plataforma. Manter a agenda atualizada faz parte da parceria: agenda vazia significa que o investidor não consegue marcar, e o caso trava numa etapa que depende de você. Se precisar remarcar ou ficar indisponível por um período, atualize a disponibilidade e comunique com antecedência — cancelar em cima da hora, ou não comparecer, é falta contratual. O atendimento nessas reuniões está INCLUÍDO na remuneração por êxito do item 6; não há cobrança adicional por reunião, nem pagamento por reunião que não resulte em arrematação.',
  },
  {
    t: '5. Apresentação da Assessoria na reunião',
    d: 'A reunião não é só esclarecimento técnico: é nela que o investidor decide como vai conduzir a arrematação. Cabe a você APRESENTAR A ASSESSORIA da BidPro Brasil quando ela for adequada ao caso — explicando o que ela cobre, como funciona o acompanhamento e o que muda em relação a arrematar sozinho — e responder às dúvidas do investidor sobre a contratação. É a sua leitura jurídica do caso que dá base a essa conversa, e por isso a apresentação é sua e não de um vendedor. Duas obrigações que vêm junto: (a) a recomendação deve ser HONESTA — se o caso não pede assessoria, ou se o parecer aponta risco que desaconselha a arrematação, diga isso, ainda que implique não haver contratação; e (b) nada do que você apresentar pode contrariar o seu próprio parecer. Pela Assessoria efetivamente CONTRATADA e PAGA por indicação sua na reunião, você recebe 10% do valor pago, em paridade com o parceiro que indicou o cliente — e essa comissão acumula com a de indicação, caso você também seja o indicante. O crédito é apurado sobre a cobrança recebida, nunca sobre contrato assinado, e é estornado se o pagamento for cancelado ou reembolsado. Note que essa comissão é uma fração pequena do que você recebe se a arrematação se concretizar (item 6): a intenção é reconhecer o trabalho da apresentação sem criar incentivo para recomendar contratação que o caso não justifica. Recomendar Assessoria em caso que não a pede, ou contrariando o seu próprio parecer para viabilizar a contratação, é infração deste Termo e acarreta o cancelamento da comissão e as medidas do item 9.',
  },
  {
    t: '6. Como você é remunerado',
  },
  {
    d: 'A remuneração é por ÊXITO. Quando a arrematação de um cliente que você acompanhou se concretiza, a BidPro Brasil recebe honorário de êxito de 10% sobre o valor arrematado, e esse honorário é dividido MEIO A MEIO entre você e a plataforma, depois de descontada a participação do parceiro que indicou o cliente, quando houver. Na prática: (a) SEM parceiro envolvido, você recebe 50% do honorário — 5% do valor arrematado; (b) COM parceiro, o parceiro recebe 1 ponto percentual e o restante é dividido meio a meio, cabendo a você 4,5% do valor arrematado. O desconto do parceiro sai igualmente dos dois lados, nunca só do seu. (c) Se VOCÊ MESMO for o parceiro que indicou o cliente, acumula as duas participações — 5,5% do valor arrematado —, desde que também tenha aderido ao Programa de Parceiros. Você pode ter um percentual individual diferente, registrado no seu perfil, que prevalece sobre o padrão quando existir. Essa participação remunera TODO o seu trabalho no caso — a análise, o parecer, a reunião com o investidor e o acompanhamento —, e não há cobrança nem pagamento à parte por nenhuma dessas etapas. NÃO há remuneração fixa, por hora, por parecer emitido, por reunião realizada ou por caso que não resulte em arrematação. O valor é calculado sobre o estado vigente das regras no momento em que a arrematação é distribuída; casos já distribuídos não são recalculados.',
  },
  {
    t: '7. Quando e como você recebe',
    d: 'O crédito é apurado quando a arrematação é registrada e distribuída na plataforma, e fica disponível no seu saldo. O pagamento é feito por PIX, após conferência, contra nota fiscal de serviços emitida por você ou pela sua sociedade de advogados. Valores relativos a operações posteriormente desfeitas, canceladas, anuladas judicialmente ou identificadas como fraude são estornados do saldo e podem ser descontados de pagamentos seguintes. Os tributos incidentes são de sua responsabilidade exclusiva.',
  },
  {
    t: '8. Sigilo profissional e proteção de dados',
    d: 'Os documentos e dados dos clientes a que você tem acesso — matrículas, editais, processos, dados pessoais e financeiros — são confidenciais e cobertos pelo sigilo profissional. Você se compromete a usá-los EXCLUSIVAMENTE para a condução do caso designado, a não os repassar a terceiros e a não os utilizar para finalidade diversa, inclusive após o término da parceria. O tratamento segue a Lei nº 13.709/2018 (LGPD) e a Política de Privacidade da BidPro Brasil; ao acessar esses dados você atua como CORRESPONSÁVEL pelo tratamento. Para prevenção a fraudes, registramos metadados do seu aceite e dos seus acessos (data/hora, IP e dispositivo).',
  },
  {
    t: '9. Conduta, captação e conflito de interesses',
    d: 'É VEDADO usar os dados de clientes da plataforma para captação particular, oferecer serviços fora da plataforma a cliente designado pela BidPro Brasil, ou atuar simultaneamente por parte contrária no mesmo caso. É igualmente vedada qualquer forma de captação de clientela em desacordo com o Código de Ética da OAB. A violação acarreta o cancelamento dos créditos relacionados e o encerramento da parceria, sem prejuízo das medidas legais e disciplinares cabíveis.',
  },
  {
    t: '10. Responsabilidade técnica',
    d: 'O parecer é seu e leva a sua assinatura e o seu número de inscrição na OAB. A BidPro Brasil não revisa nem responde pelo conteúdo técnico do seu parecer, e não pode ser responsabilizada por erro, omissão ou perda de prazo de sua autoria. A plataforma disponibiliza documentos, leitura automatizada e informações de apoio: eles são INSUMO, não substituem sua análise, e cabe a você conferir a fonte antes de concluir.',
  },
  {
    t: '11. Alterações do Programa',
    d: 'A BidPro Brasil pode alterar regras, condições e percentuais mediante aviso prévio razoável pelos canais oficiais. A continuidade da atuação após o aviso implica concordância. Alterações não afetam créditos já apurados nem casos já distribuídos.',
  },
  {
    t: '12. Vigência e encerramento',
    d: 'A adesão vigora por prazo indeterminado. Qualquer das partes pode encerrá-la a qualquer tempo, mediante comunicação. O encerramento não prejudica créditos já apurados de boa-fé, e você se compromete a concluir ou a transferir de forma ordenada os casos em andamento, preservando o interesse do cliente e o sigilo profissional.',
  },
  {
    t: '13. Legislação e foro',
    d: 'Aplica-se a legislação brasileira, o Estatuto da Advocacia e o Código de Ética e Disciplina da OAB. Fica eleito o foro do domicílio do advogado para dirimir controvérsias.',
  },
];

// Modal do termo. `onAceitar` recebe o clique de "Aceitar e ativar".
export function TermoJuridicoModal({ onFechar, onAceitar, concordo, setConcordo, aceitando, bloqueante }) {
  return (
    <div onClick={() => { if (!aceitando && !bloqueante) onFechar?.(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 18, padding: 24, width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a', marginBottom: 2 }}>⚖️ Termo de Adesão — Advogado Parceiro</div>
        <p style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>{TERMO_JURIDICO_PREAMBULO}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {TERMO_JURIDICO.map((c, i) => (
            <div key={i}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#7c3aed' }}>{c.t}</div>
              <div style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.65 }}>{c.d}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.6, marginTop: 14 }}>
          Este termo complementa os <a href="#/termos" target="_blank" rel="noreferrer" style={{ color: '#7c3aed', fontWeight: 700 }}>Termos de Uso</a> e a <a href="#/privacidade" target="_blank" rel="noreferrer" style={{ color: '#7c3aed', fontWeight: 700 }}>Política de Privacidade</a>. Versão {TERMO_JURIDICO_VERSAO}.
        </div>
        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={concordo} onChange={e => setConcordo(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, cursor: 'pointer' }} />
          <span style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>
            Li e concordo com o Termo de Adesão do Advogado Parceiro. Declaro que minha inscrição na OAB está regular e ativa e me comprometo a manter agenda disponível para as reuniões com os investidores dos casos que aceitar.
          </span>
        </label>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          {!bloqueante && (
            <button onClick={onFechar} disabled={aceitando}
              style={{ padding: '11px 18px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: aceitando ? 'default' : 'pointer' }}>
              Agora não
            </button>
          )}
          <button onClick={onAceitar} disabled={!concordo || aceitando}
            style={{ padding: '11px 20px', background: (!concordo || aceitando) ? '#cbd5e1' : '#7c3aed', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: (!concordo || aceitando) ? 'default' : 'pointer' }}>
            {aceitando ? 'Registrando…' : 'Aceitar e ativar'}
          </button>
        </div>
      </div>
    </div>
  );
}
