/** npm run testar:patio-veiculo — local do pátio por fonte (formatos medidos no acervo em 24/09). */
import { localDoPatio } from '../../src/utils/patioVeiculo.js';
let falhas = 0;
const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { falhas++; console.log(`  ✗ ${m}`); } };
const s = localDoPatio({ cidade: 'Guarulhos', estado: 'SP', raw: { lot_location: 'guarulhos i/sp', lot_location_address: 'rod. pres. dutra, km 223,5 pista lateral guarulhos' } });
ok(s.endereco === 'rod. pres. dutra, km 223,5 pista lateral guarulhos' && s.mapaUrl.includes('dutra'), 'SODRE: endereço completo do pátio');
const b = localDoPatio({ cidade: 'Campinas', estado: 'SP', raw: { offerDescription: '<p>comparecer ao pátio na data</p>', product: { location: { city: 'Campinas - SP', locationGeo: { lat: -22.9, lon: -47.06 } } } } });
ok(!b.endereco && b.cidade === 'Campinas - SP' && b.mapaAproximado && b.mapaUrl.includes('-22.9,-47.06'), 'SUPERBID: sem rua → cidade + mapa aproximado pela coordenada');
const b2 = localDoPatio({ raw: { offerDescription: 'Endereço  : Rua Escolástica Maria de Jesus, n.º 215, Jardim Baronesa, CEP 12091-050, Taubaté SP. (Fls. 238)' } });
ok(/Escolástica.*Taubaté SP/.test(b2.endereco || ''), 'SUPERBID: "Endereço:" na descrição vence');
const z = localDoPatio({ raw: { addr: '.st0{fill:none;} Carro, VW/Amarok V6 High, flex, cor preta, 2023/2023, placa GFX8H95. Bragança Paulista / SP - Condomínio Residencial Euroville II' } });
ok(z.endereco === 'Bragança Paulista / SP - Condomínio Residencial Euroville II', 'ZUK: cidade/UF - bairro do fim do cartão');
const n = localDoPatio({ cidade: 'Sorocaba', estado: 'SP', raw: { localidade: 'Sorocaba, SP' } });
ok(!n.endereco && n.cidade === 'Sorocaba, SP' && /só a cidade/.test(n.origem), 'MEGA: só cidade, e a tela diz isso');
console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
