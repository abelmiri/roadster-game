import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/lan/wifi.ts'],
  bundle: true,
  format: 'esm',
  write: false,
});
const { addWifiCandidates, isPrivateWifiAddress, wifiAddressFromSdp } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'),
);

test('a Wi-Fi address must be a private IPv4 literal', () => {
  for (const address of ['10.0.0.12', '172.16.0.4', '172.31.0.4', '192.168.100.39']) {
    assert.equal(isPrivateWifiAddress(address), true, address);
  }
  for (const address of ['192.168.0.256', '192.168.1.025', '127.0.0.1', '172.32.0.4', '8.8.8.8',
    'https://192.168.0.1', '192.168.0.1:4173', '::1', undefined]) {
    assert.equal(isPrivateWifiAddress(address), false, address);
  }
});

test('the manual Wi-Fi route preserves the original offer and the browser’s candidate ports', () => {
  const lines = [
    'v=0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=candidate:1 1 udp 2122260223 guest.local 52000 typ host generation 0',
    'a=candidate:2 1 udp 2122260223 another.local 52001 typ host',
    'a=candidate:3 1 tcp 1518280447 guest.local 9 typ host tcptype active',
    'a=candidate:4 1 udp 1322260223 10.12.4.8 52002 typ host',
    'a=end-of-candidates',
    '',
  ];
  const sdp = lines.join('\r\n');
  const expected = [...lines];
  expected.splice(4, 0, 'a=candidate:wifi3 1 udp 2122260223 192.168.0.7 52001 typ host');
  expected.splice(3, 0, 'a=candidate:wifi2 1 udp 2122260223 192.168.0.7 52000 typ host generation 0');
  assert.equal(addWifiCandidates(sdp, '192.168.0.7'), expected.join('\r\n'));
  assert.equal(addWifiCandidates(sdp, '8.8.8.8'), sdp);
});


test('autofill uses one exposed private host address and leaves ambiguous or masked addresses to the user', () => {
  const masked = 'a=candidate:1 1 udp 2122260223 masked.local 50100 typ host';
  const wifi = 'a=candidate:2 1 udp 2122260223 192.168.100.39 50101 typ host';
  const vpn = 'a=candidate:3 1 udp 2122260223 10.1.0.9 50102 typ host';
  const publicRelay = 'a=candidate:4 1 udp 2122260223 203.0.113.1 50103 typ relay';
  assert.equal(wifiAddressFromSdp(masked), undefined);
  assert.equal(wifiAddressFromSdp([masked, wifi, wifi, publicRelay].join('\r\n')), '192.168.100.39');
  assert.equal(wifiAddressFromSdp([wifi, vpn].join('\n')), undefined);
});
