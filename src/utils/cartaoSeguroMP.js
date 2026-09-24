import { useEffect, useRef, useState } from 'react';

/**
 * CARTÃO POR "SECURE FIELDS" DO MERCADO PAGO — 24/09, pedido do dono.
 *
 * Até aqui o número, a validade e o CVV eram <input> NOSSOS: o número do cartão passava pelo nosso
 * JavaScript antes de virar token (`mp.createCardToken({ cardNumber, … })`). A qualidade da
 * integração do MP cobra "Formulário de cartões — PCI Compliance: capture por Secure Fields"
 * (obrigatória, 8 pontos). Agora esses três campos são iframes do MP MONTADOS DENTRO do nosso
 * formulário — a pessoa não sai da tela, o layout/borda/cor são nossos (o contêiner) e só o
 * conteúdo digitado vive no MP. Nome no cartão, CPF e endereço continuam campos nossos.
 *
 * Também carrega o `security.js` do MP (device ID → window.MP_DEVICE_SESSION_ID, que o
 * `obterDeviceId` de PagamentoServico já lia): sem ele o identificador do dispositivo não era
 * gerado, e o CSP bloqueava o domínio (vercel.json liberou `https://www.mercadopago.com`).
 */
const PK = import.meta.env.VITE_MP_PUBLIC_KEY || '';

let sdkPromise = null;
export function carregarSdkMP() {
  if (typeof window === 'undefined') return Promise.reject(new Error('sem navegador'));
  if (!document.querySelector('script[data-mp-security]')) {
    const d = document.createElement('script');
    d.src = 'https://www.mercadopago.com/v2/security.js';
    d.setAttribute('view', 'checkout');
    d.dataset.mpSecurity = '1';
    document.head.appendChild(d); // falhar aqui não impede pagar — só vai sem device ID
  }
  if (window.MercadoPago) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://sdk.mercadopago.com/js/v2';
      s.onload = resolve;
      s.onerror = () => {
        sdkPromise = null; // deixa tentar de novo numa próxima montagem
        reject(Object.assign(new Error('Não conseguimos carregar o componente de cartão (ele costuma ser barrado por bloqueador de anúncios ou extensão de privacidade). Desative para este site e tente de novo.'), { sdkBloqueado: true }));
      };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

// Estilo DENTRO do iframe (o MP aceita só propriedades de texto); borda/fundo/altura são do contêiner.
const ESTILO_CAMPO = { height: '100%', fontSize: '14px', color: '#111111', placeholderColor: '#94a3b8' };

const esperarElemento = (id, tentativas = 20) => new Promise(resolve => {
  const tenta = (n) => {
    if (document.getElementById(id)) return resolve(true);
    if (n <= 0) return resolve(false);
    requestAnimationFrame(() => tenta(n - 1));
  };
  tenta(tentativas);
});

/**
 * @param {boolean} ativo  o formulário de cartão está na tela (monta/desmonta os campos)
 * @param {string} prefixo id único do formulário (dois formulários na mesma página não colidem)
 * @returns {{ ids, pronto, erroSdk, bin, tokenizar }}
 *   ids: { numero, validade, cvv } — ids dos <div> onde os campos são montados
 *   bin: 6–8 primeiros dígitos (evento do MP) — para descobrir a bandeira sem ler o número
 *   tokenizar({ cardholderName, cpf? }) → token do MP ({ id, … }); lança Error com mensagem para a pessoa
 */
export function useCartaoSeguroMP(ativo, prefixo = 'cartao') {
  const ids = { numero: `${prefixo}-mp-numero`, validade: `${prefixo}-mp-validade`, cvv: `${prefixo}-mp-cvv` };
  const [pronto, setPronto] = useState(false);
  const [erroSdk, setErroSdk] = useState('');
  const [bin, setBin] = useState('');
  const mpRef = useRef(null);
  const camposRef = useRef([]);
  const bloqueadoRef = useRef(false); // SDK barrado (adblock) — os fluxos usam isso para cair no Asaas

  useEffect(() => {
    if (!ativo) return undefined;
    let vivo = true;
    (async () => {
      try {
        if (!PK) throw new Error('Pagamento indisponível no momento. Tente mais tarde.');
        await carregarSdkMP();
        const existem = await Promise.all([esperarElemento(ids.numero), esperarElemento(ids.validade), esperarElemento(ids.cvv)]);
        if (!vivo) return;
        if (existem.includes(false)) throw new Error('Não conseguimos montar o formulário de cartão. Recarregue a página.');
        const mp = new window.MercadoPago(PK);
        mpRef.current = mp;
        const numero = mp.fields.create('cardNumber', { placeholder: '0000 0000 0000 0000', style: ESTILO_CAMPO }).mount(ids.numero);
        const validade = mp.fields.create('expirationDate', { placeholder: 'MM/AA', style: ESTILO_CAMPO }).mount(ids.validade);
        const cvv = mp.fields.create('securityCode', { placeholder: 'CVV', style: ESTILO_CAMPO }).mount(ids.cvv);
        numero.on('binChange', (d) => setBin(d?.bin ? String(d.bin) : ''));
        camposRef.current = [numero, validade, cvv];
        setErroSdk('');
        setPronto(true);
      } catch (e) {
        bloqueadoRef.current = !!e?.sdkBloqueado;
        if (vivo) setErroSdk(e?.message || 'Não conseguimos carregar o formulário de cartão.');
      }
    })();
    return () => {
      vivo = false;
      camposRef.current.forEach(f => { try { f.unmount(); } catch { /* campo já desmontado pelo próprio MP */ } });
      camposRef.current = [];
      mpRef.current = null;
      setPronto(false);
      setBin('');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, prefixo]);

  const tokenizar = async ({ cardholderName, cpf }) => {
    if (erroSdk) throw Object.assign(new Error(erroSdk), { sdkBloqueado: bloqueadoRef.current });
    if (!mpRef.current || !pronto) throw new Error('O formulário de cartão ainda está carregando. Aguarde um instante.');
    let token;
    try {
      const doc = String(cpf || '').replace(/\D/g, '');
      token = await mpRef.current.fields.createCardToken({
        cardholderName,
        ...(doc.length === 11 ? { identificationType: 'CPF', identificationNumber: doc } : {}),
      });
    } catch (e) {
      // O MP rejeita com uma LISTA de campos inválidos — para a pessoa, o que importa é qual conferir.
      const lista = Array.isArray(e) ? e : (Array.isArray(e?.cause) ? e.cause : []);
      const campos = lista.map(x => String(x?.field || x?.code || '')).join(' ');
      if (/cardNumber|number/i.test(campos)) throw new Error('Confira o número do cartão.', { cause: e });
      if (/expiration|month|year/i.test(campos)) throw new Error('Confira a validade do cartão (MM/AA).', { cause: e });
      if (/security|cvv/i.test(campos)) throw new Error('Confira o código de segurança (CVV).', { cause: e });
      throw new Error('Confira os dados do cartão (número, validade e CVV).', { cause: e });
    }
    if (!token?.id) throw new Error('Não foi possível validar o cartão. Confira os dados.');
    return token;
  };

  return { ids, pronto, erroSdk, bin, tokenizar };
}
