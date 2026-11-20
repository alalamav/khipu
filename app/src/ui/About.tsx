import type { ReactNode } from 'react';
import type { ArchiveStats } from '../khipu';
import { Sheet, SheetHead, Stat } from './bits';

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 mb-2 text-lg font-normal text-ink-bright">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="mb-3">{children}</p>;
}

/** A two-column table: what is in the archive, and what the instrument makes of it. */
function Mapping({ rows }: { rows: readonly (readonly [archive: ReactNode, instrument: ReactNode])[] }) {
  return (
    <table className="mb-3 w-full border-collapse text-[13.5px]">
      <thead>
        <tr className="text-left font-mono text-[10px] tracking-[0.08em] text-ink-faint uppercase">
          <th className="pb-1 font-normal">in the archive</th>
          <th className="pb-1 font-normal">in the instrument</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([archive, instrument], i) => (
          <tr key={i} className="border-t border-line align-top">
            <td className="w-[34%] py-1.5 pr-3 font-mono text-xs text-ink-dim">{archive}</td>
            <td className="py-1.5">{instrument}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function B({ children }: { children: ReactNode }) {
  return <span className="text-ink-bright">{children}</span>;
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="text-ink-bright underline decoration-ink-faint underline-offset-4">
      {children}
    </a>
  );
}

/** What the instrument does with the archive, what it imposes on it, and what the archive does not know. */
export function About({ stats, onClose }: { stats: ArchiveStats | null; onClose: () => void }) {
  return (
    <Sheet wide label="About this instrument" onDismiss={onClose}>
      <div>
        <SheetHead title="About this instrument" onClose={onClose} />

        <P>
          The instrument has three voices. Each reads the same row of the database a different way: as measurements, as
          relationships, as numbers. Choose one in the bar at the bottom; under the cord’s row, the ledger shows what that
          voice makes of the cord under your hand.
        </P>

        <Heading>In every voice</Heading>
        <Mapping
          rows={[
            [
              'termination',
              <>
                how the sound ends: <B>knotted</B> rings out; <B>broken</B> tears off with a crack; <B>cut</B> stops clean;{' '}
                <B>ravelled</B> splits into drifting strands; <B>doubled</B> adds the octave below; <B>canutito</B> (wrapped) is
                muted; <B>unfinished</B> holds level and then just ends.
              </>,
            ],
            [
              'cord colour',
              'ring time, which is also how long the cord swings. Pale cotton rings long, dark cords are short. A cord with no recorded colour rings like a mid-brown one.',
            ],
            ['position along the main cord', 'time, when you press Read; left to right in the speakers.'],
            [
              'cords tied to a cord',
              'a touch passes down. Each subsidiary is touched after the cord it hangs from, more softly, and its own after it. The first eight on a cord are heard; all of them are worn.',
            ],
            ['main cord length', 'the low hum underneath.'],
            [
              'an ending that was not recorded',
              'breath, with the cord barely there under it. A cord worn by reading carries breath too, in proportion to its wear.',
            ],
            [
              'a length that was not recorded',
              'no pitch. In the string and operator voices the cord is only breath. In the resonator voice its knots still ring, at moments nothing in the record decides.',
            ],
          ]}
        />

        <Heading>String: the row as measurements</Heading>
        <Mapping
          rows={[
            [
              'cord length, in centimetres',
'pitch. The cord is treated as a string: 6600 ÷ cm gives hertz, so a 30 cm cord sounds 220 Hz. Cords shorter than 4.2 cm or longer than 101.5 cm are moved by octaves into 65 to 1568 Hz: a 2 cm stub sounds 825 Hz, not 3300. No scale is applied; the tuning is whatever the lengths are.',
            ],
            ['cord colour', 'brightness as well as ring time: dark cords are dull.'],
            [
              'knot position along the cord',
'a partial above the cord, at the ratio (cord length ÷ knot position), like a finger resting on a string. It is kept under 4200 Hz by octaves. A knot with no recorded position is only a tick.',
            ],
            [
              'knot type',
              <>
                single knots ping once each. A long knot of <i>n</i> turns is a roll of <i>n</i> grains. A figure-eight knot beats
                against itself.
              </>,
            ],
            [
              'knot direction, S or Z',
              'left or right. Where direction was not recorded the knot sits in the middle and is partly noise.',
            ],
          ]}
        />

        <Heading>Operator: the row as relationships</Heading>
        <P>
          Every cord is a sine-wave operator, as in FM synthesis. The cord you touch is the carrier, at the pitch of its length.
          The cords related to it are not heard in that tone: they bend it. (Its subsidiaries are then touched in their turn, as
          in every voice, and each is for a moment a carrier of its own.)
        </P>
        <Mapping
          rows={[
            [
              'a subsidiary cord',
              'modulates the frequency of the cord it is tied to. Its own subsidiaries modulate it in turn, stacked three deep at most; one touch brings in at most six modulators.',
            ],
            ['the cord before it in its group', 'modulates the touched cord as well, less strongly.'],
            [
              'the values of the two cords',
              'the modulator’s frequency: the proportion between the two numbers, larger over smaller, times the frequency of the cord it bends. A cord of 60 tied to a cord of 20 modulates at three times its frequency. Whole proportions give harmonic tones; others give bells and clangs. Where either cord has no knots left, the proportion of their lengths is used. A modulator that would sound above 6 kHz is lowered by octaves, which halves its proportion each time; the ledger shows both.',
            ],
            [
              'how the number is shared',
              'depth. A subsidiary carrying most of what the pair adds up to bends its parent hard; one carrying nothing, lightly.',
            ],
            [
              'wear',
              'a fraying cord modulates less and a fallen one not at all. As a khipu comes apart its cords lose their relations, until each is a bare sine tone.',
            ],
          ]}
        />
        <P>
          The modulation is deepest at the touch and settles to a quarter of that, so a cord sounds its relations first and
          then, more plainly, itself. The <B>depth</B> slider scales all of it; at zero every cord is a plain sine.
        </P>

        <Heading>Resonator: the row as numbers</Heading>
        <P>
          The cord is struck, and what rings is a bank of resonant filters tuned by the numbers knotted on it. The length of the
          cord plays no part in the pitch.
        </P>
        <Mapping
          rows={[
            [
              'knot value',
              'one resonance for each cluster of knots, tuned like a slide rule: the digits 1 to 9 are spread across an octave by their logarithm, and every power of ten is an octave higher (1 is 110 Hz, 10 is 220 Hz, 100 is 440 Hz). 3, 30 and 300 are one note in three octaves, as the same knots count different amounts by their place on the cord. A cord reading 253 is the chord 200 + 50 + 3. A ravelled or doubled cord rings each number on every strand. One touch rings twelve filters at most, shared out so that every number has one before any has a second.',
            ],
            [
              'knot type and count',
              <>
                single knots strike their resonance once each; a long knot of <i>n</i> turns is a roll of <i>n</i> strikes; a
                figure-eight knot is two resonances beating.
              </>,
            ],
            [
              'knot position along the cord',
              'when it is struck: the cord is read from the top down. A knot that would be struck after a broken, cut or unfinished cord has stopped is not heard.',
            ],
            ['knot direction, S or Z', 'left or right.'],
            ['no knots', 'nothing rings. There is only the dull tap of the strike.'],
          ]}
        />
        <P>
          Equal numbers sound the same wherever they are in the archive. The <B>ring</B> slider sets how long the filters ring.
        </P>

        <Heading>What is imposed</Heading>
        <P>
          The khipus are undeciphered and this instrument does not decode them. Turning position into time, length into pitch, a
          tie between two cords into modulation, and a number into a place on a logarithmic scale are our choices. They
          translate measurements, and a measurement is already somebody’s decision about what counted. Pendant attachment, for
          example, was not treated as a sign until the 1970s, and for <Stat>{stats?.notRecorded.attachment}</Stat> cords the
          archive has no attachment at all. The numbers are a reading too: the database gives every knot a decimal value,
          which is how a khipu is read as an account, and nobody knows that every khipu was one.
        </P>
        <P>
          The wear is ours too. It compresses centuries of handling into minutes so that you can watch the difference between a
          thing and its record: the left column of the ledger never changes, whatever happens to the cord.
        </P>

        <Heading>What the archive does not know</Heading>
        <ul className="list-disc space-y-0.5 pl-[18px]">
          <li>
            <Stat>{stats?.khipusWithoutProvenance}</Stat> of <Stat>{stats?.khipus}</Stat> khipus have no recorded place of origin.
          </li>
          <li>
            <Stat>{stats?.khipusWithoutDate}</Stat> have no recorded date of discovery; <Stat>{stats?.khipusWithoutDiscoverer}</Stat>{' '}
            name no finder.
          </li>
          <li>
            <Stat>{stats?.terminations.B}</Stat> cords are recorded as broken, <Stat>{stats?.terminations.U}</Stat> as
            unfinished, <Stat>{stats?.terminations.R}</Stat> as ravelled.
          </li>
          <li>
            <Stat>{stats?.cordsWithoutKnots}</Stat> cords carry no knots. <Stat>{stats?.knotDirections.notRecorded}</Stat> knots
            have no recorded direction.
          </li>
          <li>
            <Stat>{stats && stats.khipus - (stats.countries.Peru ?? 0) - (stats.countries.notRecorded ?? 0)}</Stat> of the{' '}
            <Stat>{stats?.khipus}</Stat> are held
            outside Peru, <Stat>{stats && (stats.countries.Germany ?? 0)}</Stat> of them in Germany.
          </li>
        </ul>

        <Heading>Sources</Heading>
        <P>
          Data: the <Link href="https://github.com/khipulab/open-khipu-repository">Open Khipu Repository</Link> (khipu.db, MIT
          licence, doi:10.5281/zenodo.18025748), which is the database the{' '}
          <Link href="https://www.khipufieldguide.com/">Khipu Field Guide</Link> is built on. The words describing terminations,
          fibres and knots are quoted from its dictionary tables. The repository describes itself as “one artifact of
          colonialist Archaeology and Anthropology”; this instrument is another translation stacked on top of that one.
        </P>
        <P>Built with React, three.js, Tone.js and Tailwind. There are no samples: every sound is computed from a row.</P>
      </div>
    </Sheet>
  );
}
