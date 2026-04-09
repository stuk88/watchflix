export const proxyAllowedDomains = [
  'netoda.tech',       // Current 123movies embed hub
  'embos.net',
  'vsembed.ru',
  'vidnest.fun',
  'vidsrc.cc',
  'vidlink.pro',
  'vidfast.pro',
  'videasy.net',
  'vidzee.wtf',
  'player.videasy.net',
  'mcloud.bz',
  'rabbitstream.net',
  'dokicloud.one',
  'megacloud.tv',
  'rapid-cloud.co',
  'opensubtitles.com',
  'dl.opensubtitles.org',
  'wizdom.xyz',
  'vip.openbullet.dev',
  // Russian streaming sources
  'hdrezka.ag',
  'hdrezka-home.tv',
  'rezka.ag',
  'sezonvar.org',
  'seasonvar.org',
  'filmix.fm',
  'filmix.my',
  'filmix.ac',
];

/** Returns true if the URL's hostname matches an allowed domain (including subdomains). */
export function isAllowedProxyUrl(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return proxyAllowedDomains.some(
    domain => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

export default {
  port: process.env.PORT || 3001,
  omdbApiKey: process.env.OMDB_API_KEY || 'b43344b2',
  opensubtitlesApiKey: process.env.OPENSUBTITLES_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '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',
  authToken: process.env.WATCHFLIX_AUTH_TOKEN || '',
  minImdbRating: 6.0,
  sources: {
    movies123: 'https://ww6.123movieshd.com',
    ytsApi: 'https://yts.torrentbay.st/api/v2',
    hdrezka: 'https://hdrezka.ag',
    seazonvar: 'https://seasonvar.org',
    filmix: 'https://filmix.my',
  }
};
