import { useEffect, useRef, useState } from 'react'
import { ArrowsLeftRight, Check, Copy } from '@phosphor-icons/react'
import { CATEGORIES, CATEGORY_KEYS, convert, findUnit, formatNumber, formatPlain, parseNumber } from '../lib/units.js'
import { useCopy, useStoredState } from '../lib/text-hooks.js'
import './UnitConverter.css'

const DEFAULTS = { cat: 'length', pairs: {}, side: 'a', text: '1' }

const TEMP_FORMULA = {
  'c>f': '°F = °C × 9/5 + 32',
  'f>c': '°C = (°F − 32) × 5/9',
  'c>k': 'K = °C + 273.15',
  'k>c': '°C = K − 273.15',
  'f>k': 'K = (°F − 32) × 5/9 + 273.15',
  'k>f': '°F = (K − 273.15) × 9/5 + 32',
}

function UnitSelect({ id, cat, value, onChange, label }) {
  return (
    <select id={id} className="uc-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {CATEGORIES[cat].units.map((x) => (
        <option key={x.id} value={x.id}>
          {x.label} ({x.short})
        </option>
      ))}
    </select>
  )
}

export default function UnitConverter() {
  const [stored, setStored] = useStoredState('handybits:units:state', DEFAULTS)
  const s = { ...DEFAULTS, ...stored }
  const cat = CATEGORIES[s.cat] ? s.cat : 'length'
  const C = CATEGORIES[cat]
  const saved = s.pairs[cat] || []
  const a = findUnit(cat, saved[0]) ? saved[0] : C.defaults[0]
  const b = findUnit(cat, saved[1]) ? saved[1] : C.defaults[1]
  const [copied, copy] = useCopy()
  const [status, setStatus] = useState('')
  const catRefs = useRef({})
  const catsRef = useRef(null)
  // Keep the chosen category visible when the chips scroll sideways on phones.
  useEffect(() => {
    const row = catsRef.current
    const btn = catRefs.current[cat]
    if (!row || !btn || row.scrollWidth <= row.clientWidth) return
    const left = btn.offsetLeft - row.offsetLeft
    if (left < row.scrollLeft || left + btn.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left - 24
  }, [cat])

  const set = (patch) => setStored({ ...s, ...patch })
  const setPair = (na, nb) => set({ pairs: { ...s.pairs, [cat]: [na, nb] } })

  // The side the user typed in is the source; the other is computed.
  const srcUnit = s.side === 'a' ? a : b
  const dstUnit = s.side === 'a' ? b : a
  const srcVal = parseNumber(s.text)
  const dstVal = convert(srcVal, cat, srcUnit, dstUnit)
  const textA = s.side === 'a' ? s.text : formatPlain(dstVal)
  const textB = s.side === 'b' ? s.text : formatPlain(dstVal)
  const valA = s.side === 'a' ? srcVal : dstVal
  const invalid = s.text.trim() !== '' && Number.isNaN(srcVal)

  const swap = () => {
    // Keep the number the user sees on the left, now in the other unit.
    set({ pairs: { ...s.pairs, [cat]: [b, a] }, side: 'a', text: textA })
  }

  const pickCat = (k) => {
    // Carry the typed number over to the new category's left unit.
    set({ cat: k, side: 'a', text: Number.isFinite(valA) ? formatPlain(valA) : s.text })
  }

  const onCatKey = (e) => {
    const i = CATEGORY_KEYS.indexOf(cat)
    let j = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % CATEGORY_KEYS.length
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + CATEGORY_KEYS.length) % CATEGORY_KEYS.length
    if (e.key === 'Home') j = 0
    if (e.key === 'End') j = CATEGORY_KEYS.length - 1
    if (j < 0) return
    e.preventDefault()
    const k = CATEGORY_KEYS[j]
    pickCat(k)
    catRefs.current[k]?.focus({ preventScroll: true })
  }

  const ua = findUnit(cat, a)
  const ub = findUnit(cat, b)
  const one = convert(1, cat, a, b)
  const explain =
    cat === 'temperature'
      ? a === b
        ? 'Same unit'
        : TEMP_FORMULA[`${a}>${b}`]
      : a === b
        ? 'Same unit'
        : srcVal === 1 && s.side === 'a'
          ? `1 ${ub.short} = ${formatNumber(1 / one)} ${ua.short}`
          : `1 ${ua.short} = ${formatNumber(one)} ${ub.short} · 1 ${ub.short} = ${formatNumber(1 / one)} ${ua.short}`

  const resultText = Number.isFinite(srcVal) ? `${formatNumber(srcVal)} ${findUnit(cat, srcUnit).short} = ${formatNumber(dstVal)} ${findUnit(cat, dstUnit).short}` : ''

  // Base value for the table comes from whichever side is the source.
  const tableFrom = srcUnit
  const mlForWater = cat === 'cooking' && Number.isFinite(srcVal) ? convert(srcVal, cat, srcUnit, 'ml') : NaN

  async function copyRow(unit) {
    const v = convert(srcVal, cat, tableFrom, unit.id)
    const ok = await copy(`${formatPlain(v)} ${unit.short}`, unit.id)
    setStatus(ok ? `Copied ${formatNumber(v)} ${unit.short}` : 'Copy was blocked by the browser')
  }

  return (
    <div className="tool uc">
      <header className="header">
        <h1 className="title">Unit converter</h1>
        <p className="lede">Convert length, weight, temperature, cooking measures and more. Type on either side.</p>
      </header>

      <div className="uc-cats-wrap">
        <div className="uc-cats" ref={catsRef} role="radiogroup" aria-label="Category" onKeyDown={onCatKey}>
          {CATEGORY_KEYS.map((k) => (
            <button
              key={k}
              ref={(el) => (catRefs.current[k] = el)}
              type="button"
              role="radio"
              aria-checked={cat === k}
              tabIndex={cat === k ? 0 : -1}
              className={cat === k ? 'on' : ''}
              onClick={() => pickCat(k)}
            >
              {CATEGORIES[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel uc-panel">
        <div className="uc-pair">
          <div className="uc-side">
            <label className="field-label" htmlFor="uc-a">
              From
            </label>
            <input
              id="uc-a"
              className={`uc-input${invalid && s.side === 'a' ? ' bad' : ''}`}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={textA}
              onChange={(e) => set({ side: 'a', text: e.target.value })}
              onFocus={(e) => e.target.select()}
            />
            <UnitSelect id="uc-ua" cat={cat} value={a} onChange={(v) => setPair(v, b)} label="From unit" />
          </div>
          <button type="button" className="uc-swap" onClick={swap} aria-label="Swap units" title="Swap units">
            <ArrowsLeftRight size={18} />
          </button>
          <div className="uc-side">
            <label className="field-label" htmlFor="uc-b">
              To
            </label>
            <input
              id="uc-b"
              className={`uc-input${invalid && s.side === 'b' ? ' bad' : ''}`}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={textB}
              onChange={(e) => set({ side: 'b', text: e.target.value })}
              onFocus={(e) => e.target.select()}
            />
            <UnitSelect id="uc-ub" cat={cat} value={b} onChange={(v) => setPair(a, v)} label="To unit" />
          </div>
        </div>
        <div className="uc-result" aria-live="polite">
          {invalid ? <span className="uc-bad">Enter a number, like 12.5 or 1e6</span> : <strong>{resultText}</strong>}
          <span className="uc-explain">{explain}</span>
        </div>
      </div>

      {cat === 'cooking' && (
        <p className="uc-note">
          For water, 1 ml weighs about 1 g{Number.isFinite(mlForWater) ? `, so this is about ${formatNumber(mlForWater)} g` : ''}. Flour, sugar and
          butter are lighter or heavier, so weigh those if the recipe needs precision.
        </p>
      )}
      {cat === 'data' && <p className="uc-note">kB, MB and GB are powers of 1,000. KiB, MiB and GiB are powers of 1,024, which is what most operating systems actually count.</p>}

      <section className="section" aria-labelledby="uc-all-h">
        <div className="section-head">
          <h2 id="uc-all-h">
            {Number.isFinite(srcVal) ? `${formatNumber(srcVal)} ${findUnit(cat, tableFrom).short} in every unit` : 'Every unit'}
          </h2>
          <span className="uc-hint">Click a row to copy</span>
        </div>
        <ul className="uc-table">
          {C.units.map((x) => {
            const v = convert(srcVal, cat, tableFrom, x.id)
            const isSrc = x.id === tableFrom
            return (
              <li key={x.id}>
                <button type="button" className={`uc-row${isSrc ? ' src' : ''}`} onClick={() => copyRow(x)} disabled={!Number.isFinite(v)}>
                  <span className="uc-row-label">{x.label}</span>
                  <span className="uc-row-value">
                    {formatNumber(v)}
                    <span className="uc-row-unit">{x.short}</span>
                  </span>
                  <span className={`uc-row-copy${copied === x.id ? " done" : ""}`} aria-hidden="true">
                    {copied === x.id ? <Check size={15} weight="bold" /> : <Copy size={15} />}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="sr-only" aria-live="polite">
          {status}
        </p>
      </section>

      <p className="footer">
        Factors use exact legal definitions where they exist (an inch is 25.4 mm, a pound is 0.45359237 kg, a US cup is 236.5882365 ml). Results show
        up to six significant digits. Your last category and units are remembered on this device.
      </p>
    </div>
  )
}
