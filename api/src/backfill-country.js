import { chromium } from 'playwright';
import db from './db.js';

const PARALLEL_PAGES = 5;
const DELAY_MS = 300;

async function extractCountry(page, imdbId) {
  try {
    await page.goto(`https://www.imdb.com/title/${imdbId}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    const country = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el) return null;
      try {
        const data = JSON.parse(el.textContent);
        const countries = data?.props?.pageProps?.aboveTheFoldData?.countriesOfOrigin?.countries;
        if (!countries?.length) return null;
        return countries.map(c => c.id).join(', ');
      } catch {
        return null;
      }
    });

    if (country) return country;

    // Fallback: DOM extraction
    return await page.evaluate(() => {
      const items = document.querySelectorAll('[data-testid="title-details-section"] li');
      for (const li of items) {
        const label = li.querySelector('.ipc-metadata-list-item__label')?.textContent?.trim();
        if (label?.includes('ountry')) {
          const values = [...li.querySelectorAll('.ipc-metadata-list-item__list-content-item')]
            .map(el => el.textContent.trim());
          return values.length ? values.join(', ') : null;
        }
      }
      return null;
    });
  } catch {
    return null;
  }
}

const COUNTRY_CODES = {
  AF:'Afghanistan',AL:'Albania',DZ:'Algeria',AR:'Argentina',AM:'Armenia',AU:'Australia',
  AT:'Austria',AZ:'Azerbaijan',BH:'Bahrain',BD:'Bangladesh',BY:'Belarus',BE:'Belgium',
  BA:'Bosnia and Herzegovina',BR:'Brazil',BG:'Bulgaria',KH:'Cambodia',CA:'Canada',
  CL:'Chile',CN:'China',CO:'Colombia',HR:'Croatia',CU:'Cuba',CY:'Cyprus',CZ:'Czech Republic',
  DK:'Denmark',DO:'Dominican Republic',EC:'Ecuador',EG:'Egypt',EE:'Estonia',ET:'Ethiopia',
  FI:'Finland',FR:'France',GE:'Georgia',DE:'Germany',GH:'Ghana',GR:'Greece',GT:'Guatemala',
  HK:'Hong Kong',HU:'Hungary',IS:'Iceland',IN:'India',ID:'Indonesia',IR:'Iran',IQ:'Iraq',
  IE:'Ireland',IL:'Israel',IT:'Italy',JM:'Jamaica',JP:'Japan',JO:'Jordan',KZ:'Kazakhstan',
  KE:'Kenya',KP:'North Korea',KR:'South Korea',KW:'Kuwait',LV:'Latvia',LB:'Lebanon',
  LT:'Lithuania',LU:'Luxembourg',MY:'Malaysia',MX:'Mexico',MA:'Morocco',NL:'Netherlands',
  NZ:'New Zealand',NG:'Nigeria',NO:'Norway',PK:'Pakistan',PA:'Panama',PE:'Peru',PH:'Philippines',
  PL:'Poland',PT:'Portugal',QA:'Qatar',RO:'Romania',RU:'Russia',SA:'Saudi Arabia',RS:'Serbia',
  SG:'Singapore',SK:'Slovakia',SI:'Slovenia',ZA:'South Africa',ES:'Spain',LK:'Sri Lanka',
  SE:'Sweden',CH:'Switzerland',SY:'Syria',TW:'Taiwan',TH:'Thailand',TR:'Turkey',TN:'Tunisia',
  UA:'Ukraine',AE:'United Arab Emirates',GB:'United Kingdom',US:'United States',UY:'Uruguay',
  UZ:'Uzbekistan',VE:'Venezuela',VN:'Vietnam',XWW:'Worldwide',
  SUHH:'Soviet Union',CSXX:'Czechoslovakia',YUCS:'Yugoslavia',DDDE:'East Germany',BUMM:'Burma',
};

function expandCodes(raw) {
  return raw.split(',').map(s => {
    const trimmed = s.trim();
    return COUNTRY_CODES[trimmed] || trimmed;
  }).join(', ');
}

async function main() {
  const rows = db.prepare(
    "SELECT DISTINCT imdb_id FROM movies WHERE imdb_id IS NOT NULL AND (country IS NULL OR country = '')"
  ).all();

  console.log(`Backfilling country for ${rows.length} unique IMDB IDs using Playwright...`);

  const browser = await chromium.launch({ headless: false });
  const pages = [];
  for (let i = 0; i < PARALLEL_PAGES; i++) {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    pages.push(await ctx.newPage());
  }

  const updateStmt = db.prepare('UPDATE movies SET country = ? WHERE imdb_id = ?');
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += PARALLEL_PAGES) {
    const batch = rows.slice(i, i + PARALLEL_PAGES);

    const results = await Promise.all(
      batch.map((row, idx) => extractCountry(pages[idx], row.imdb_id))
    );

    for (let j = 0; j < batch.length; j++) {
      const raw = results[j];
      if (raw) {
        const country = expandCodes(raw);
        updateStmt.run(country, batch[j].imdb_id);
        updated++;
      } else {
        failed++;
      }
    }

    const total = i + batch.length;
    if (total % 50 === 0 || total === rows.length) {
      console.log(`  Progress: ${total}/${rows.length} (updated: ${updated}, failed: ${failed})`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  await browser.close();
  console.log(`Done. Updated: ${updated}, Failed/skipped: ${failed}, Total: ${rows.length}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
