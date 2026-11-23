// Cliente do WS oficial da ONR (22/11): hash, envelope SOAP, leitura da resposta e erro dentro do 200.
import { hashOnr, envelope, deXml, lista, statusOnr, configOnr, faltaOnr, paraXml } from '../../api/_onr-ws.js';
import crypto from 'node:crypto';

let ok = 0, falhou = 0;
const t = (n, c) => { if (c) { ok++; console.log('  ✓', n); } else { falhou++; console.log('  ✗', n); } };

const esperado = crypto.createHash('sha1').update('CHAVEXJGX3QL', 'utf8').digest('hex');
t('hash = SHA1(chave+token), maiúsculo por padrão', hashOnr('CHAVEX', 'JGX3QL') === esperado.toUpperCase());
t('hash minúsculo quando pedido', hashOnr('CHAVEX', 'JGX3QL', 'lower') === esperado);
t('hash tem 40 caracteres (cabe no string(50) da spec)', hashOnr('a', 'b').length === 40);

const env = envelope('LoginClienteConvenio', { Email: 'a@b.com', CPF: '123', IDParceiro: 3985 });
t('envelope usa o namespace e o oRequest do WSDL', env.includes('<LoginClienteConvenio xmlns="http://tempuri.org/WSArisp"><oRequest><Email>a@b.com</Email><CPF>123</CPF><IDParceiro>3985</IDParceiro></oRequest>'));
t('campo nulo é omitido e texto é escapado', paraXml({ A: null, B: 'x<y&z' }) === '<B>x&lt;y&amp;z</B>');
t('lista vira elementos repetidos', paraXml({ M: { $item: 'Matricula_WSReq', itens: [{ N: 1 }, { N: 2 }] } }) === '<M><Matricula_WSReq><N>1</N></Matricula_WSReq><Matricula_WSReq><N>2</N></Matricula_WSReq></M>');

const respLogin = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><LoginClienteConvenioResponse xmlns="http://tempuri.org/WSArisp"><LoginClienteConvenioResult><RETORNO>true</RETORNO><CODIGOERRO>0</CODIGOERRO><IDCliente>77</IDCliente><Ativo>true</Ativo><Tokens><string>AAA111</string><string>BBB222</string></Tokens></LoginClienteConvenioResult></LoginClienteConvenioResponse></soap:Body></soap:Envelope>`;
const r = deXml(respLogin).Envelope.Body.LoginClienteConvenioResponse.LoginClienteConvenioResult;
t('lê RETORNO e tokens (lista com 2)', statusOnr(r).ok === true && lista(r.Tokens, 'string').join() === 'AAA111,BBB222');
const umSo = deXml('<X><Tokens><string>ZZZ999</string></Tokens></X>').X;
t('lista com 1 item também vira array', lista(umSo.Tokens, 'string').length === 1);

const erro = deXml('<R><RETORNO>false</RETORNO><CODIGOERRO>45</CODIGOERRO><ERRODESCRICAO>Hash inv&#225;lido &amp; tal</ERRODESCRICAO></R>').R;
const st = statusOnr(erro);
t('erro dentro do 200: RETORNO false com código e descrição', st.ok === false && st.codigo === 45 && st.descricao === 'Hash inválido & tal');
const pascal = statusOnr({ Retorno: 'false', Codigoerro: '13', Errodescricao: 'x' });
t('lê também a grafia Retorno/Codigoerro', pascal.ok === false && pascal.codigo === 13);
const cart = deXml('<R><Cartorios><Cartorio_WSResp><ID>1</ID><UF>BA</UF></Cartorio_WSResp><Cartorio_WSResp><ID>2</ID><UF>SP</UF></Cartorio_WSResp></Cartorios></R>').R;
t('cartórios: lista de objetos', lista(cart.Cartorios, 'Cartorio_WSResp').map((c) => c.UF).join() === 'BA,SP');

const cfg = configOnr({ ONR_WS_ID: '3985', ONR_WS_CHAVE: 'k', ONR_WS_EMAIL: 'e', ONR_WS_CPF: '042.000.000-00' });
t('config: CPF só dígitos, homologação por padrão', cfg.cpf === '04200000000' && cfg.base === 'https://hml3-ws.onr.org.br' && cfg.id === 3985);
t('config: aponta o que falta', faltaOnr(configOnr({})).join() === 'ONR_WS_ID,ONR_WS_CHAVE,ONR_WS_EMAIL,ONR_WS_CPF');

console.log(`\n${falhou ? '✗' : '✓'} ${ok}/${ok + falhou} asserções`);
if (falhou) process.exit(1);
