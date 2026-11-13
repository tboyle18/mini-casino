// Player names are shown to everyone (the leaderboard, the big-wins ticker, the tables), so
// every name goes through cleanName before it's stored or shown. It keeps ordinary names as
// they are, strips links and odd characters, and swaps anything offensive for a neutral name.
//
// Matching works on a squashed copy of the name: lower case, accents dropped, look-alike
// digits and symbols turned back into letters (5h1t, $hit), everything but letters removed,
// and runs of one letter cut to one (fuuuck). Strong words are caught anywhere in that copy;
// short words that hide inside real names (Cassandra, Hancock, Essex, Titus) only on their own.

const ANYWHERE = [
  'fuck', 'fuk', 'fuq', 'phuck', 'phuk', 'fvck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'fagot', 'retard', 'rapist', 'rape',
  'whore', 'slut', 'bitch', 'bastard', 'asshole', 'motherf', 'pussy', 'penis', 'vagina', 'porn', 'dildo', 'blowjob',
  'handjob', 'jizz', 'twat', 'wank', 'bollock', 'nazi', 'hitler', 'kkk', 'tranny', 'wetback', 'beaner',
  'chink', 'gook', 'kike', 'spick', 'raghead', 'towelhead', 'coon', 'pedo', 'paedo', 'molest', 'incest', 'cock',
  'killyourself', 'jihad', 'terrorist',
];
const ALONE = ['ass', 'arse', 'cum', 'tit', 'tits', 'sex', 'anal', 'dyke', 'fag', 'spic', 'paki', 'hoe', 'nig', 'niger', 'jap', 'heil', 'kys', 'nonce'];
// Real names and words the "anywhere" list would otherwise catch
const SAFE = ['hancock', 'peacock', 'woodcock', 'babcock', 'cockburn', 'hitchcock', 'cockerel', 'cocktail', 'scunthorpe', 'skunthorpe',
  'grape', 'drape', 'trapeze', 'nigeria', 'coonan', 'raccoon', 'cocoon', 'tycoon', 'shitake', 'shiitake', 'torpedo', 'speedo',
  'pedometer', 'encyclopedia', 'orthopedic', 'expedition',
  'matsushita', 'yamashita', 'kinoshita', 'morishita', 'miyashita', 'takeshita', 'kishita', 'oshita', 'hashita'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };
const once = s => s.replace(/(.)\1+/g, '$1');   // fuuuck → fuck
const plain = s => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[0134578 9@$!|+]/g, c => LEET[c] || c);
const letters = s => plain(s).replace(/[^a-z]/g, '');
const unsafe = flat => SAFE.reduce((f, ok) => f.split(ok).join('-').split(once(ok)).join('-'), flat);

// True when the name has something we won't show
export function badName(name) {
  const flat = unsafe(letters(name)), flat1 = unsafe(once(letters(name)));
  for (const w of ANYWHERE) {
    if (flat.includes(w)) return true;
    const w1 = once(w);
    if (w1.length >= 4 && flat1.includes(w1)) return true;   // fuuuuck, phuck-style stretching
  }
  const ws = plain(name).split(/[^a-z]+/).filter(Boolean);
  ws.push(letters(name));   // a.s.s, a s s
  return ws.some(w => ALONE.includes(w) || ALONE.includes(once(w)));
}

// The name as it may be shown: letters, digits, spaces and a little punctuation, no links,
// at most `max` characters; offensive or empty names become `fallback`
export function cleanName(name, fallback = 'Player', max = 24) {
  let s = String(name || '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')   // control and invisible characters
    .replace(/\S*(https?:|www\.|\.(com|net|org|io|gg|co|xyz|ly|me|tv|app)\b|@)\S*/gi, ' ')         // links, addresses, handles
    .replace(/[^\p{L}\p{N} .'\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
  if (!/\p{L}/u.test(s) || badName(s) || badName(name)) return fallback;   // the raw name too: b!tch, sh*t
  return s;
}
