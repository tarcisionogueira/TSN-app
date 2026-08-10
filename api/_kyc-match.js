// Face match KYC (selfie × documento) — motor COMPARTILHADO entre o popup de parceiro
// (validar-selfie.js) e a assinatura de contrato de assessoria/club (assinar-contrato.js).
// Puro/sem estado: recebe as duas imagens em base64 e devolve o veredito da IA. Quem chama
// decide a política (aprovar/bloquear/revisão), pois o contexto difere (gate de KYC × ato jurídico).

import { anthropicFetch } from './_claude.js';

// Prompt SERVIDOR (nunca texto do cliente) do face match. Rigoroso; fail-closed no parsing.
export const PROMPT_MATCH = `Você é um verificador de identidade (KYC). Recebe DUAS imagens:
- Imagem 1 = SELFIE de uma pessoa.
- Imagem 2 = foto de um DOCUMENTO de identidade brasileiro (RG ou CNH), que contém uma foto de rosto.
Compare os rostos e avalie o documento. Responda SOMENTE com JSON, sem texto adicional:
{"selfie_rosto_ok": true/false, "documento_ok": true/false, "mesma_pessoa": true/false, "confianca": "alta"|"media"|"baixa", "motivo": "curto em pt-BR"}
Regras:
- "selfie_rosto_ok": a Imagem 1 tem UM rosto humano nítido e frontal (não é foto de objeto, tela, paisagem ou de outro documento).
- "documento_ok": a Imagem 2 é mesmo um documento de identidade com FOTO DE ROSTO visível e legível.
- "mesma_pessoa": o rosto da selfie e o rosto do documento são, com segurança, da MESMA pessoa. Se claramente diferentes, use false.
- "confianca": "alta" só quando a comparação é clara (boa qualidade nas duas imagens). Se alguma imagem está ruim/ilegível ou o documento não tem foto de rosto utilizável, use "baixa".`;

// Prompt SERVIDOR do modo COMBINADO (selfie_doc): rosto + documento na MESMA foto. Mesmas chaves
// de saída do match separado, p/ o chamador decidir de forma uniforme (selfie_rosto_ok = rosto ao vivo).
export const PROMPT_SELFIE_DOC = `Você é um verificador de identidade (KYC). Recebe UMA imagem que deve mostrar, no MESMO enquadramento, o ROSTO de uma pessoa (ao vivo) E o DOCUMENTO de identidade dela (RG ou CNH), que tem uma foto de rosto.
Responda SOMENTE com JSON, sem texto adicional:
{"selfie_rosto_ok": true/false, "documento_ok": true/false, "mesma_pessoa": true/false, "confianca": "alta"|"media"|"baixa", "motivo": "curto em pt-BR"}
Regras:
- "selfie_rosto_ok": há UM rosto humano nítido AO VIVO na foto (a pessoa se fotografando), não só a foto do documento.
- "documento_ok": há um documento de identidade com FOTO DE ROSTO visível e legível na mesma imagem.
- "mesma_pessoa": o rosto AO VIVO e o rosto IMPRESSO no documento são, com segurança, da MESMA pessoa. Se claramente diferentes, use false.
- "confianca": "alta" só quando dá para ver bem os DOIS rostos (o ao vivo e o do documento). Se algum está ilegível/ausente, use "baixa".`;

// dataURL "data:image/xxx;base64,..." → { b64, media }, ou null se não for imagem base64.
export function dataUrlParaImagem(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  const media = dataUrl.match(/data:(image\/\w+);/)?.[1] || 'image/jpeg';
  const b64 = dataUrl.split(',')[1];
  return b64 ? { b64, media } : null;
}

