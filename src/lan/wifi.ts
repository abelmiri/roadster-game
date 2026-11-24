export function isPrivateWifiAddress(address: unknown): address is string {
  if (typeof address !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(address)) return false;
  const octets = address.split('.').map(Number);
  if (octets.some(octet => octet > 255)) return false;
  const [first, second] = octets;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

export function wifiAddressFromSdp(sdp: string): string | undefined {
  const addresses = new Set<string>();
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith('a=candidate:')) continue;
    const [, , protocol, , address, , type, kind] = line.split(/\s+/);
    if (protocol?.toLowerCase() === 'udp' && type === 'typ' && kind === 'host' && isPrivateWifiAddress(address)) {
      addresses.add(address);
    }
  }
  // Several addresses can represent different interfaces, including a VPN.
  if (addresses.size === 1) return addresses.values().next().value;
}

/** Keep the browser's candidates and add the explicitly shared Wi-Fi address as an alternate route. */
export function addWifiCandidates(sdp: string, address: string): string {
  if (!isPrivateWifiAddress(address)) return sdp;
  const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
  return sdp.split(newline).flatMap((line, index) => {
    if (!line.startsWith('a=candidate:')) return [line];
    const parts = line.split(/\s+/);
    if (parts[2]?.toLowerCase() !== 'udp' || parts[6] !== 'typ' || parts[7] !== 'host' ||
        !/\.local\.?$/i.test(parts[4])) return [line];
    parts[0] = `a=candidate:wifi${index}`;
    parts[4] = address;
    return [line, parts.join(' ')];
  }).join(newline);
}
