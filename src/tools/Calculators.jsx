import { useEffect, useId, useRef } from 'react'
import { Minus, Plus, Trash } from '@phosphor-icons/react'
import {
  GRADES,
  addToDay,
  age,
  dateDiff,
  discountTax,
  gpa,
  localDay,
  parseDay,
  percentChange,
  percentOf,
  tipSplit,
  toISO,
  weekday,
  whatPercent,
} from '../lib/calc.js'
import { formatNumber, parseNumber } from '../lib/units.js'
import { useStoredState } from '../lib/text-hooks.js'
import './Calculators.css'

const TABS = [
  ['percent', 'Percentage'],
  ['age', 'Age'],
  ['dates', 'Date difference'],
  ['tip', 'Tip & split'],
  ['discount', 'Discount & tax'],
  ['gpa', 'GPA'],
]

const DAY = 86400000
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
const shortDate = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = new Intl.NumberFormat()

const fmtMoney = (x) => (Number.isFinite(x) ? money.format(x) : '–')
const fmtNum = (x) => (Number.isFinite(x) ? formatNumber(x) : '–')
const fmtPct = (x) => (Number.isFinite(x) ? `${formatNumber(Math.round(x * 1e4) / 1e4)}%` : '–')
const plural = (n, word) => `${int.format(n)} ${word}${Math.abs(n) === 1 ? '' : 's'}`
const today = () => toISO(localDay())
const num = (s) => parseNumber(s)

/* Small building blocks */

function Field({ label, value, onChange, prefix, suffix, wide, placeholder, inline }) {
  const id = useId()
  return (
    <div className={`calc-field${wide ? ' wide' : ''}${inline ? ' inline' : ''}`}>
      {label && (
        <label className={inline ? 'sr-only' : 'field-label'} htmlFor={id}>
          {label}
        </label>
      )}
      <div className="calc-input-wrap">
        {prefix && <span className="calc-affix pre">{prefix}</span>}
        <input
          id={id}
          className={`calc-input${prefix ? ' has-pre' : ''}${suffix ? ' has-suf' : ''}`}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={value.trim() !== '' && Number.isNaN(num(value)) ? true : undefined}
        />
        {suffix && <span className="calc-affix suf">{suffix}</span>}
      </div>
    </div>
  )
}

