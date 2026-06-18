// Dados fixos da empresa contratante
const EMPRESA = {
  razao_social: 'NOGUEIRA EMPREENDIMENTOS LTDA',
  cnpj: '02.311.492/0001-61',
  cidade: 'Feira de Santana',
  estado: 'BA',
  foro: 'Feira de Santana/BA',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { descricao, tipo, titulo, arquivos = [], respostas } = req.body || {};
  if (!descricao) return res.status(400).json({ error: 'descricao obrigatória' });

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chave de API não configurada' });

  const tipoLabel = {
    servico: 'Prestação de Serviços',
    prestacao: 'Prestação de Serviços',
    locacao: 'Locação de Imóvel',
    compra: 'Compra e Venda de Imóvel',
    nda: 'Acordo de Confidencialidade e Não Divulgação (NDA)',
    outro: 'Contrato',
  }[tipo] || 'Prestação de Serviços';

  // Contexto dos arquivos
  const ctxArquivos = arquivos.length > 0
    ? '\n\nDocumentos de referência fornecidos:\n' +
      arquivos.map(a => a.conteudo
        ? `--- ${a.nome} ---\n${a.conteudo}`
        : `• Arquivo referenciado: ${a.nome}`
      ).join('\n\n')
    : '';

  // Respostas às perguntas anteriores
  const ctxRespostas = respostas && Object.keys(respostas).length > 0
    ? '\n\nRespostas às perguntas da rodada anterior:\n' + Object.values(respostas).map((r, i) => `${i+1}. ${r}`).join('\n')
    : '';

  const prompt = `Você é um especialista jurídico brasileiro contratado pela ${EMPRESA.razao_social} para redigir contratos.

=== DADOS DA EMPRESA CONTRATANTE (use exatamente como estão — não use placeholder) ===
Razão Social: ${EMPRESA.razao_social}
CNPJ: ${EMPRESA.cnpj}
Foro: ${EMPRESA.foro} (sempre — salvo instrução explícita em contrário)

=== SOLICITAÇÃO ===
Tipo de contrato: ${tipoLabel}
Título: ${titulo || tipoLabel}
Descrição fornecida: ${descricao}
${ctxArquivos}
${ctxRespostas}

=== INSTRUÇÕES OBRIGATÓRIAS ===

1. DADOS QUE VOCÊ JÁ CONHECE — use diretamente, sem placeholder:
   - Contratante: ${EMPRESA.razao_social}, CNPJ ${EMPRESA.cnpj}, Feira de Santana/BA
   - Foro: comarca de ${EMPRESA.foro}

2. DADOS QUE O SIGNATÁRIO PREENCHERÁ — use estes placeholders exatos:
   - [NOME DO SIGNATÁRIO]
   - [CPF/CNPJ DO SIGNATÁRIO]
   - [RG DO SIGNATÁRIO] (se PF)
   - [ENDEREÇO DO SIGNATÁRIO]
   - [EMAIL DO SIGNATÁRIO]

3. REGRA CRÍTICA — PROIBIDO deixar qualquer outro placeholder ou "[A DEFINIR]":
   - Se o valor não foi informado e é relevante → adicione à seção PERGUNTAS
   - Se o prazo não foi informado → adicione à seção PERGUNTAS
   - Se a forma de pagamento não foi informada → adicione à seção PERGUNTAS
   - Se precisar de qualquer dado que não está na descrição e não é dado do signatário → adicione à seção PERGUNTAS
   - Em caso de dúvida: PERGUNTE, não invente, não deixe em branco

4. ESTRUTURA DO CONTRATO:
   - Preâmbulo com qualificação das partes (contratante completo + signatário com placeholders)
   - Cláusulas numeradas em ordinais (CLÁUSULA 1ª — DO OBJETO, etc.)
   - Inclua sempre: objeto, obrigações, prazo, valor/pagamento (se aplicável), confidencialidade (se NDA), LGPD, rescisão, penalidades, foro
   - Sem asteriscos, markdown ou formatação especial — apenas texto corrido jurídico
   - Local e data ao final: "Feira de Santana, _____ de _____________ de 20____."
   - Campos de assinatura: um para cada parte

5. TAMANHO: máximo 1000 palavras, linguagem jurídica formal, português brasileiro

=== SEÇÃO DE PERGUNTAS ===
Ao final, inclua obrigatoriamente entre os marcadores abaixo as perguntas sobre informações ausentes que sejam CRÍTICAS para a segurança jurídica do contrato. Se não houver nada faltando, deixe vazio.

<<<PERGUNTAS>>>
(uma pergunta por linha, numeradas)
<<<FIM_PERGUNTAS>>>`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2500,
        system: `Você é um advogado especialista em contratos brasileiros trabalhando para a ${EMPRESA.razao_social}.
Você conhece a empresa profundamente: CNPJ ${EMPRESA.cnpj}, sede em ${EMPRESA.cidade}/${EMPRESA.estado}, foro sempre em ${EMPRESA.foro}.
Você NUNCA deixa campos em branco ou com placeholder exceto para os dados do signatário (a outra parte).
Quando falta alguma informação relevante, você PERGUNTA — nunca inventa ou deixa "[A PREENCHER]".`,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(502).json({ error: 'Erro ao gerar contrato' });
    }

    const data = await response.json();
    const texto = data.content?.[0]?.text || '';

    // Extrai perguntas
    const matchP = texto.match(/<<<PERGUNTAS>>>([\s\S]*?)<<<FIM_PERGUNTAS>>>/);
    const blocoPerguntas = matchP ? matchP[1].trim() : '';
    const perguntas = blocoPerguntas
      ? blocoPerguntas.split('\n').map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean)
      : [];

    // Remove bloco de perguntas do conteúdo
    const conteudo = texto
      .replace(/<<<PERGUNTAS>>>[\s\S]*?<<<FIM_PERGUNTAS>>>/, '')
      .replace(/\*\*/g, '')   // remove markdown bold
      .replace(/##\s*/g, '')  // remove markdown headers
      .trim();

    return res.status(200).json({ conteudo, perguntas });
  } catch (e) {
    console.error('gerar-contrato error:', e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
