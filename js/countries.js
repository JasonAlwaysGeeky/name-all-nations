// The 195 countries: 193 UN members + Vatican City + Palestine.
// `code` matches the path id in map/world.svg (ISO 3166-1 alpha-2).
// `aliases` are additional accepted answers (matching is fuzzy and
// ignores case, accents, and punctuation, so only real alternate
// names belong here — not misspellings).
const COUNTRIES = [
  // ——— Africa (54) ———
  { code: 'DZ', name: 'Algeria', region: 'Africa', aliases: [] },
  { code: 'AO', name: 'Angola', region: 'Africa', aliases: [] },
  { code: 'BJ', name: 'Benin', region: 'Africa', aliases: [] },
  { code: 'BW', name: 'Botswana', region: 'Africa', aliases: [] },
  { code: 'BF', name: 'Burkina Faso', region: 'Africa', aliases: ['Burkina'] },
  { code: 'BI', name: 'Burundi', region: 'Africa', aliases: [] },
  { code: 'CV', name: 'Cape Verde', region: 'Africa', aliases: ['Cabo Verde'] },
  { code: 'CM', name: 'Cameroon', region: 'Africa', aliases: [] },
  { code: 'CF', name: 'Central African Republic', region: 'Africa', aliases: ['CAR'] },
  { code: 'TD', name: 'Chad', region: 'Africa', aliases: [] },
  { code: 'KM', name: 'Comoros', region: 'Africa', aliases: ['The Comoros'] },
  { code: 'CG', name: 'Republic of the Congo', region: 'Africa', aliases: ['Congo', 'Congo-Brazzaville', 'Congo Republic'] },
  { code: 'CD', name: 'Democratic Republic of the Congo', region: 'Africa', aliases: ['DR Congo', 'DRC', 'Congo-Kinshasa', 'Democratic Republic of Congo'] },
  { code: 'CI', name: 'Ivory Coast', region: 'Africa', aliases: ["Cote d'Ivoire", 'Cote dIvoire'] },
  { code: 'DJ', name: 'Djibouti', region: 'Africa', aliases: [] },
  { code: 'EG', name: 'Egypt', region: 'Africa', aliases: [] },
  { code: 'GQ', name: 'Equatorial Guinea', region: 'Africa', aliases: [] },
  { code: 'ER', name: 'Eritrea', region: 'Africa', aliases: [] },
  { code: 'SZ', name: 'Eswatini', region: 'Africa', aliases: ['Swaziland'] },
  { code: 'ET', name: 'Ethiopia', region: 'Africa', aliases: [] },
  { code: 'GA', name: 'Gabon', region: 'Africa', aliases: [] },
  { code: 'GM', name: 'Gambia', region: 'Africa', aliases: ['The Gambia'] },
  { code: 'GH', name: 'Ghana', region: 'Africa', aliases: [] },
  { code: 'GN', name: 'Guinea', region: 'Africa', aliases: [] },
  { code: 'GW', name: 'Guinea-Bissau', region: 'Africa', aliases: [] },
  { code: 'KE', name: 'Kenya', region: 'Africa', aliases: [] },
  { code: 'LS', name: 'Lesotho', region: 'Africa', aliases: [] },
  { code: 'LR', name: 'Liberia', region: 'Africa', aliases: [] },
  { code: 'LY', name: 'Libya', region: 'Africa', aliases: [] },
  { code: 'MG', name: 'Madagascar', region: 'Africa', aliases: [] },
  { code: 'MW', name: 'Malawi', region: 'Africa', aliases: [] },
  { code: 'ML', name: 'Mali', region: 'Africa', aliases: [] },
  { code: 'MR', name: 'Mauritania', region: 'Africa', aliases: [] },
  { code: 'MU', name: 'Mauritius', region: 'Africa', aliases: [] },
  { code: 'MA', name: 'Morocco', region: 'Africa', aliases: [] },
  { code: 'MZ', name: 'Mozambique', region: 'Africa', aliases: [] },
  { code: 'NA', name: 'Namibia', region: 'Africa', aliases: [] },
  { code: 'NE', name: 'Niger', region: 'Africa', aliases: [] },
  { code: 'NG', name: 'Nigeria', region: 'Africa', aliases: [] },
  { code: 'RW', name: 'Rwanda', region: 'Africa', aliases: [] },
  { code: 'ST', name: 'São Tomé and Príncipe', region: 'Africa', aliases: ['Sao Tome', 'Sao Tome and Principe'] },
  { code: 'SN', name: 'Senegal', region: 'Africa', aliases: [] },
  { code: 'SC', name: 'Seychelles', region: 'Africa', aliases: ['The Seychelles'] },
  { code: 'SL', name: 'Sierra Leone', region: 'Africa', aliases: [] },
  { code: 'SO', name: 'Somalia', region: 'Africa', aliases: [] },
  { code: 'ZA', name: 'South Africa', region: 'Africa', aliases: [] },
  { code: 'SS', name: 'South Sudan', region: 'Africa', aliases: [] },
  { code: 'SD', name: 'Sudan', region: 'Africa', aliases: [] },
  { code: 'TZ', name: 'Tanzania', region: 'Africa', aliases: [] },
  { code: 'TG', name: 'Togo', region: 'Africa', aliases: [] },
  { code: 'TN', name: 'Tunisia', region: 'Africa', aliases: [] },
  { code: 'UG', name: 'Uganda', region: 'Africa', aliases: [] },
  { code: 'ZM', name: 'Zambia', region: 'Africa', aliases: [] },
  { code: 'ZW', name: 'Zimbabwe', region: 'Africa', aliases: [] },

  // ——— Asia (48) ———
  { code: 'AF', name: 'Afghanistan', region: 'Asia', aliases: [] },
  { code: 'AM', name: 'Armenia', region: 'Asia', aliases: [] },
  { code: 'AZ', name: 'Azerbaijan', region: 'Asia', aliases: [] },
  { code: 'BH', name: 'Bahrain', region: 'Asia', aliases: [] },
  { code: 'BD', name: 'Bangladesh', region: 'Asia', aliases: [] },
  { code: 'BT', name: 'Bhutan', region: 'Asia', aliases: [] },
  { code: 'BN', name: 'Brunei', region: 'Asia', aliases: ['Brunei Darussalam'] },
  { code: 'KH', name: 'Cambodia', region: 'Asia', aliases: [] },
  { code: 'CN', name: 'China', region: 'Asia', aliases: ["People's Republic of China", 'PRC'] },
  { code: 'CY', name: 'Cyprus', region: 'Asia', aliases: [] },
  { code: 'GE', name: 'Georgia', region: 'Asia', aliases: [] },
  { code: 'IN', name: 'India', region: 'Asia', aliases: [] },
  { code: 'ID', name: 'Indonesia', region: 'Asia', aliases: [] },
  { code: 'IR', name: 'Iran', region: 'Asia', aliases: [] },
  { code: 'IQ', name: 'Iraq', region: 'Asia', aliases: [] },
  { code: 'IL', name: 'Israel', region: 'Asia', aliases: [] },
  { code: 'JP', name: 'Japan', region: 'Asia', aliases: [] },
  { code: 'JO', name: 'Jordan', region: 'Asia', aliases: [] },
  { code: 'KZ', name: 'Kazakhstan', region: 'Asia', aliases: [] },
  { code: 'KW', name: 'Kuwait', region: 'Asia', aliases: [] },
  { code: 'KG', name: 'Kyrgyzstan', region: 'Asia', aliases: [] },
  { code: 'LA', name: 'Laos', region: 'Asia', aliases: ['Lao'] },
  { code: 'LB', name: 'Lebanon', region: 'Asia', aliases: [] },
  { code: 'MY', name: 'Malaysia', region: 'Asia', aliases: [] },
  { code: 'MV', name: 'Maldives', region: 'Asia', aliases: ['The Maldives'] },
  { code: 'MN', name: 'Mongolia', region: 'Asia', aliases: [] },
  { code: 'MM', name: 'Myanmar', region: 'Asia', aliases: ['Burma'] },
  { code: 'NP', name: 'Nepal', region: 'Asia', aliases: [] },
  { code: 'KP', name: 'North Korea', region: 'Asia', aliases: ['DPRK'] },
  { code: 'OM', name: 'Oman', region: 'Asia', aliases: [] },
  { code: 'PK', name: 'Pakistan', region: 'Asia', aliases: [] },
  { code: 'PS', name: 'Palestine', region: 'Asia', aliases: ['State of Palestine'] },
  { code: 'PH', name: 'Philippines', region: 'Asia', aliases: ['The Philippines'] },
  { code: 'QA', name: 'Qatar', region: 'Asia', aliases: [] },
  { code: 'SA', name: 'Saudi Arabia', region: 'Asia', aliases: ['Saudi'] },
  { code: 'SG', name: 'Singapore', region: 'Asia', aliases: [] },
  { code: 'KR', name: 'South Korea', region: 'Asia', aliases: ['Republic of Korea'] },
  { code: 'LK', name: 'Sri Lanka', region: 'Asia', aliases: [] },
  { code: 'SY', name: 'Syria', region: 'Asia', aliases: [] },
  { code: 'TJ', name: 'Tajikistan', region: 'Asia', aliases: [] },
  { code: 'TH', name: 'Thailand', region: 'Asia', aliases: [] },
  { code: 'TL', name: 'East Timor', region: 'Asia', aliases: ['Timor-Leste', 'Timor'] },
  { code: 'TR', name: 'Turkey', region: 'Asia', aliases: ['Turkiye'] },
  { code: 'TM', name: 'Turkmenistan', region: 'Asia', aliases: [] },
  { code: 'AE', name: 'United Arab Emirates', region: 'Asia', aliases: ['UAE', 'Emirates'] },
  { code: 'UZ', name: 'Uzbekistan', region: 'Asia', aliases: [] },
  { code: 'VN', name: 'Vietnam', region: 'Asia', aliases: ['Viet Nam'] },
  { code: 'YE', name: 'Yemen', region: 'Asia', aliases: [] },

  // ——— Europe (44) ———
  { code: 'AL', name: 'Albania', region: 'Europe', aliases: [] },
  { code: 'AD', name: 'Andorra', region: 'Europe', aliases: [] },
  { code: 'AT', name: 'Austria', region: 'Europe', aliases: [] },
  { code: 'BY', name: 'Belarus', region: 'Europe', aliases: [] },
  { code: 'BE', name: 'Belgium', region: 'Europe', aliases: [] },
  { code: 'BA', name: 'Bosnia and Herzegovina', region: 'Europe', aliases: ['Bosnia', 'Bosnia-Herzegovina'] },
  { code: 'BG', name: 'Bulgaria', region: 'Europe', aliases: [] },
  { code: 'HR', name: 'Croatia', region: 'Europe', aliases: [] },
  { code: 'CZ', name: 'Czech Republic', region: 'Europe', aliases: ['Czechia'] },
  { code: 'DK', name: 'Denmark', region: 'Europe', aliases: [] },
  { code: 'EE', name: 'Estonia', region: 'Europe', aliases: [] },
  { code: 'FI', name: 'Finland', region: 'Europe', aliases: [] },
  { code: 'FR', name: 'France', region: 'Europe', aliases: [] },
  { code: 'DE', name: 'Germany', region: 'Europe', aliases: [] },
  { code: 'GR', name: 'Greece', region: 'Europe', aliases: [] },
  { code: 'HU', name: 'Hungary', region: 'Europe', aliases: [] },
  { code: 'IS', name: 'Iceland', region: 'Europe', aliases: [] },
  { code: 'IE', name: 'Ireland', region: 'Europe', aliases: [] },
  { code: 'IT', name: 'Italy', region: 'Europe', aliases: [] },
  { code: 'LV', name: 'Latvia', region: 'Europe', aliases: [] },
  { code: 'LI', name: 'Liechtenstein', region: 'Europe', aliases: [] },
  { code: 'LT', name: 'Lithuania', region: 'Europe', aliases: [] },
  { code: 'LU', name: 'Luxembourg', region: 'Europe', aliases: [] },
  { code: 'MT', name: 'Malta', region: 'Europe', aliases: [] },
  { code: 'MD', name: 'Moldova', region: 'Europe', aliases: [] },
  { code: 'MC', name: 'Monaco', region: 'Europe', aliases: [] },
  { code: 'ME', name: 'Montenegro', region: 'Europe', aliases: [] },
  { code: 'NL', name: 'Netherlands', region: 'Europe', aliases: ['The Netherlands', 'Holland'] },
  { code: 'MK', name: 'North Macedonia', region: 'Europe', aliases: ['Macedonia'] },
  { code: 'NO', name: 'Norway', region: 'Europe', aliases: [] },
  { code: 'PL', name: 'Poland', region: 'Europe', aliases: [] },
  { code: 'PT', name: 'Portugal', region: 'Europe', aliases: [] },
  { code: 'RO', name: 'Romania', region: 'Europe', aliases: [] },
  { code: 'RU', name: 'Russia', region: 'Europe', aliases: ['Russian Federation'] },
  { code: 'SM', name: 'San Marino', region: 'Europe', aliases: [] },
  { code: 'RS', name: 'Serbia', region: 'Europe', aliases: [] },
  { code: 'SK', name: 'Slovakia', region: 'Europe', aliases: [] },
  { code: 'SI', name: 'Slovenia', region: 'Europe', aliases: [] },
  { code: 'ES', name: 'Spain', region: 'Europe', aliases: [] },
  { code: 'SE', name: 'Sweden', region: 'Europe', aliases: [] },
  { code: 'CH', name: 'Switzerland', region: 'Europe', aliases: [] },
  { code: 'UA', name: 'Ukraine', region: 'Europe', aliases: [] },
  { code: 'GB', name: 'United Kingdom', region: 'Europe', aliases: ['UK', 'Great Britain', 'Britain'] },
  { code: 'VA', name: 'Vatican City', region: 'Europe', aliases: ['Vatican', 'Holy See'] },

  // ——— North America (23) ———
  { code: 'AG', name: 'Antigua and Barbuda', region: 'North America', aliases: ['Antigua'] },
  { code: 'BS', name: 'Bahamas', region: 'North America', aliases: ['The Bahamas'] },
  { code: 'BB', name: 'Barbados', region: 'North America', aliases: [] },
  { code: 'BZ', name: 'Belize', region: 'North America', aliases: [] },
  { code: 'CA', name: 'Canada', region: 'North America', aliases: [] },
  { code: 'CR', name: 'Costa Rica', region: 'North America', aliases: [] },
  { code: 'CU', name: 'Cuba', region: 'North America', aliases: [] },
  { code: 'DM', name: 'Dominica', region: 'North America', aliases: [] },
  { code: 'DO', name: 'Dominican Republic', region: 'North America', aliases: [] },
  { code: 'SV', name: 'El Salvador', region: 'North America', aliases: [] },
  { code: 'GD', name: 'Grenada', region: 'North America', aliases: [] },
  { code: 'GT', name: 'Guatemala', region: 'North America', aliases: [] },
  { code: 'HT', name: 'Haiti', region: 'North America', aliases: [] },
  { code: 'HN', name: 'Honduras', region: 'North America', aliases: [] },
  { code: 'JM', name: 'Jamaica', region: 'North America', aliases: [] },
  { code: 'MX', name: 'Mexico', region: 'North America', aliases: [] },
  { code: 'NI', name: 'Nicaragua', region: 'North America', aliases: [] },
  { code: 'PA', name: 'Panama', region: 'North America', aliases: [] },
  { code: 'KN', name: 'Saint Kitts and Nevis', region: 'North America', aliases: ['St Kitts and Nevis', 'Saint Kitts', 'St Kitts'] },
  { code: 'LC', name: 'Saint Lucia', region: 'North America', aliases: ['St Lucia'] },
  { code: 'VC', name: 'Saint Vincent and the Grenadines', region: 'North America', aliases: ['St Vincent and the Grenadines', 'Saint Vincent', 'St Vincent'] },
  { code: 'TT', name: 'Trinidad and Tobago', region: 'North America', aliases: ['Trinidad'] },
  { code: 'US', name: 'United States', region: 'North America', aliases: ['USA', 'US', 'America', 'United States of America'] },

  // ——— South America (12) ———
  { code: 'AR', name: 'Argentina', region: 'South America', aliases: [] },
  { code: 'BO', name: 'Bolivia', region: 'South America', aliases: [] },
  { code: 'BR', name: 'Brazil', region: 'South America', aliases: [] },
  { code: 'CL', name: 'Chile', region: 'South America', aliases: [] },
  { code: 'CO', name: 'Colombia', region: 'South America', aliases: [] },
  { code: 'EC', name: 'Ecuador', region: 'South America', aliases: [] },
  { code: 'GY', name: 'Guyana', region: 'South America', aliases: [] },
  { code: 'PY', name: 'Paraguay', region: 'South America', aliases: [] },
  { code: 'PE', name: 'Peru', region: 'South America', aliases: [] },
  { code: 'SR', name: 'Suriname', region: 'South America', aliases: [] },
  { code: 'UY', name: 'Uruguay', region: 'South America', aliases: [] },
  { code: 'VE', name: 'Venezuela', region: 'South America', aliases: [] },

  // ——— Oceania (14) ———
  { code: 'AU', name: 'Australia', region: 'Oceania', aliases: [] },
  { code: 'FJ', name: 'Fiji', region: 'Oceania', aliases: [] },
  { code: 'KI', name: 'Kiribati', region: 'Oceania', aliases: [] },
  { code: 'MH', name: 'Marshall Islands', region: 'Oceania', aliases: ['The Marshall Islands'] },
  { code: 'FM', name: 'Micronesia', region: 'Oceania', aliases: ['Federated States of Micronesia'] },
  { code: 'NR', name: 'Nauru', region: 'Oceania', aliases: [] },
  { code: 'NZ', name: 'New Zealand', region: 'Oceania', aliases: [] },
  { code: 'PW', name: 'Palau', region: 'Oceania', aliases: [] },
  { code: 'PG', name: 'Papua New Guinea', region: 'Oceania', aliases: ['PNG'] },
  { code: 'WS', name: 'Samoa', region: 'Oceania', aliases: [] },
  { code: 'SB', name: 'Solomon Islands', region: 'Oceania', aliases: ['The Solomon Islands', 'Solomons'] },
  { code: 'TO', name: 'Tonga', region: 'Oceania', aliases: [] },
  { code: 'TV', name: 'Tuvalu', region: 'Oceania', aliases: [] },
  { code: 'VU', name: 'Vanuatu', region: 'Oceania', aliases: [] },
];

