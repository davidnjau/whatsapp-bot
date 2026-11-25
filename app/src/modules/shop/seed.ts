import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { query } from '../../db.js'
import { log } from '../../logger.js'
import { saveMedia } from '../status/media.js'

// The 8 reference dresses — copy taken verbatim from the design handoff. Seeded
// once (idempotent via products.seed_key) so the new shop has rich content with
// model/mannequin/close-up photos and a short video per dress. The owner can
// edit or archive them like any other product.
interface SeedDress {
  n: number
  name: string
  sizes: number[]
  fabric: string
  colour: string
  length: string
  short: string
  long: string[]
  care: string[]
}

const DRESSES: SeedDress[] = [
  {
    n: 1, name: 'Lilac puff-sleeve midi', sizes: [8, 10], fabric: 'Textured crepe',
    colour: 'Lilac', length: 'Midi, below the knee',
    short: 'A soft lilac bodycon with puffed short sleeves, a square neckline and ruching gathered at the waist.',
    long: [
      'The square neckline and gently puffed sleeves give this one a polished, almost vintage line, while the side ruching at the waist does the flattering work for you.',
      'The textured crepe has a light stretch, so it hugs without pulling. It sits just below the knee, which makes it easy to wear to the office, church or a wedding with a simple pair of heels.',
    ],
    care: ['Hand wash cold or gentle machine wash', 'Hang to dry, warm iron on the reverse', 'Pre-loved, cleaned and checked'],
  },
  {
    n: 2, name: 'Plum pleated midi', sizes: [14], fabric: 'Crepe, side buttons',
    colour: 'Plum', length: 'Midi, mid-calf',
    short: 'A long-sleeved plum dress with a high neck, a row of covered side buttons and a fully pleated skirt.',
    long: [
      'A fitted bodice with a neat band collar and a diagonal line of covered buttons, falling into a knife-pleated skirt that moves beautifully as you walk.',
      'The deep plum works year-round. Wear it as it is for church or the office, or add gold jewellery for an evening event.',
    ],
    care: ['Gentle machine wash, inside out', 'Hang to keep the pleats crisp', 'Pre-loved, cleaned and checked'],
  },
  {
    n: 3, name: 'Denim-blue belted swing', sizes: [16], fabric: 'Textured knit + belt',
    colour: 'Denim blue', length: 'Midi, below the knee',
    short: 'A denim-blue swing dress with a wide collar, three statement buttons and a thin black belt included.',
    long: [
      'The open collar and big black buttons give it a classic shirt-dress feel, and the skirt flares out in a full A-line from the belted waist.',
      'The textured knit looks like denim but is softer and has some give, so it is comfortable for a long day. The black belt comes with it.',
    ],
    care: ['Machine wash cold', 'Dry flat or on a hanger', 'Belt included', 'Pre-loved, cleaned and checked'],
  },
  {
    n: 4, name: 'Navy & mustard peplum', sizes: [14], fabric: 'Crepe + belt',
    colour: 'Navy and mustard', length: 'Midi, below the knee',
    short: 'A colour-block wrap-collar dress, navy on one side and mustard on the other, with gold buttons and a flared peplum hem.',
    long: [
      'This is a dress that walks into a room first. The navy front wraps over the mustard side with a sharp lapel, a line of gold buttons and a matching mustard belt with a gold ring buckle.',
      'It is fitted through the hips and flares into a soft mermaid hem, so it feels dressy without being stiff.',
    ],
    care: ['Hand wash cold, colours separately', 'Hang to dry', 'Belt included', 'Pre-loved, cleaned and checked'],
  },
  {
    n: 5, name: 'Fuchsia jacket & black dress', sizes: [12], fabric: 'Two-piece crepe set',
    colour: 'Fuchsia and black', length: 'Knee length',
    short: 'A two-piece set: a cropped fuchsia jacket edged in black over a simple black pencil dress.',
    long: [
      'You get two pieces for one price. The fuchsia jacket is cropped and collarless with neat black piping, and it sits open over a sleeveless black pencil dress.',
      'Wear them together for meetings and events, or split them up: the black dress works on its own, and the jacket lifts jeans or any plain dress.',
    ],
    care: ['Dry clean jacket or hand wash cold', 'Machine wash dress on gentle', 'Two pieces included', 'Pre-loved, cleaned and checked'],
  },
  {
    n: 6, name: 'Wine wrap-collar pencil', sizes: [12], fabric: 'Crepe',
    colour: 'Wine', length: 'Knee length',
    short: 'A deep wine pencil dress with a blazer-style wrap collar, long sleeves and ruching at the waist.',
    long: [
      'Tailored like a blazer on top, with a crossover lapel collar and long sleeves, then a smooth pencil skirt with gathered ruching at one side of the waist.',
      'The rich wine colour is easy to style with nude, black or burgundy heels. A strong pick for interviews and the office.',
    ],
    care: ['Hand wash cold or dry clean', 'Warm iron on the reverse', 'Pre-loved, cleaned and checked'],
  },
  {
    n: 7, name: 'Zebra-print wrap midi', sizes: [10], fabric: 'Stretch jersey',
    colour: 'Black and white print', length: 'Knee length',
    short: 'A black and white zebra-stripe bodycon with a V wrap neckline, short sleeves and a wide waistband.',
    long: [
      'The wavy black and white print does all the talking. A V wrap neckline and a wide ruched waistband shape the body, and a side panel runs the print the other way for a slimming line.',
      'Stretch jersey makes it comfortable and easy to move in. Pair with black heels and gold jewellery.',
    ],
    care: ['Machine wash cold', 'Do not tumble dry', 'Pre-loved, cleaned and checked'],
  },
  {
    n: 8, name: 'Red & black zip midi', sizes: [16], fabric: 'Cotton knit',
    colour: 'Red and black', length: 'Midi, mid-calf',
    short: 'A red zip-front midi with a high collar, three-quarter sleeves and black side panels that shape the waist.',
    long: [
      'A full-length front zip with a funnel collar gives this one a sporty, modern feel, and the curved black side panels draw in the waist.',
      'The soft cotton knit is comfortable all day. Dress it up with heels or keep it easy with white trainers.',
    ],
    care: ['Machine wash cold, inside out', 'Wash with darks the first time', 'Pre-loved, cleaned and checked'],
  },
]