function DateField({ label, value, onChange }) {
  const id = useId()
  return (
    <div className="calc-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="date" className="calc-input calc-date" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function Result({ label, value, explain, children }) {
  return (
    <div className="calc-result" aria-live="polite">
      {label && <div className="calc-result-label">{label}</div>}
      <div className="calc-result-value">{value}</div>
      {explain && <p className="calc-explain">{explain}</p>}
      {children}
    </div>
  )
}

function Tiles({ items }) {
  return (
    <dl className="calc-tiles">
      {items.map(([label, value, hint]) => (
        <div key={label} className="calc-tile">
          <dt>{label}</dt>
          <dd>{value}</dd>
          {hint && <span className="calc-tile-hint">{hint}</span>}
        </div>
      ))}
    </dl>
  )
}

function Segmented({ label, options, value, onChange }) {
  return (
    <div className="segmented calc-seg" role="radiogroup" aria-label={label}>
      {options.map(([k, text]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          {text}
        </button>
      ))}
    </div>
  )
}

/* Percentage */

function Percent() {
  const [v, setV] = useStoredState('handybits:calc:percent', { a1: '15', b1: '80', a2: '12', b2: '80', a3: '80', b3: '100' })
  const set = (k) => (x) => setV({ ...v, [k]: x })
  const r1 = percentOf(num(v.a1), num(v.b1))
  const r2 = whatPercent(num(v.a2), num(v.b2))
  const r3 = percentChange(num(v.a3), num(v.b3))
  return (
    <div className="calc-stack">
      <div className="panel calc-pct">
        <div className="calc-sentence">
          <span>What is</span>
          <Field inline label="Percent" value={v.a1} onChange={set('a1')} suffix="%" />
          <span>of</span>
          <Field inline label="Number" value={v.b1} onChange={set('b1')} />
          <span>?</span>
        </div>
        <Result value={fmtNum(r1)} explain={Number.isFinite(r1) ? `${fmtNum(num(v.a1))} ÷ 100 × ${fmtNum(num(v.b1))}` : 'Enter two numbers'} />
      </div>
      <div className="panel calc-pct">
        <div className="calc-sentence">
          <Field inline label="Part" value={v.a2} onChange={set('a2')} />
          <span>is what percent of</span>
          <Field inline label="Whole" value={v.b2} onChange={set('b2')} />
          <span>?</span>
        </div>
        <Result
          value={fmtPct(r2)}
          explain={Number.isFinite(r2) ? `${fmtNum(num(v.a2))} ÷ ${fmtNum(num(v.b2))} × 100` : num(v.b2) === 0 ? 'The whole can’t be zero' : 'Enter two numbers'}
        />
      </div>
      <div className="panel calc-pct">
        <div className="calc-sentence">
          <span>Change from</span>
          <Field inline label="From" value={v.a3} onChange={set('a3')} />
          <span>to</span>
          <Field inline label="To" value={v.b3} onChange={set('b3')} />
        </div>
        <Result
          value={Number.isFinite(r3) ? `${r3 > 0 ? '+' : ''}${fmtPct(r3)}` : '–'}
          explain={
            Number.isFinite(r3)
              ? `${r3 > 0 ? 'An increase' : r3 < 0 ? 'A decrease' : 'No change'}: (${fmtNum(num(v.b3))} − ${fmtNum(num(v.a3))}) ÷ ${fmtNum(Math.abs(num(v.a3)))} × 100`
              : num(v.a3) === 0
                ? 'A change from zero has no percentage'
                : 'Enter two numbers'
          }
        />
      </div>
    </div>
  )
}

/* Age */

function Age() {
  const [v, setV] = useStoredState('handybits:calc:age', { birth: '1995-06-15', on: '' })
  const onDate = v.on || today()
  const b = parseDay(v.birth)
  const t = parseDay(onDate)
  const r = Number.isFinite(b) && Number.isFinite(t) ? age(b, t) : null
  return (
    <div className="panel">
      <div className="calc-grid">
        <DateField label="Date of birth" value={v.birth} onChange={(x) => setV({ ...v, birth: x })} />
        <DateField label="Age on" value={onDate} onChange={(x) => setV({ ...v, on: x === today() ? '' : x })} />
      </div>
      {r ? (
        <>
          <Result
            label="Age"
            value={
              <>
                {r.years} <small>{r.years === 1 ? 'year' : 'years'}</small> {r.months} <small>{r.months === 1 ? 'month' : 'months'}</small> {r.days}{' '}
                <small>{r.days === 1 ? 'day' : 'days'}</small>
              </>
            }
            explain={`From ${shortDate.format(b * DAY)} to ${shortDate.format(t * DAY)}, counting whole years, then whole months, then the days left over.`}
          />
          <Tiles
            items={[
              ['Total days', int.format(r.totalDays)],
              ['Total weeks', int.format(r.totalWeeks), r.totalDays % 7 ? `and ${plural(r.totalDays % 7, 'day')}` : null],
              ['Total months', int.format(r.years * 12 + r.months)],
              [
                'Next birthday',
                r.daysToBirthday === 0 ? 'Today' : plural(r.daysToBirthday, 'day'),
                `${WEEKDAYS[weekday(r.nextBirthday)]}, ${shortDate.format(r.nextBirthday * DAY)} · turns ${r.turning}`,
              ],
            ]}
          />
        </>
      ) : (
        <p className="calc-empty">{Number.isFinite(b) && Number.isFinite(t) ? 'The birth date is after the other date.' : 'Pick a date of birth.'}</p>
      )}
    </div>
  )
}

/* Date difference and date arithmetic */

function Dates() {
  const [v, setV] = useStoredState('handybits:calc:dates', { from: '', to: '', base: '', op: 'add', amount: '30', unit: 'days' })
  const t0 = today()
  const from = v.from || t0
  const to = v.to || toISO(addToDay(localDay(), 90, 'days'))
  const a = parseDay(from)
  const b = parseDay(to)
  const ok = Number.isFinite(a) && Number.isFinite(b)
  const d = ok ? dateDiff(a, b) : null
  const base = v.base || t0
  const bd = parseDay(base)
  const amt = num(v.amount)
  const added = Number.isFinite(bd) && Number.isInteger(amt) ? addToDay(bd, v.op === 'add' ? amt : -amt, v.unit) : NaN
  const ymd = d && [d.years && plural(d.years, 'year'), d.months && plural(d.months, 'month'), plural(d.monthDays, 'day')].filter(Boolean).join(', ')
  return (
    <div className="calc-stack">
      <div className="panel">
        <div className="calc-grid">
          <DateField label="Start date" value={from} onChange={(x) => setV({ ...v, from: x })} />
          <DateField label="End date" value={to} onChange={(x) => setV({ ...v, to: x })} />
        </div>
        {d ? (
          <>
            <Result
              label="Difference"
              value={
                <>
                  {int.format(Math.abs(d.days))} <small>{Math.abs(d.days) === 1 ? 'day' : 'days'}</small>
                </>
              }
              explain={`${d.days < 0 ? 'The end date is before the start. ' : ''}Counts the days from the start date up to, but not including, the end date.`}
            />
            <Tiles
              items={[
                ['Weeks', plural(d.weeks, 'week'), d.weekDays ? `and ${plural(d.weekDays, 'day')}` : 'exactly'],
                ['Months', plural(d.totalMonths, 'month'), ymd],
                ['Business days', int.format(d.business), 'Monday to Friday, holidays not excluded'],
              ]}
            />
          </>
        ) : (
          <p className="calc-empty">Pick two dates.</p>
        )}
      </div>

      <div className="panel">
        <h3 className="calc-h3">Add or subtract time</h3>
        <div className="calc-grid calc-add">
          <DateField label="Date" value={base} onChange={(x) => setV({ ...v, base: x })} />
          <div className="calc-field">
            <span className="field-label">Operation</span>
            <Segmented
              label="Operation"
              value={v.op}
              onChange={(op) => setV({ ...v, op })}
              options={[
                ['add', 'Add'],
                ['sub', 'Subtract'],
              ]}
            />
          </div>
          <Field label="Amount" value={v.amount} onChange={(x) => setV({ ...v, amount: x })} />
          <div className="calc-field">
            <label className="field-label" htmlFor="calc-unit">
              Unit
            </label>
            <select id="calc-unit" className="calc-input calc-select" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })}>
              <option value="days">Days</option>
              <option value="weeks">Weeks</option>
              <option value="months">Months</option>
              <option value="years">Years</option>
            </select>
          </div>
        </div>
        <Result
          label="Result"
          value={Number.isFinite(added) ? longDate.format(added * DAY) : '–'}
          explain={
            Number.isFinite(added)
              ? `${shortDate.format(bd * DAY)} ${v.op === 'add' ? 'plus' : 'minus'} ${plural(amt, v.unit.slice(0, -1))}.${v.unit === 'months' || v.unit === 'years' ? ' If that month is shorter, it lands on its last day.' : ''}`
              : 'Enter a whole number.'
          }
        />
      </div>
    </div>
  )
}

