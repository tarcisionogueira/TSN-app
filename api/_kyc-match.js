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
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text || '{}';
    try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { return null; }
  } catch { return null; }
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
