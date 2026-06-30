/**
 * Emissão de NFS-e (serviço) — GANCHO preparado e DESATIVADO por padrão.
 *
 * Ativa apenas quando as variáveis estiverem configuradas na Vercel:
 *   NFSE_PROVIDER   ex.: 'webiss' | 'focus' | 'nfeio' | 'webmania' | 'enotas'
 *   NFSE_API_URL    endpoint de emissão do provedor/middleware
 *   NFSE_API_KEY    token/credencial do provedor
 *   NFSE_CODIGO_SERVICO / NFSE_ISS_PCT  (opcionais — conforme o município)
 *
 * Feira de Santana-BA: a EMISSÃO é via WebISS (emissor próprio + Ambiente de
 * Dados Nacional). Provedores middleware (Focus NFe, NFE.io, Webmania) já
 * atendem o WebISS de Feira de Santana; também é possível integrar direto no
 * WebISS (sem mensalidade, porém mais desenvolvimento). Em qualquer caso o
 * certificado A1 e-CNPJ fica no provedor/serviço — NUNCA no código.
 *
 * Esta função NUNCA lança para o chamador (retorna status) e é no-op enquanto
 * desativada — o fluxo de pagamento não depende dela.
 */

export function nfseAtivo() {
  return !!(process.env.NFSE_PROVIDER && process.env.NFSE_API_URL && process.env.NFSE_API_KEY);
}

export async function emitirNFSeServico({ tomador, valor, descricao, referencia } = {}) {
  if (!nfseAtivo()) return { skipped: true, motivo: 'nfse_desativada' };

  const cpf = String(tomador?.cpf || '').replace(/\D/g, '');
  if (!tomador?.nome || cpf.length !== 11) return { skipped: true, motivo: 'tomador_incompleto' };
  if (!(Number(valor) > 0)) return { skipped: true, motivo: 'valor_invalido' };

  // Payload genérico (tomador + serviço). O mapeamento exato p/ o schema do
  // provedor escolhido é o último passo da ativação (ex.: Focus/NFE.io/WebISS).
  const payload = {
    referencia: referencia || null, // idempotência (ex.: gatewayPaymentId)
    tomador: {
      nome: tomador.nome,
      cpf,
      email: tomador.email || null,
      endereco: {
        cep: tomador.endereco_cep || null,
        logradouro: tomador.endereco_logradouro || null,
        numero: tomador.endereco_numero || null,
        complemento: tomador.endereco_complemento || null,
        bairro: tomador.endereco_bairro || null,
        cidade: tomador.endereco_cidade || null,
        uf: tomador.endereco_uf || null,
      },
    },
    servico: {
      valor: Number(valor),
      descricao: descricao || 'Serviço BidPro Brasil',
      codigo: process.env.NFSE_CODIGO_SERVICO || null,
      iss_pct: process.env.NFSE_ISS_PCT ? Number(process.env.NFSE_ISS_PCT) : null,
    },
    provider: process.env.NFSE_PROVIDER,
  };

  try {
    const res = await fetch(process.env.NFSE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NFSE_API_KEY}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, data };
    return { ok: true, provider: payload.provider, data };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}