const SEED_DIR = () => process.env.SEED_DIR ?? path.resolve('seed/dressnation')

async function saveSeedFile(rel: string, mimetype: string): Promise<number> {
  const buf = await readFile(path.join(SEED_DIR(), rel))
  const media = await saveMedia(rel, mimetype, buf)
  return media.id
}

// Seed the 8 reference dresses if they aren't present yet. Safe to call every
// boot — each dress is skipped once its seed_key exists.
export async function seedReferenceDresses(): Promise<void> {
  for (const d of DRESSES) {
    const key = `dn-ref-${d.n}`
    const existing = await query('SELECT 1 FROM products WHERE seed_key = $1', [key])
    if (existing.rowCount) continue
    try {
      const model = await saveSeedFile(`d${d.n}-model.jpg`, 'image/jpeg')
      const mannequin = await saveSeedFile(`d${d.n}-mannequin.jpg`, 'image/jpeg')
      const close1 = await saveSeedFile(`d${d.n}-close-1.jpg`, 'image/jpeg')
      const close2 = await saveSeedFile(`d${d.n}-close-2.jpg`, 'image/jpeg')
      const poster = await saveSeedFile(`d${d.n}-poster.jpg`, 'image/jpeg')
      const video = await saveSeedFile(`d${d.n}.mp4`, 'video/mp4')
      const prod = await query<{ id: number }>(
        `INSERT INTO products
           (title, size, price_ksh, media_id, fabric, colour, length_desc, short_desc, long_desc, care,
            status, needs_review, featured, published_at, seed_key)
         VALUES ($1,$2,1000,$3,$4,$5,$6,$7,$8,$9,'published',false,true,now(),$10)
         RETURNING id`,
        [d.name, d.sizes.join('/'), model, d.fabric, d.colour, d.length, d.short,
          d.long.join('\n\n'), d.care.join('\n'), key],
      )
      const pid = prod.rows[0].id
      const gallery: Array<[number, string, number | null]> = [
        [model, 'model', null],
        [mannequin, 'mannequin', null],
        [close1, 'close', null],
        [close2, 'close', null],
        [video, 'video', poster],
      ]
      let pos = 0
      for (const [mediaId, kind, posterId] of gallery) {
        await query(
          `INSERT INTO product_media (product_id, media_id, kind, poster_media_id, position)
           VALUES ($1,$2,$3,$4,$5)`,
          [pid, mediaId, kind, posterId, pos++],
        )
      }
      log.info({ productId: pid, name: d.name }, 'seeded reference dress')
    } catch (err) {
      log.warn({ err: (err as Error).message, dress: d.name }, 'could not seed reference dress')
    }
  }
}