// Bite-size quiz levels. Every country appears in exactly one subregion,
// and subregions roll up into their continent ("region") for badges.
const SUBREGIONS = [
  // Africa
  { name: 'North Africa', region: 'Africa', codes: ['DZ', 'EG', 'LY', 'MA', 'TN', 'SD'] },
  { name: 'West Africa', region: 'Africa', codes: ['BJ', 'BF', 'CV', 'CI', 'GM', 'GH', 'GN', 'GW', 'LR', 'ML', 'MR', 'NE', 'NG', 'SN', 'SL', 'TG'] },
  { name: 'Central Africa', region: 'Africa', codes: ['AO', 'CM', 'CF', 'TD', 'CG', 'CD', 'GQ', 'GA', 'ST'] },
  { name: 'East Africa & the Horn', region: 'Africa', codes: ['BI', 'DJ', 'ER', 'ET', 'KE', 'RW', 'SO', 'SS', 'TZ', 'UG'] },
  { name: 'Southern Africa & Islands', region: 'Africa', codes: ['BW', 'KM', 'LS', 'MG', 'MW', 'MU', 'MZ', 'NA', 'SC', 'SZ', 'ZA', 'ZM', 'ZW'] },
  // Asia
  { name: 'Middle East', region: 'Asia', codes: ['BH', 'CY', 'IQ', 'IR', 'IL', 'JO', 'KW', 'LB', 'OM', 'PS', 'QA', 'SA', 'SY', 'TR', 'AE', 'YE'] },
  { name: 'Caucasus & Central Asia', region: 'Asia', codes: ['AM', 'AZ', 'GE', 'KZ', 'KG', 'TJ', 'TM', 'UZ'] },
  { name: 'South Asia', region: 'Asia', codes: ['AF', 'BD', 'BT', 'IN', 'MV', 'NP', 'PK', 'LK'] },
  { name: 'East Asia', region: 'Asia', codes: ['CN', 'JP', 'MN', 'KP', 'KR'] },
  { name: 'Southeast Asia', region: 'Asia', codes: ['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'TL', 'VN'] },
  // Europe
  { name: 'Northern Europe', region: 'Europe', codes: ['DK', 'EE', 'FI', 'IS', 'IE', 'LV', 'LT', 'NO', 'SE', 'GB'] },
  { name: 'Western Europe', region: 'Europe', codes: ['AT', 'BE', 'FR', 'DE', 'LI', 'LU', 'MC', 'NL', 'CH'] },
  { name: 'Southern Europe', region: 'Europe', codes: ['AD', 'ES', 'GR', 'IT', 'MT', 'PT', 'SM', 'VA'] },
  { name: 'The Balkans', region: 'Europe', codes: ['AL', 'BA', 'BG', 'HR', 'ME', 'MK', 'RO', 'RS', 'SI'] },
  { name: 'Eastern Europe', region: 'Europe', codes: ['BY', 'CZ', 'HU', 'MD', 'PL', 'RU', 'SK', 'UA'] },
  // North America
  { name: 'USA, Canada & Mexico', region: 'North America', codes: ['CA', 'US', 'MX'] },
  { name: 'Central America', region: 'North America', codes: ['BZ', 'CR', 'SV', 'GT', 'HN', 'NI', 'PA'] },
  { name: 'Caribbean', region: 'North America', codes: ['AG', 'BS', 'BB', 'CU', 'DM', 'DO', 'GD', 'HT', 'JM', 'KN', 'LC', 'VC', 'TT'] },
  // South America
  { name: 'South America', region: 'South America', codes: ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'GY', 'PY', 'PE', 'SR', 'UY', 'VE'] },
  // Oceania
  { name: 'Australia & Melanesia', region: 'Oceania', codes: ['AU', 'FJ', 'NZ', 'PG', 'SB', 'VU'] },
  { name: 'Micronesia & Polynesia', region: 'Oceania', codes: ['FM', 'KI', 'MH', 'NR', 'PW', 'TO', 'TV', 'WS'] },
];

// Non-country regions that appear on the map. Clicking one shows its
// name but it never counts toward the 195.
const TERRITORIES = {
  AI: 'Anguilla (British territory)',
  AQ: 'Antarctica',
  AS: 'American Samoa (US territory)',
  AW: 'Aruba (Dutch territory)',
  AX: 'Åland Islands (Finnish territory)',
  BL: 'Saint Barthélemy (French territory)',
  BM: 'Bermuda (British territory)',
  BQ: 'Caribbean Netherlands (Dutch territory)',
  BV: 'Bouvet Island (Norwegian territory)',
  CC: 'Cocos Islands (Australian territory)',
  CK: 'Cook Islands (associated with New Zealand)',
  CW: 'Curaçao (Dutch territory)',
  CX: 'Christmas Island (Australian territory)',
  EH: 'Western Sahara (disputed territory)',
  FK: 'Falkland Islands (British territory)',
  FO: 'Faroe Islands (Danish territory)',
  GF: 'French Guiana (French territory)',
  GG: 'Guernsey (British Crown dependency)',
  GI: 'Gibraltar (British territory)',
  GL: 'Greenland (Danish territory)',
  GO: 'Glorioso Islands (French territory)',
  GP: 'Guadeloupe (French territory)',
  GS: 'South Georgia (British territory)',
  GU: 'Guam (US territory)',
  HK: 'Hong Kong (Chinese special administrative region)',
  HM: 'Heard Island (Australian territory)',
  IM: 'Isle of Man (British Crown dependency)',
  IO: 'British Indian Ocean Territory',
  JE: 'Jersey (British Crown dependency)',
  JU: 'Juan de Nova Island (French territory)',
  KY: 'Cayman Islands (British territory)',
  MF: 'Saint Martin (French territory)',
  MO: 'Macau (Chinese special administrative region)',
  MP: 'Northern Mariana Islands (US territory)',
  MQ: 'Martinique (French territory)',
  MS: 'Montserrat (British territory)',
  NC: 'New Caledonia (French territory)',
  NF: 'Norfolk Island (Australian territory)',
  NU: 'Niue (associated with New Zealand)',
  PF: 'French Polynesia (French territory)',
  PM: 'Saint Pierre and Miquelon (French territory)',
  PN: 'Pitcairn Islands (British territory)',
  PR: 'Puerto Rico (US territory)',
  RE: 'Réunion (French territory)',
  SH: 'Saint Helena (British territory)',
  SJ: 'Svalbard (Norwegian territory)',
  SX: 'Sint Maarten (Dutch territory)',
  TC: 'Turks and Caicos (British territory)',
  TF: 'French Southern Territories',
  TK: 'Tokelau (New Zealand territory)',
  TW: 'Taiwan (not a UN member — not counted in the 195)',
  VG: 'British Virgin Islands (British territory)',
  VI: 'US Virgin Islands (US territory)',
  WF: 'Wallis and Futuna (French territory)',
  XK: 'Kosovo (partially recognized — not counted in the 195)',
  YT: 'Mayotte (French territory)',
};

// Seterra-style buttons for countries too small to click. Values are the
// button's screen offset from the country (px, +y is south) — a fixed
// pixel offset so the button sits just off the coast at any zoom, with a
// pointer back to the shape. Zero means the button sits on the country.
// Laid out so no two buttons collide, and no button covers another
// small country's centre, on anything from a 1280px-wide window to a
// 1920px one (and as you zoom further in — an offset must never point
// straight at a neighbour, or the button slides onto it as the map
// grows). Should two ever overlap, they merge into one numbered button
// that zooms in.
const BUTTON_OFFSETS = {
  // Europe & the Levant. Vatican/San Marino/Monaco sit on their countries
  // and merge into one numbered button until you zoom to Europe — there
  // is no free 26px spot around Italy at world zoom that isn't some other
  // small country's centre. Montenegro / North Macedonia (see
  // BUTTON_MIN_SCALE) only get theirs once you're in on the Balkans.
  VA: [0, 0], SM: [0, 0], MC: [0, 0], AD: [-6, 34], LI: [0, -30], LU: [-30, 14], MT: [12, 22],
  ME: [0, 0], MK: [0, 0], CY: [-14, 2], LB: [0, -28], IL: [-26, 40], PS: [-54, 34],
  // Gulf
  KW: [-22, 12], BH: [10, -22], QA: [40, -12],
  // Caribbean & Central America (the Bahamas' dotted outline is its
  // button). The Lesser Antilles never render individual buttons — their
  // zone folds them into one numbered button right up to the zoom where
  // the dotted outlines take over — but an entry here is what makes a
  // country count as a zone member, so these stay.
  KN: [66, 0], AG: [66, 0], DM: [60, 20], LC: [60, 20], VC: [58, 51], BB: [58, 51], GD: [71, 80], TT: [71, 80],
  JM: [0, 0], BZ: [0, -22], SV: [-22, 14],
  // Africa
  CV: [-4, -30], GM: [-22, 28], GW: [-40, 48], SL: [3, 27], TG: [-4, 26], GQ: [-23, 36], ST: [-48, 36],
  DJ: [30, 6], RW: [-22, -14], BI: [-14, 20], SZ: [22, 0], LS: [16, 16], KM: [0, 0], MU: [0, 0], SC: [0, 0],
  // Asia
  MV: [0, 0], BT: [28, -30], SG: [0, 0], BN: [0, 0], TL: [0, 0],
  // Pacific
  PW: [0, 0], FM: [0, 0], MH: [0, -26], NR: [0, -10], KI: [18, -24], TV: [0, 0], SB: [0, 0], VU: [0, 0],
  FJ: [0, 12], WS: [2, -26], TO: [14, 14],
};

// Buttons that only fit once you're zoomed in this far (px per map
// unit): the Balkan and Alpine micro-states are boxed in by other small
// countries' centres at world zoom, where their neighbours aren't
// clickable either.
const BUTTON_MIN_SCALE = { LI: 2.2, ME: 5, MK: 5 };

// Buttons that stay past the usual big-enough-to-click cutoff, up to
// this zoom (px per map unit) — the West African slivers stay awkward
// targets well into their zone's own layer (the Gambia above all).
const BUTTON_KEEP = { GM: 20, GW: 10, TG: 10, GQ: 10 };

// Zoom layers: below `minScale` a dense area's buttons collapse into one
// numbered button at `at` (map units) that zooms to the layer where the
// individual buttons are clickable. The keyed ones are also hotkeys.
// The dense areas. Each is reached by tapping its parent area's hotkey
// a second time (1 2 3 / Q W E lay the world out on the keyboard), or
// by clicking its numbered button on the map.
// `squareScale`: past this zoom the zone's island nations drop their
// buttons entirely — the dotted island outlines (grown to a comfortable
// click size) are the targets instead.
// The minScales are also picked so no two member buttons ever sit close
// enough to auto-merge into a numbered pair — a look that's been retired
// from the standard views.
const BUTTON_ZONES = [
  // minScale equals squareScale on purpose: the arc goes straight from
  // one numbered zone button to the dotted squares, with no in-between
  // layer of individual buttons.
  { name: 'Caribbean', at: [299, 422], minScale: 8, squareScale: 8, codes: ['AG', 'KN', 'DM', 'LC', 'BB', 'VC', 'GD', 'TT', 'JM'] },
  { name: 'West African coast', at: [450, 470], minScale: 3.0, codes: ['CV', 'GM', 'GW', 'SL', 'TG', 'GQ', 'ST'] },
  // pad/clear: this dive runs Luxembourg to Malta top-to-bottom, so it
  // frames looser and keeps Malta well above the quiz card's spot.
  // minScale sits where Vatican and San Marino's buttons (7.7 map units
  // apart, both offset [0,0]) no longer merge.
  { name: 'European microstates', at: [504, 332], minScale: 4.5, pad: 1.15, clear: 200, codes: ['VA', 'SM', 'MC', 'MT', 'AD', 'LU', 'LI'] },
  // Folded through the Asia view — below 6, Israel and Palestine's
  // buttons sat close enough to merge.
  { name: 'Middle East', at: [596, 390], minScale: 6, codes: ['CY', 'LB', 'IL', 'PS', 'KW', 'BH', 'QA', 'AE'] },
  { name: 'Oceania', at: [949, 479], minScale: 2.6, squareScale: 2.8, codes: ['AU', 'NZ', 'PG', 'PW', 'FM', 'MH', 'NR', 'KI', 'TV', 'SB', 'VU', 'FJ', 'WS', 'TO'] },
];
