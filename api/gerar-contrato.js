export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { descricao, tipo, titulo } = req.body || {};
  if (!descricao) return res.status(400).json({ error: 'descricao obrigatória' });

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chave de API não configurada' });

  const tipoLabel = {
    servico: 'Prestação de Serviços',
    prestacao: 'Prestação de Serviços',
    locacao: 'Locação de Imóvel',
    compra: 'Compra e Venda',
    outro: 'Contrato',
  }[tipo] || 'Prestação de Serviços';

  const prompt = `Você é um assistente jurídico especializado em contratos brasileiros.
Gere um contrato completo e profissional de "${tipoLabel}" com base na descrição abaixo.

Título: ${titulo || tipoLabel}
Descrição: ${descricao}

Regras obrigatórias:
- A CONTRATANTE é sempre "NOGUEIRA EMPREENDIMENTOS LTDA", inscrita no CNPJ a ser preenchido, com sede em [cidade a preencher]
- A CONTRATADA/CONTRATANTE (outra parte) terá os dados preenchidos pelo signatário no momento da assinatura — use [NOME DO SIGNATÁRIO], [CPF/CNPJ], [ENDEREÇO] como placeholders
- Escreva em português brasileiro formal e jurídico
- Inclua: preâmbulo, objeto, obrigações das partes, valor e forma de pagamento (se aplicável), prazo, rescisão, foro (cidade do contratante)
- Numere as cláusulas em algarismos ordinais (CLÁUSULA 1ª, 2ª, etc.)
- Não inclua cabeçalhos de email, saudações nem assinaturas — apenas o corpo do contrato
- Ao final, deixe espaço para: "Local e data: ___________" e campos de assinatura de ambas as partes
- Máximo de 800 palavras`;

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
        max_tokens: 1500,
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
    return res.status(200).json({ conteudo: texto });
  } catch (e) {
    console.error('gerar-contrato error:', e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
