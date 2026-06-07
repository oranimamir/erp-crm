// Resolve a freeform "destination" string to the country it's in.
//
// Order's `destination` is freeform — sometimes it's already a country,
// sometimes it's a port/city in some country (e.g. "Puerto Quetzal" → Guatemala),
// sometimes it's both ("Puerto Quetzal, Guatemala").
//
// We try, in order:
//   1. Last comma-separated chunk (often the country)
//   2. The whole string against a known-port table
//   3. The last chunk against the known-port table
// If nothing matches we return the last chunk as-is — the user can override
// the country inline in the operations table.

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[.\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Curated list of common shipping ports/cities → country.
// Keys are normalized (lowercase, accent-stripped). Add entries as needed.
const PORT_TO_COUNTRY: Record<string, string> = {
  // Central America
  'puerto quetzal': 'Guatemala',
  'puerto barrios': 'Guatemala',
  'santo tomas de castilla': 'Guatemala',
  'puerto cortes': 'Honduras',
  'puerto castilla': 'Honduras',
  'puerto moin': 'Costa Rica',
  'moin': 'Costa Rica',
  'puerto limon': 'Costa Rica',
  'puerto caldera': 'Costa Rica',
  'puerto cabello': 'Venezuela',
  'la guaira': 'Venezuela',
  'puerto manzanillo': 'Panama',
  'manzanillo international terminal': 'Panama',
  'colon': 'Panama',
  'balboa': 'Panama',
  'cristobal': 'Panama',
  'corinto': 'Nicaragua',
  'acajutla': 'El Salvador',

  // Mexico
  'veracruz': 'Mexico',
  'manzanillo': 'Mexico',
  'lazaro cardenas': 'Mexico',
  'altamira': 'Mexico',
  'ensenada': 'Mexico',
  'progreso': 'Mexico',
  'tampico': 'Mexico',

  // Caribbean
  'kingston': 'Jamaica',
  'point lisas': 'Trinidad and Tobago',
  'port of spain': 'Trinidad and Tobago',
  'caucedo': 'Dominican Republic',
  'rio haina': 'Dominican Republic',
  'havana': 'Cuba',

  // South America
  'buenos aires': 'Argentina',
  'rosario': 'Argentina',
  'montevideo': 'Uruguay',
  'santos': 'Brazil',
  'paranagua': 'Brazil',
  'itajai': 'Brazil',
  'rio grande': 'Brazil',
  'rio de janeiro': 'Brazil',
  'manaus': 'Brazil',
  'salvador': 'Brazil',
  'recife': 'Brazil',
  'fortaleza': 'Brazil',
  'callao': 'Peru',
  'paita': 'Peru',
  'guayaquil': 'Ecuador',
  'cartagena': 'Colombia',
  'barranquilla': 'Colombia',
  'buenaventura': 'Colombia',
  'santa marta': 'Colombia',
  'valparaiso': 'Chile',
  'san antonio': 'Chile',
  'iquique': 'Chile',

  // North America
  'long beach': 'United States',
  'los angeles': 'United States',
  'oakland': 'United States',
  'seattle': 'United States',
  'tacoma': 'United States',
  'houston': 'United States',
  'new orleans': 'United States',
  'miami': 'United States',
  'jacksonville': 'United States',
  'savannah': 'United States',
  'charleston': 'United States',
  'norfolk': 'United States',
  'new york': 'United States',
  'newark': 'United States',
  'baltimore': 'United States',
  'boston': 'United States',
  'philadelphia': 'United States',
  'vancouver': 'Canada',
  'prince rupert': 'Canada',
  'montreal': 'Canada',
  'halifax': 'Canada',
  'toronto': 'Canada',

  // Europe
  'rotterdam': 'Netherlands',
  'port of rotterdam': 'Netherlands',
  'amsterdam': 'Netherlands',
  'antwerp': 'Belgium',
  'antwerpen': 'Belgium',
  'zeebrugge': 'Belgium',
  'hamburg': 'Germany',
  'bremerhaven': 'Germany',
  'bremen': 'Germany',
  'wilhelmshaven': 'Germany',
  'le havre': 'France',
  'marseille': 'France',
  'fos sur mer': 'France',
  'dunkerque': 'France',
  'barcelona': 'Spain',
  'valencia': 'Spain',
  'algeciras': 'Spain',
  'bilbao': 'Spain',
  'sines': 'Portugal',
  'leixoes': 'Portugal',
  'lisboa': 'Portugal',
  'lisbon': 'Portugal',
  'genoa': 'Italy',
  'genova': 'Italy',
  'la spezia': 'Italy',
  'gioia tauro': 'Italy',
  'livorno': 'Italy',
  'naples': 'Italy',
  'napoli': 'Italy',
  'salerno': 'Italy',
  'trieste': 'Italy',
  'venice': 'Italy',
  'venezia': 'Italy',
  'piraeus': 'Greece',
  'thessaloniki': 'Greece',
  'felixstowe': 'United Kingdom',
  'southampton': 'United Kingdom',
  'london gateway': 'United Kingdom',
  'liverpool': 'United Kingdom',
  'tilbury': 'United Kingdom',
  'dublin': 'Ireland',
  'cork': 'Ireland',
  'gdansk': 'Poland',
  'gdynia': 'Poland',
  'gothenburg': 'Sweden',
  'goteborg': 'Sweden',
  'aarhus': 'Denmark',
  'copenhagen': 'Denmark',
  'oslo': 'Norway',
  'helsinki': 'Finland',
  'tallinn': 'Estonia',
  'riga': 'Latvia',
  'klaipeda': 'Lithuania',
  'st petersburg': 'Russia',
  'novorossiysk': 'Russia',
  'constanta': 'Romania',
  'varna': 'Bulgaria',
  'koper': 'Slovenia',
  'rijeka': 'Croatia',

  // Middle East / Africa
  'istanbul': 'Turkey',
  'ambarli': 'Turkey',
  'mersin': 'Turkey',
  'izmir': 'Turkey',
  'iskenderun': 'Turkey',
  'haifa': 'Israel',
  'ashdod': 'Israel',
  'beirut': 'Lebanon',
  'lattakia': 'Syria',
  'aqaba': 'Jordan',
  'alexandria': 'Egypt',
  'port said': 'Egypt',
  'damietta': 'Egypt',
  'sokhna': 'Egypt',
  'jeddah': 'Saudi Arabia',
  'dammam': 'Saudi Arabia',
  'dubai': 'United Arab Emirates',
  'jebel ali': 'United Arab Emirates',
  'abu dhabi': 'United Arab Emirates',
  'sharjah': 'United Arab Emirates',
  'doha': 'Qatar',
  'salalah': 'Oman',
  'sohar': 'Oman',
  'casablanca': 'Morocco',
  'tangier': 'Morocco',
  'tanger med': 'Morocco',
  'tunis': 'Tunisia',
  'algiers': 'Algeria',
  'lagos': 'Nigeria',
  'apapa': 'Nigeria',
  'tema': 'Ghana',
  'abidjan': "Côte d'Ivoire",
  'dakar': 'Senegal',
  'mombasa': 'Kenya',
  'dar es salaam': 'Tanzania',
  'durban': 'South Africa',
  'cape town': 'South Africa',
  'port elizabeth': 'South Africa',

  // Asia / Pacific
  'mumbai': 'India',
  'nhava sheva': 'India',
  'jnpt': 'India',
  'chennai': 'India',
  'kolkata': 'India',
  'cochin': 'India',
  'kochi': 'India',
  'mundra': 'India',
  'pipavav': 'India',
  'karachi': 'Pakistan',
  'port qasim': 'Pakistan',
  'colombo': 'Sri Lanka',
  'chittagong': 'Bangladesh',
  'chattogram': 'Bangladesh',
  'yangon': 'Myanmar',
  'bangkok': 'Thailand',
  'laem chabang': 'Thailand',
  'ho chi minh': 'Vietnam',
  'saigon': 'Vietnam',
  'cat lai': 'Vietnam',
  'cai mep': 'Vietnam',
  'hai phong': 'Vietnam',
  'singapore': 'Singapore',
  'port klang': 'Malaysia',
  'tanjung pelepas': 'Malaysia',
  'penang': 'Malaysia',
  'jakarta': 'Indonesia',
  'tanjung priok': 'Indonesia',
  'surabaya': 'Indonesia',
  'manila': 'Philippines',
  'cebu': 'Philippines',
  'hong kong': 'Hong Kong',
  'shanghai': 'China',
  'ningbo': 'China',
  'ningbo zhoushan': 'China',
  'shenzhen': 'China',
  'yantian': 'China',
  'guangzhou': 'China',
  'qingdao': 'China',
  'tianjin': 'China',
  'xiamen': 'China',
  'dalian': 'China',
  'kaohsiung': 'Taiwan',
  'taipei': 'Taiwan',
  'keelung': 'Taiwan',
  'busan': 'South Korea',
  'incheon': 'South Korea',
  'tokyo': 'Japan',
  'yokohama': 'Japan',
  'osaka': 'Japan',
  'kobe': 'Japan',
  'nagoya': 'Japan',
  'sydney': 'Australia',
  'melbourne': 'Australia',
  'brisbane': 'Australia',
  'fremantle': 'Australia',
  'auckland': 'New Zealand',
  'tauranga': 'New Zealand',
};

// Common prefixes that are descriptive (not part of the place name)
const PREFIX_PATTERNS = [
  /^port of /,
  /^puerto de /,
  /^puerto del /,
  /^port /,
  /^puerto /,
];

function stripPrefixes(s: string): string {
  let out = s;
  for (const re of PREFIX_PATTERNS) {
    if (re.test(out)) { out = out.replace(re, ''); break; }
  }
  return out;
}

export function resolveCountry(destination: string | null | undefined): string {
  if (!destination) return '';
  const parts = destination.split(',').map(p => p.trim()).filter(Boolean);
  const lastChunk = parts[parts.length - 1] || '';

  // Try lookups in order of specificity. If any matches, return the mapped country.
  const candidates = [
    normalize(destination),
    normalize(lastChunk),
    stripPrefixes(normalize(destination)),
    stripPrefixes(normalize(lastChunk)),
  ];
  for (const k of candidates) {
    if (k && PORT_TO_COUNTRY[k]) return PORT_TO_COUNTRY[k];
  }
  // No port match — return the last chunk as-is (could already be a country
  // like "Netherlands", or an unknown port the user will fix manually).
  return lastChunk;
}