// Compara selfie × documento no Claude Vision (2 imagens, prompt do servidor).
// Retorna { selfie_rosto_ok, documento_ok, mesma_pessoa, confianca, motivo } — ou null em falha
// técnica (sem key, HTTP != ok, JSON inválido, exceção). O chamador decide fail-open/fail-closed.
export async function compararRostoDocumento({ selfieB64, selfieMedia, docB64, docMedia, claudeKey }) {
  if (!claudeKey || !selfieB64 || !docB64) return null;
  try {
    const res = await anthropicFetch({
      method: 'POST',
      headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Imagem 1 (SELFIE):' },
            { type: 'image', source: { type: 'base64', media_type: selfieMedia || 'image/jpeg', data: selfieB64 } },
            { type: 'text', text: 'Imagem 2 (DOCUMENTO):' },
            { type: 'image', source: { type: 'base64', media_type: docMedia || 'image/jpeg', data: docB64 } },
            { type: 'text', text: PROMPT_MATCH },
          ],
        }],
      }),
    }, {
      // ORÇAMENTO DE EDGE (10/08). Estes handlers são `runtime: 'edge'`, que tem teto DURO de
      // 25s para a resposta inicial, e chamavam `anthropicFetch` SEM opções — herdando o padrão
      // `retries: 3, timeoutMs: 120000` do `_claude.js`. Um único 529 do Anthropic já passava dos
      // 25s e a Vercel MATAVA a função: com isso todo o desenho de fail-open ('revisar'/
      // 'pendente', que existe justamente para não travar a assinatura de um contrato) virava
      // CÓDIGO MORTO — os catch nunca executavam e o cliente recebia erro de rede.
      // 1 retry de 8s (+~0,8s de espera) cabe com folga nos 25s e mantém a proteção contra o
      // 529 transitório. O remédio de fundo seria migrar para runtime Node com maxDuration (é o
      // que `api/claude.js` fez) — mas aí o `export default` teria de virar `export const POST`,
      // senão o Response é ignorado (a armadilha documentada em monitor-fontes-cron.js).
      retries: 1, timeoutMs: 8000,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text || '{}';
    try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { return null; }
  } catch { return null; }
}

// Modo COMBINADO (selfie_doc): uma imagem com rosto ao vivo + documento. Mesma forma de retorno
// do match separado (selfie_rosto_ok/documento_ok/mesma_pessoa/confianca) ou null em falha técnica.
export async function verificarSelfieComDocumento({ imgB64, imgMedia, claudeKey }) {
  if (!claudeKey || !imgB64) return null;
  try {
    const res = await anthropicFetch({
      method: 'POST',
      headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imgMedia || 'image/jpeg', data: imgB64 } },
            { type: 'text', text: PROMPT_SELFIE_DOC },
          ],
        }],
      }),
    }, {
      // ORÇAMENTO DE EDGE (10/08). Estes handlers são `runtime: 'edge'`, que tem teto DURO de
      // 25s para a resposta inicial, e chamavam `anthropicFetch` SEM opções — herdando o padrão
      // `retries: 3, timeoutMs: 120000` do `_claude.js`. Um único 529 do Anthropic já passava dos
      // 25s e a Vercel MATAVA a função: com isso todo o desenho de fail-open ('revisar'/
      // 'pendente', que existe justamente para não travar a assinatura de um contrato) virava
      // CÓDIGO MORTO — os catch nunca executavam e o cliente recebia erro de rede.
      // 1 retry de 8s (+~0,8s de espera) cabe com folga nos 25s e mantém a proteção contra o
      // 529 transitório. O remédio de fundo seria migrar para runtime Node com maxDuration (é o
      // que `api/claude.js` fez) — mas aí o `export default` teria de virar `export const POST`,
      // senão o Response é ignorado (a armadilha documentada em monitor-fontes-cron.js).
      retries: 1, timeoutMs: 8000,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text || '{}';
    try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { return null; }
  } catch { return null; }
}

// A imagem COMBINADA (rosto+documento numa foto só), se existir no mapa. Chaves conhecidas.
export function selecionarSelfieDoc(imagens) {
  if (!imagens || typeof imagens !== 'object') return null;
  for (const k of ['selfie_doc', 'selfie_com_documento']) {
    if (typeof imagens[k] === 'string' && imagens[k].startsWith('data:image/')) return imagens[k];
  }
  return null;
}

// Seleciona, de um mapa de imagens do KYC, a melhor SELFIE e o melhor DOCUMENTO para comparar.
// Cobre as chaves usadas na assinatura (verificacao_identidade + docs_extras_exigidos) e no popup.
// Ignora 'selfie_doc' (rosto E documento na MESMA foto — não há par separado p/ comparar).
const CHAVES_SELFIE = ['selfie', 'selfie_rosto', 'rosto'];
const CHAVES_DOC = ['foto_doc', 'doc_frente', 'documento', 'doc', 'doc_digital', 'doc_verso'];
export function selecionarParSelfieDoc(imagens) {
  if (!imagens || typeof imagens !== 'object') return null;
  const selfieKey = CHAVES_SELFIE.find(k => typeof imagens[k] === 'string' && imagens[k].startsWith('data:image/'));
  const docKey = CHAVES_DOC.find(k => typeof imagens[k] === 'string' && imagens[k].startsWith('data:image/'));
  if (!selfieKey || !docKey) return null;
  return { selfieKey, docKey, selfie: imagens[selfieKey], doc: imagens[docKey] };
}