/* Tip & split */

const TIP_PRESETS = ['10', '15', '18', '20']

function Tip() {
  const [v, setV] = useStoredState('handybits:calc:tip', { bill: '64.50', pct: '18', custom: '', people: 2, roundUp: false })
  const isCustom = !TIP_PRESETS.includes(v.pct)
  const pct = num(isCustom ? v.custom : v.pct)
  const bill = num(v.bill)
  const ok = Number.isFinite(bill) && bill >= 0 && Number.isFinite(pct) && pct >= 0
  const r = ok ? tipSplit({ bill, tipPct: pct, people: v.people, roundUp: v.roundUp }) : null
  const setPeople = (n) => setV({ ...v, people: Math.min(99, Math.max(1, n)) })
  return (
    <div className="panel">
      <div className="calc-grid calc-tip">
        <Field label="Bill" value={v.bill} onChange={(x) => setV({ ...v, bill: x })} wide />
        <div className="calc-field">
          <span className="field-label" id="calc-tip-label">
            Tip
          </span>
          <div className="calc-tip-row">
            <div className="segmented calc-seg" role="radiogroup" aria-labelledby="calc-tip-label">
              {TIP_PRESETS.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={v.pct === p} className={v.pct === p ? 'on' : ''} onClick={() => setV({ ...v, pct: p })}>
                  {p}%
                </button>
              ))}
              <button type="button" role="radio" aria-checked={isCustom} className={isCustom ? 'on' : ''} onClick={() => setV({ ...v, pct: 'custom' })}>
                Custom
              </button>
            </div>
            {isCustom && <Field inline label="Custom tip percent" value={v.custom} onChange={(x) => setV({ ...v, custom: x })} suffix="%" placeholder="12.5" />}
          </div>
        </div>
        <div className="calc-field">
          <span className="field-label" id="calc-people-label">
            People
          </span>
          <div className="calc-stepper" role="group" aria-labelledby="calc-people-label">
            <button type="button" className="icon" onClick={() => setPeople(v.people - 1)} disabled={v.people <= 1} aria-label="Fewer people">
              <Minus size={16} />
            </button>
            <output aria-live="polite">{v.people}</output>
            <button type="button" className="icon" onClick={() => setPeople(v.people + 1)} aria-label="More people">
              <Plus size={16} />
            </button>
          </div>
        </div>
        <label className={`check calc-check${v.roundUp ? ' on' : ''}`}>
          <input type="checkbox" checked={v.roundUp} onChange={(e) => setV({ ...v, roundUp: e.target.checked })} />
          Round each share up to a whole amount
        </label>
      </div>
      {r ? (
        <>
          <Result
            label={r.people > 1 ? 'Each person pays' : 'Total'}
            value={fmtMoney(r.people > 1 ? r.perPerson : r.total)}
            explain={
              v.roundUp
                ? `Shares rounded up, so the tip comes to ${fmtMoney(r.tip)} (${fmtPct(r.effectivePct)} of the bill).`
                : `${fmtMoney(bill)} + ${fmtPct(pct)} tip${r.people > 1 ? `, split ${r.people} ways${Math.abs(r.perPerson * r.people - r.total) > 0.001 ? ', rounded up to the cent' : ''}` : ''}.`
            }
          />
          <Tiles
            items={[
              ['Tip', fmtMoney(r.tip)],
              ['Total', fmtMoney(r.total)],
              ['Per person', fmtMoney(r.perPerson)],
            ]}
          />
        </>
      ) : (
        <p className="calc-empty">Enter the bill and a tip percentage.</p>
      )}
    </div>
  )
}

