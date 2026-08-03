import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const wrap = { maxWidth: 820, margin: '0 auto', padding: '40px 20px 80px', color: '#334155', lineHeight: 1.7, fontSize: 15 };
const h2 = { fontSize: 20, fontWeight: 800, color: '#111111', margin: '32px 0 10px' };

export default function Privacidade() {
  const nav = useNavigate();
  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh' }}>
      <div style={wrap}>
        <button onClick={() => nav(-1)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 20 }}>
          <ArrowLeft size={16} /> Voltar
        </button>
        <h1 style={{ fontSize: 32, fontWeight: 900, color: '#111111', margin: '0 0 6px' }}>Política de Privacidade (LGPD)</h1>
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Última atualização: agosto de 2026</p>

        <p style={{ marginTop: 20 }}>Esta política descreve como a BidPro Brasil (Nogueira Empreendimentos LTDA) coleta, usa e protege os dados pessoais dos seus usuários, em conformidade com a Lei nº 13.709/2018 (LGPD).</p>

        <h2 style={h2}>1. Dados que coletamos</h2>
        <p>Nome, e-mail, CPF, telefone e endereço informados no cadastro; dados de uso da plataforma; informações dos imóveis que você analisa; e os documentos que você envia para análise (editais, matrículas, certidões), que podem conter dados de terceiros constantes de registros públicos. Se você participar do <strong>Programa de Parceiros</strong>, também tratamos a sua <strong>chave PIX</strong> e os dados financeiros da sua participação (comissões e saques), além do vínculo de indicação (quem indicou quem) para operar o programa (ver seção 4). Usamos cookies e ferramentas de análise (ex.: Google Analytics) para medir o uso e melhorar a plataforma. Não solicitamos dados sensíveis no cadastro; caso documentos enviados contenham dados dessa natureza, eles são tratados apenas para a finalidade da análise contratada.</p>
        <p style={{ marginTop: 10 }}>Para prevenção a fraudes e defesa em contestações de pagamento (chargeback), registramos metadados do aceite dos termos e das transações (data/hora, endereço IP e identificação do dispositivo/navegador), com base no legítimo interesse e no exercício regular de direitos (LGPD, Art. 7º, IX e Art. 10).</p>

        <h2 style={h2}>2. Finalidade do tratamento</h2>
        <p>Utilizamos seus dados para: criar e manter sua conta; processar assinaturas e emitir documentos fiscais; gerar análises e relatórios; e prestar suporte. Observamos os princípios do Art. 6º da LGPD — finalidade, adequação, <strong>necessidade</strong>, transparência, segurança e prevenção —, tratando apenas o mínimo de dados indispensável a cada finalidade.</p>
        <p style={{ marginTop: 10 }}><strong>Bases legais (LGPD Art. 7º):</strong> <strong>execução do contrato</strong> celebrado com você (inciso V) para prestar os serviços contratados; <strong>consentimento</strong> (inciso I) para as finalidades que dele dependem, revogável a qualquer tempo; <strong>cumprimento de obrigação legal ou regulatória</strong> (inciso II) para escrituração fiscal e contábil; e <strong>legítimo interesse</strong> (inciso IX) para segurança da plataforma, prevenção a fraudes e defesa em contestações de pagamento, sempre com respeito às suas legítimas expectativas e aos seus direitos e liberdades fundamentais.</p>

        <h2 style={h2}>3. Compartilhamento e transferência internacional</h2>
        <p>Compartilhamos dados apenas com prestadores essenciais à operação, na medida necessária para prestar o serviço: processadores de pagamento (Asaas e Mercado Pago), infraestrutura e banco de dados (Supabase), hospedagem da aplicação (Vercel), cópia de segurança de arquivos (Cloudflare R2), proteção contra abuso e controle de uso (Upstash), envio de e-mails (Resend), reuniões por vídeo (Daily.co) e, quando aplicável, advogado/escritório jurídico parceiro para a assessoria contratada. Não vendemos seus dados.</p>
        <p style={{ marginTop: 10 }}><strong>Uso de inteligência artificial:</strong> para gerar as análises, dados do imóvel e o conteúdo dos documentos enviados podem ser processados por provedores de IA (Anthropic/Claude e Google/Gemini). Esses provedores atuam como operadores, tratando os dados exclusivamente para gerar o resultado solicitado.</p>
        <p style={{ marginTop: 10 }}><strong>Transferência internacional (LGPD Arts. 33 a 36):</strong> alguns desses prestadores — provedores de IA, e-mail, vídeo, hospedagem e cópia de segurança — processam ou armazenam dados em servidores fora do Brasil, inclusive nos Estados Unidos. Informamos isso de forma prévia e destacada, e a transferência se apoia em:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li style={{ marginBottom: 6 }}><strong>Garantias de conformidade (Art. 33, II):</strong> contratamos esses fornecedores sob acordos de tratamento de dados (DPA) com cláusulas de proteção equivalentes às exigidas pela LGPD, alinhados às <strong>cláusulas-padrão contratuais</strong> aprovadas pela ANPD na <strong>Resolução CD/ANPD nº 19/2024</strong>.</li>
          <li style={{ marginBottom: 6 }}><strong>Execução do contrato (Art. 33, IX):</strong> a transferência é necessária para prestar o serviço que você contratou.</li>
          <li style={{ marginBottom: 6 }}><strong>Seu consentimento específico e destacado (Art. 33, VIII):</strong> obtido no aceite dos Termos e desta Política, com informação prévia sobre o caráter internacional da operação.</li>
        </ul>
        <p style={{ marginTop: 10 }}><strong>A lei brasileira continua valendo.</strong> Ainda que um dado esteja armazenado no exterior, a coleta e o tratamento ocorrem no Brasil e permanecem submetidos à legislação brasileira e à competência das autoridades nacionais, nos termos do <strong>Art. 11 do Marco Civil da Internet (Lei nº 12.965/2014)</strong> e do Art. 3º da LGPD. Guardar cópia fora do país não transfere seus direitos para fora do país: eles continuam exercíveis contra nós, aqui, pelos canais da seção 8.</p>

        <p style={{ marginTop: 10 }}><strong>Cópia de segurança fora do Brasil:</strong> o banco de dados e os arquivos ficam hospedados no <strong>Brasil</strong> (Supabase, região de São Paulo). Para que um incidente nessa infraestrutura não cause perda definitiva, mantemos uma <strong>cópia de segurança em servidores da Cloudflare (R2) na América do Norte</strong>. Essa cópia abrange os arquivos que não podem ser recuperados de outra forma — como documentos que você envia (identificação, contratos e comprovantes) — e um retrato periódico das tabelas essenciais do sistema, que inclui dados cadastrais. Ela é usada <strong>exclusivamente para restauração em caso de desastre</strong>, tem acesso restrito à operação da plataforma e trafega criptografada.</p>

        <p style={{ marginTop: 10 }}><strong>Exclusão alcança a cópia (LGPD Art. 16 e Art. 18, VI):</strong> quando um dado é excluído ou anonimizado no sistema principal — por encerramento de conta, por exercício do seu direito de eliminação ou por vencimento do prazo de retenção —, ele deixa de constar da cópia de segurança na sincronização seguinte, que ocorre <strong>diariamente</strong>. Os retratos periódicos do banco são mantidos por no máximo <strong>90 dias</strong> e descartados automaticamente. Ou seja, a cópia de segurança <strong>não funciona como arquivo permanente</strong>: ela acompanha o dado de origem e termina quando ele termina, ressalvadas apenas as hipóteses do Art. 16 da LGPD (cumprimento de obrigação legal, estudo por órgão de pesquisa, transferência a terceiro com observância da lei, ou uso exclusivo do controlador com dados anonimizados).</p>
        <p style={{ marginTop: 10 }}><strong>Reuniões por vídeo:</strong> as reuniões de assessoria podem ser transcritas automaticamente para fins de qualidade e auditoria, mediante aviso na entrada da sala, conforme a Lei nº 9.296/1996 (Art. 10) e a LGPD (Art. 7º, I).</p>

        <h2 style={h2}>4. Programa de Parceiros e rede de indicações</h2>
        <p>Se você aderir ao Programa de Parceiros, tratamos o <strong>vínculo de indicação</strong> (quem indicou quem) para calcular e pagar comissões, e a sua <strong>chave PIX</strong> e dados financeiros para efetuar os pagamentos. A base legal é a <strong>execução do contrato</strong> do Programa (o Termo de Adesão que você aceita) e o seu <strong>consentimento</strong>.</p>
        <p style={{ marginTop: 10 }}><strong>Visibilidade dos seus indicados (minimização de dados):</strong> na tela "Indicações", o parceiro visualiza: (a) dos seus <strong>indicados diretos</strong> — pessoas que ele mesmo trouxe (sua venda direta) — nome, cidade/UF e <strong>contato (telefone e e-mail)</strong>, para o relacionamento comercial legítimo com o próprio indicado; e (b) da <strong>rede abaixo</strong> deles (indicações feitas pelos seus próprios indicados) — <strong>apenas nome e cidade/UF</strong>, nunca dados de contato. Esses dados são disponibilizados exclusivamente para o parceiro conduzir e acompanhar o programa; ao usá-los, o parceiro assume a condição de <strong>corresponsável</strong> pelo tratamento e compromete-se a utilizá-los somente para essa finalidade, respeitando a LGPD e sem repassá-los a terceiros (LGPD, Art. 42 e seguintes). O administrador da plataforma pode visualizar as indicações para fins de gestão e conformidade.</p>
        <p style={{ marginTop: 10 }}>As comissões são devidas conforme o Termo de Adesão do Programa; valores relativos a pagamentos estornados (chargeback) ou fraudes são revertidos, com identificação da transação de origem.</p>

        <h2 style={h2}>5. Seus direitos (LGPD Art. 18)</h2>
        <p>Em conformidade com o Art. 18 da LGPD, você tem os seguintes direitos em relação aos seus dados pessoais, exercíveis a qualquer momento:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li style={{ marginBottom: 8 }}><strong>Acesso e portabilidade:</strong> Você pode baixar uma cópia completa de todos os seus dados pessoais diretamente na página <strong>Meu Perfil</strong>, clicando em "Baixar meus dados". O arquivo é gerado instantaneamente no formato JSON.</li>
          <li style={{ marginBottom: 8 }}><strong>Retificação:</strong> Você pode corrigir seu nome a qualquer momento na página Meu Perfil. Para alteração de e-mail, entre em contato com o DPO.</li>
          <li style={{ marginBottom: 8 }}><strong>Exclusão (direito ao esquecimento):</strong> Você pode solicitar a exclusão da sua conta diretamente na página <strong>Meu Perfil</strong>, na seção "Seus Dados (LGPD)". Seus dados pessoais (nome, CPF, telefone) serão anonimizados imediatamente. Registros financeiros são mantidos pelo prazo legal (veja seção 6). Sua sessão será encerrada automaticamente.</li>
          <li style={{ marginBottom: 8 }}><strong>Revogação do consentimento:</strong> Você pode revogar o consentimento a qualquer momento, o que implicará na impossibilidade de uso dos serviços que dele dependem.</li>
          <li style={{ marginBottom: 8 }}><strong>Oposição:</strong> Você pode se opor ao tratamento de dados realizado com fundamento em legítimo interesse.</li>
        </ul>
        <p style={{ marginTop: 12 }}>Respondemos a solicitações de direitos no prazo de <strong>até 15 dias úteis</strong>, conforme previsto no Art. 18 da LGPD.</p>

        <h2 style={h2}>6. Segurança e retenção de dados</h2>
        <p>Adotamos medidas técnicas e organizacionais para proteger seus dados contra acesso não autorizado, perda ou destruição, incluindo criptografia em trânsito (TLS), autenticação segura e <strong>cópia de segurança em região distinta da principal</strong> (ver seção 3), para que uma falha de infraestrutura não implique perda definitiva dos seus documentos.</p>
        <p style={{ marginTop: 10 }}>Prazos de retenção:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li style={{ marginBottom: 6 }}><strong>Dados financeiros e registros de compras:</strong> mantidos por <strong>5 anos</strong> após o encerramento da conta, em cumprimento às obrigações legais e fiscais (Lei nº 9.613/98 e legislação tributária aplicável).</li>
          <li style={{ marginBottom: 6 }}><strong>Dados pessoais, histórico de buscas, alertas e filtros salvos:</strong> excluídos ou anonimizados imediatamente no encerramento da conta.</li>
          <li style={{ marginBottom: 6 }}><strong>Dados de suporte (chamados):</strong> mantidos por até 2 anos para fins de auditoria.</li>
          <li style={{ marginBottom: 6 }}><strong>Documentos de leilão arquivados (editais, matrículas):</strong> mantidos enquanto necessários às análises e ao acompanhamento do leilão, e removidos quando expiram ou deixam de ser necessários, conforme nossa política de retenção interna.</li>
          <li style={{ marginBottom: 6 }}><strong>Cópia de segurança (backup):</strong> acompanha o dado de origem — o que é excluído no sistema principal sai da cópia na sincronização diária seguinte; os retratos periódicos do banco são descartados após <strong>90 dias</strong>.</li>
        </ul>

        <h2 style={h2}>7. Incidentes de segurança e registro das operações</h2>
        <p><strong>Comunicação de incidente (LGPD Art. 48):</strong> se ocorrer incidente de segurança que possa acarretar risco ou dano relevante a você, comunicaremos <strong>a ANPD e você, titular</strong>, em prazo razoável, informando: a natureza dos dados afetados, os titulares envolvidos, as medidas técnicas de proteção que estavam em uso, os riscos envolvidos, os motivos de eventual demora e as providências adotadas para reverter ou mitigar o dano. Não condicionamos essa comunicação a pedido seu — ela é dever nosso.</p>
        <p style={{ marginTop: 10 }}><strong>Registro das operações (LGPD Art. 37):</strong> mantemos registro das operações de tratamento que realizamos, à disposição da autoridade nacional. Registramos também os aceites de termos com data, hora, IP e identificação do dispositivo, o que protege você (prova do que foi apresentado e quando) e a empresa (prova da manifestação de vontade), nos termos da MP nº 2.200-2/2001, Art. 10, §2º.</p>
        <p style={{ marginTop: 10 }}><strong>Relatório de impacto (LGPD Art. 38):</strong> quando a autoridade nacional solicitar, elaboraremos e forneceremos relatório de impacto à proteção de dados pessoais referente às nossas operações.</p>

        <h2 style={h2}>8. Encarregado pelo Tratamento de Dados (DPO)</h2>
        <p>Em cumprimento ao Art. 41 da LGPD, designamos um Encarregado pelo Tratamento de Dados Pessoais (Data Protection Officer — DPO). Para exercer seus direitos, esclarecer dúvidas sobre privacidade ou registrar reclamações, entre em contato:</p>
        <p style={{ marginTop: 10 }}>
          <strong>E-mail:</strong> <a href="mailto:privacidade@bidprobrasil.com.br" style={{ color: '#0D63DB', fontWeight: 700 }}>privacidade@bidprobrasil.com.br</a><br />
          <strong>Prazo de resposta:</strong> até 15 dias úteis (LGPD Art. 18, §5º)
        </p>
      </div>
    </div>
  );
}
