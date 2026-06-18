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
    compra: 'Compra e Venda',
    nda: 'NDA / Acordo de Confidencialidade',
    outro: 'Contrato',
  }[tipo] || 'Prestação de Serviços';

  // Monta contexto dos arquivos
  const ctxArquivos = arquivos.length > 0
    ? '\n\nDocumentos de referência fornecidos pelo admin:\n' +
      arquivos.map(a => a.conteudo
        ? `--- ${a.nome} ---\n${a.conteudo}`
        : `• ${a.nome} (arquivo anexado como referência)`
      ).join('\n\n')
    : '';

  // Monta respostas a perguntas anteriores
  const ctxRespostas = respostas && Object.keys(respostas).length > 0
    ? '\n\nRespostas às perguntas anteriores:\n' + Object.values(respostas).map((r, i) => `${i+1}. ${r}`).join('\n')
    : '';

  const prompt = `Você é um assistente jurídico especializado em contratos brasileiros.
Gere um contrato completo e profissional de "${tipoLabel}" com base nas informações abaixo.

Título: ${titulo || tipoLabel}
Descrição fornecida pelo admin: ${descricao}
${ctxArquivos}
${ctxRespostas}

Regras obrigatórias:
- A CONTRATANTE é sempre "NOGUEIRA EMPREENDIMENTOS LTDA", inscrita no CNPJ a ser preenchido, com sede em [cidade a preencher]
- A CONTRATADA/CONTRATANTE (outra parte) terá os dados preenchidos pelo signatário — use [NOME DO SIGNATÁRIO], [CPF/CNPJ], [ENDEREÇO] como placeholders
- Escreva em português brasileiro formal e jurídico
- Inclua: preâmbulo, objeto, obrigações das partes, valor e pagamento (se aplicável), prazo, rescisão, foro, cláusula LGPD se envolver dados pessoais
- Numere as cláusulas em algarismos ordinais (CLÁUSULA 1ª, 2ª, etc.)
- Não inclua cabeçalho, saudações ou assinaturas — apenas o corpo do contrato e local/data ao final
- Máximo de 1000 palavras

IMPORTANTE: Ao final do contrato, inclua uma seção separada chamada "PERGUNTAS" (entre marcadores <<<PERGUNTAS>>> e <<<FIM_PERGUNTAS>>>) listando APENAS as informações que faltam ou são ambíguas e que prejudicariam a segurança jurídica do contrato, como valor não informado, prazo indefinido, foro não especificado, etc. Se não houver nada crítico faltando, deixe a seção vazia. Exemplo:

<<<PERGUNTAS>>>
1. Qual é o valor mensal do contrato?
2. O contrato tem prazo determinado ou indeterminado?
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
        max_tokens: 2000,
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

    // Extrai perguntas da seção marcada
    const matchP = texto.match(/<<<PERGUNTAS>>>([\s\S]*?)<<<FIM_PERGUNTAS>>>/);
    const blocoPerguntas = matchP ? matchP[1].trim() : '';
    const perguntas = blocoPerguntas
      ? blocoPerguntas.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean)
      : [];

    // Remove bloco de perguntas do conteúdo
    const conteudo = texto.replace(/<<<PERGUNTAS>>>[\s\S]*?<<<FIM_PERGUNTAS>>>/, '').trim();

    return res.status(200).json({ conteudo, perguntas });
  } catch (e) {
    console.error('gerar-contrato error:', e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