/* Discount & tax */

function Discount() {
  const [v, setV] = useStoredState('handybits:calc:discount', { price: '80', discount: '25', tax: '8' })
  const price = num(v.price)
  const disc = num(v.discount || '0')
  const tax = num(v.tax || '0')
  const ok = [price, disc, tax].every(Number.isFinite) && price >= 0
  const r = ok ? discountTax({ price, discountPct: disc, taxPct: tax }) : null
  return (
    <div className="panel">
      <div className="calc-grid calc-three">
        <Field label="Price" value={v.price} onChange={(x) => setV({ ...v, price: x })} />
        <Field label="Discount" value={v.discount} onChange={(x) => setV({ ...v, discount: x })} suffix="%" placeholder="0" />
        <Field label="Sales tax" value={v.tax} onChange={(x) => setV({ ...v, tax: x })} suffix="%" placeholder="0" />
      </div>
      {r ? (
        <>
          <Result
            label="Final price"
            value={fmtMoney(r.final)}
            explain={`${fmtMoney(price)} − ${fmtPct(disc)} = ${fmtMoney(r.subtotal)}, then ${fmtPct(tax)} tax on the discounted price.`}
          />
          <Tiles
            items={[
              ['You save', fmtMoney(r.savings)],
              ['After discount', fmtMoney(r.subtotal)],
              ['Tax', fmtMoney(r.tax)],
            ]}
          />
        </>
      ) : (
        <p className="calc-empty">Enter a price.</p>
      )}
    </div>
  )
}

/* GPA */

let rowSeq = 0
const newRow = (course = '', credits = '3', grade = '') => ({ id: `${Date.now().toString(36)}${rowSeq++}`, course, credits, grade })

