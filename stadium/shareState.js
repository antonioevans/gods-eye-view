const VERSION = 1;

export function encodeScenario(scenario) {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: VERSION, ...scenario }));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeScenario(search) {
  try {
    const encoded = new URLSearchParams(search).get('scenario');
    if (!encoded || encoded.length > 50000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value?.version === VERSION && typeof value === 'object' ? value : null;
  } catch { return null; }
}

export function publicScenarioUrl(scenario) {
  const url = new URL('https://antonioevans.github.io/gods-eye-view/stadium.html');
  url.searchParams.set('scenario', encodeScenario(scenario));
  return url.href;
}