function Gpa() {
  const [rows, setRows] = useStoredState('handybits:calc:gpa', () => [newRow('', '3', 'A'), newRow('', '4', 'B+'), newRow('', '3', '')])
  const list = Array.isArray(rows) && rows.length ? rows : [newRow()]
  const lastCourse = useRef(null)
  const r = gpa(list)
  const update = (id, patch) => setRows(list.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const remove = (id) => setRows(list.length > 1 ? list.filter((x) => x.id !== id) : [newRow()])
  const add = () => {
    setRows([...list, newRow()])
    requestAnimationFrame(() => lastCourse.current?.focus())
  }
  return (
    <div className="panel calc-gpa">
      <div className="calc-gpa-head" aria-hidden="true">
        <span>Course</span>
        <span>Credits</span>
        <span>Grade</span>
        <span />
      </div>
      <ul className="calc-gpa-rows">
        {list.map((row, i) => (
          <li key={row.id} className="calc-gpa-row">
            <input
              ref={i === list.length - 1 ? lastCourse : undefined}
              className="calc-input"
              value={row.course}
              placeholder={`Course ${i + 1}`}
              aria-label={`Course ${i + 1} name`}
              onChange={(e) => update(row.id, { course: e.target.value })}
            />
            <input
              className="calc-input calc-credits"
              inputMode="decimal"
              value={row.credits}
              aria-label={`Course ${i + 1} credits`}
              onChange={(e) => update(row.id, { credits: e.target.value })}
            />
            <select className="calc-input calc-select" value={row.grade} aria-label={`Course ${i + 1} grade`} onChange={(e) => update(row.id, { grade: e.target.value })}>
              <option value="">–</option>
              {GRADES.map(([g, p]) => (
                <option key={g} value={g}>
                  {g} · {p.toFixed(1)}
                </option>
              ))}
            </select>
            <button type="button" className="icon danger" onClick={() => remove(row.id)} aria-label={`Remove course ${i + 1}`}>
              <Trash size={16} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn small calc-add-row" onClick={add} disabled={list.length >= 40}>
        <Plus size={14} />
        Add course
      </button>
      <Result
        label="GPA"
        value={Number.isFinite(r.gpa) ? r.gpa.toFixed(2) : '–'}
        explain={
          Number.isFinite(r.gpa)
            ? `${formatNumber(r.points)} grade points ÷ ${formatNumber(r.credits)} credits, on a 4.0 scale. Courses without a grade are left out.`
            : 'Pick a grade and credits for at least one course.'
        }
      />
    </div>
  )
}

export default function Calculators() {
  const [tab, setTab] = useStoredState('handybits:calc:tab', 'percent')
  const current = TABS.some(([k]) => k === tab) ? tab : 'percent'
  const tabRefs = useRef({})
  const wrapRef = useRef(null)
  // Keep the chosen tab visible when the row scrolls sideways on phones.
  useEffect(() => {
    const wrap = wrapRef.current
    const btn = tabRefs.current[current]
    if (!wrap || !btn || wrap.scrollWidth <= wrap.clientWidth) return
    const left = btn.offsetLeft - wrap.offsetLeft
    if (left < wrap.scrollLeft || left + btn.offsetWidth > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = left - 24
  }, [current])
  const onKey = (e) => {
    const keys = TABS.map(([k]) => k)
    const i = keys.indexOf(current)
    const j = e.key === 'ArrowRight' ? (i + 1) % keys.length : e.key === 'ArrowLeft' ? (i - 1 + keys.length) % keys.length : -1
    if (j < 0) return
    e.preventDefault()
    setTab(keys[j])
    tabRefs.current[keys[j]]?.focus({ preventScroll: true })
  }
  return (
    <div className="tool calc">
      <header className="header">
        <h1 className="title">Calculators</h1>
        <p className="lede">Everyday sums done properly: percentages, ages, dates, splitting a bill, sale prices and GPA.</p>
      </header>

      <div className="calc-tabs-wrap" ref={wrapRef}>
        <div className="segmented calc-tabs" role="tablist" aria-label="Calculator" onKeyDown={onKey}>
          {TABS.map(([k, label]) => (
            <button
              key={k}
              ref={(el) => (tabRefs.current[k] = el)}
              id={`calc-tab-${k}`}
              type="button"
              role="tab"
              aria-selected={current === k}
              aria-controls="calc-panel"
              tabIndex={current === k ? 0 : -1}
              className={current === k ? 'on' : ''}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div id="calc-panel" role="tabpanel" aria-labelledby={`calc-tab-${current}`} className="calc-body">
        {current === 'percent' && <Percent />}
        {current === 'age' && <Age />}
        {current === 'dates' && <Dates />}
        {current === 'tip' && <Tip />}
        {current === 'discount' && <Discount />}
        {current === 'gpa' && <Gpa />}
      </div>

      <p className="footer">Everything is worked out on your device as you type. Dates are counted as whole calendar days, so daylight-saving changes never shift a result. Your inputs are remembered on this device.</p>
    </div>
  )
}
