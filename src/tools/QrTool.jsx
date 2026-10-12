import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AddressBook,
  Check,
  Copy,
  DownloadSimple,
  EnvelopeSimple,
  Eye,
  EyeSlash,
  ImageSquare,
  LinkSimple,
  Phone,
  QrCode,
  TextT,
  Trash,
  WarningCircle,
  WifiHigh,
} from '@phosphor-icons/react'
import QRCode from 'qrcode'
import { downloadBlob } from '../lib/format.js'
import { buildPayload, contrastRatio, isDarker } from '../lib/qr-payload.js'
import { drawQr, qrToSvg } from '../lib/qr-render.js'
import './QrTool.css'

const TYPES = [
  { id: 'link', label: 'Link', icon: LinkSimple },
  { id: 'text', label: 'Text', icon: TextT },
  { id: 'wifi', label: 'Wi-Fi', icon: WifiHigh },
  { id: 'contact', label: 'Contact', icon: AddressBook },
  { id: 'email', label: 'Email', icon: EnvelopeSimple },
  { id: 'phone', label: 'Phone', icon: Phone },
]

const FG_SWATCHES = [
  { value: '#1b1a17', name: 'Ink' },
  { value: '#2c3a55', name: 'Navy' },
  { value: '#3f6b4a', name: 'Moss' },
  { value: '#b5532f', name: 'Terracotta' },
  { value: '#5a3d66', name: 'Plum' },
]

const BG_SWATCHES = [
  { value: '#ffffff', name: 'White' },
  { value: '#f7f6f3', name: 'Paper' },
  { value: '#f6e7df', name: 'Blush' },
  { value: '#e6efe7', name: 'Sage' },
  { value: '#fdf3d8', name: 'Cream' },
]

const ECC = [
  { id: 'L', detail: '7%' },
  { id: 'M', detail: '15%' },
  { id: 'Q', detail: '25%' },
  { id: 'H', detail: '30%' },
]

const SIZES = [512, 1024, 2048]
const PREVIEW = 640
const STORE_KEY = 'handybits:qr'

const EMPTY = {
  link: { url: '' },
  text: { text: '' },
  wifi: { ssid: '', password: '', security: 'WPA', hidden: false },
  contact: { name: '', phone: '', email: '', company: '', website: '' },
  email: { to: '', subject: '', body: '' },
  phone: { mode: 'call', phone: '', message: '' },
}

function readStored() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
    const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d)
    return { type: TYPES.some((t) => t.id === s.type) ? s.type : 'link', fg: hex(s.fg, '#1b1a17'), bg: hex(s.bg, '#ffffff') }
  } catch {
    return { type: 'link', fg: '#1b1a17', bg: '#ffffff' }
  }
}

const canCopy = typeof window !== 'undefined' && typeof window.ClipboardItem !== 'undefined' && !!navigator.clipboard?.write

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export default function QrTool() {
  const [stored] = useState(readStored)
  const [type, setType] = useState(stored.type)
  const [data, setData] = useState(EMPTY)
  const [fg, setFg] = useState(stored.fg)
  const [bg, setBg] = useState(stored.bg)
  const [ecc, setEcc] = useState('M')
  const [margin, setMargin] = useState(3)
  const [style, setStyle] = useState('square')
  const [size, setSize] = useState(1024)
  const [logo, setLogo] = useState(null)
  const [logoError, setLogoError] = useState(null)
  const [copied, setCopied] = useState(false)
  const canvas = useRef(null)
  const logoInput = useRef(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ type, fg, bg }))
    } catch {
      // Storage may be unavailable; remembering is a nicety.
    }
  }, [type, fg, bg])

  const payload = buildPayload(type, data[type])
  const [debounced, setDebounced] = useState(payload)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(payload), 150)
    return () => clearTimeout(t)
  }, [payload])

  const { qr, tooLong } = useMemo(() => {
    if (!debounced) return { qr: null, tooLong: false }
    try {
      return { qr: QRCode.create(debounced, { errorCorrectionLevel: ecc }), tooLong: false }
    } catch {
      return { qr: null, tooLong: true }
    }
  }, [debounced, ecc])

  const look = useMemo(() => ({ margin, fg, bg, style, logo: logo?.img || null }), [margin, fg, bg, style, logo])

  useEffect(() => {
    const el = canvas.current
    if (!el || !qr) return
    drawQr(el.getContext('2d'), qr, { ...look, size: PREVIEW })
  }, [qr, look])

  const contrast = contrastRatio(fg, bg)
  const inverted = !isDarker(fg, bg)
  const field = (key) => ({
    value: data[type][key],
    onChange: (e) => setData((d) => ({ ...d, [type]: { ...d[type], [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } })),
  })
  const setField = (key, value) => setData((d) => ({ ...d, [type]: { ...d[type], [key]: value } }))

  async function addLogo(file) {
    setLogoError(null)
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setLogoError('Choose an image file for the logo.')
      return
    }
    try {
      const dataUrl = await fileToDataUrl(file)
      const img = await loadImg(dataUrl)
      setLogo({ name: file.name, dataUrl, img })
      setEcc('H')
    } catch {
      setLogoError('Couldn’t read that image.')
    }
  }

  function renderPng() {
    const c = document.createElement('canvas')
    c.width = c.height = size
    drawQr(c.getContext('2d'), qr, { ...look, size })
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'))
  }

  const fileBase = `qr-${type}`

  async function downloadPng() {
    const blob = await renderPng()
    if (blob) downloadBlob(blob, `${fileBase}.png`)
  }

  function downloadSvg() {
    const svg = qrToSvg(qr, { ...look, size, logo: logo ? { dataUrl: logo.dataUrl, width: logo.img.naturalWidth, height: logo.img.naturalHeight } : null })
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase}.svg`)
  }

  async function copyImage() {
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': renderPng() })])
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch (err) {
      console.error(err)
    }
  }

  const d = data[type]

  return (
    <div className="tool qr-tool">
      <header className="header">
        <h1 className="title">QR code</h1>
        <p className="lede">Make a QR code for a link, Wi-Fi network, contact card and more. It’s generated in your browser, so nothing is uploaded.</p>
      </header>

      <div className="segmented qr-types" role="radiogroup" aria-label="What the code holds">
        {TYPES.map((t) => {
          const Icon = t.icon
          const on = type === t.id
          return (
            <button key={t.id} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => setType(t.id)}>
              <Icon size={16} weight={on ? 'bold' : 'regular'} aria-hidden="true" />
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="qr-layout">
        <div className="qr-col">
          <section className="panel qr-form" aria-label="Content">
            {type === 'link' && (
              <Field id="qr-url" label="Website address">
                <input id="qr-url" className="input qr-input" type="url" inputMode="url" placeholder="example.com/page" autoComplete="off" spellCheck="false" {...field('url')} />
              </Field>
            )}

            {type === 'text' && (
              <Field id="qr-text" label="Text">
                <textarea id="qr-text" className="input qr-input qr-textarea" rows={4} placeholder="Anything you like" {...field('text')} />
              </Field>
            )}

            {type === 'wifi' && (
              <>
                <Field id="qr-ssid" label="Network name">
                  <input id="qr-ssid" className="input qr-input" placeholder="Home Wi-Fi" autoComplete="off" spellCheck="false" {...field('ssid')} />
                </Field>
                <div className="qr-field">
                  <span className="field-label" id="qr-sec-label">
                    Security
                  </span>
                  <div className="segmented qr-seg" role="radiogroup" aria-labelledby="qr-sec-label">
                    {[
                      ['WPA', 'WPA/WPA2/WPA3'],
                      ['WEP', 'WEP'],
                      ['none', 'None'],
                    ].map(([v, l]) => (
                      <button key={v} type="button" role="radio" aria-checked={d.security === v} className={d.security === v ? 'on' : ''} onClick={() => setField('security', v)}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {d.security !== 'none' && <PasswordField {...field('password')} />}
                <label className={`check qr-check${d.hidden ? ' on' : ''}`}>
                  <input type="checkbox" checked={d.hidden} onChange={(e) => setField('hidden', e.target.checked)} />
                  Hidden network
                </label>
              </>
            )}

            {type === 'contact' && (
              <div className="qr-pair">
                <Field id="qr-name" label="Name" wide>
                  <input id="qr-name" className="input qr-input" placeholder="Ada Lovelace" autoComplete="off" {...field('name')} />
                </Field>
                <Field id="qr-cphone" label="Phone">
                  <input id="qr-cphone" className="input qr-input" type="tel" placeholder="+44 20 7946 0000" autoComplete="off" {...field('phone')} />
                </Field>
                <Field id="qr-cemail" label="Email">
                  <input id="qr-cemail" className="input qr-input" type="email" placeholder="ada@example.com" autoComplete="off" {...field('email')} />
                </Field>
                <Field id="qr-company" label="Company">
                  <input id="qr-company" className="input qr-input" placeholder="Optional" autoComplete="off" {...field('company')} />
                </Field>
                <Field id="qr-site" label="Website">
                  <input id="qr-site" className="input qr-input" type="url" inputMode="url" placeholder="Optional" autoComplete="off" spellCheck="false" {...field('website')} />
                </Field>
              </div>
            )}

            {type === 'email' && (
              <>
                <Field id="qr-to" label="To">
                  <input id="qr-to" className="input qr-input" type="email" placeholder="hello@example.com" autoComplete="off" {...field('to')} />
                </Field>
                <Field id="qr-subject" label="Subject">
                  <input id="qr-subject" className="input qr-input" placeholder="Optional" autoComplete="off" {...field('subject')} />
                </Field>
                <Field id="qr-body" label="Message">
                  <textarea id="qr-body" className="input qr-input qr-textarea" rows={3} placeholder="Optional" {...field('body')} />
                </Field>
              </>
            )}

            {type === 'phone' && (
              <>
                <div className="segmented qr-seg" role="radiogroup" aria-label="Scanning should">
                  {[
                    ['call', 'Start a call'],
                    ['sms', 'Write a text'],
                  ].map(([v, l]) => (
                    <button key={v} type="button" role="radio" aria-checked={d.mode === v} className={d.mode === v ? 'on' : ''} onClick={() => setField('mode', v)}>
                      {l}
                    </button>
                  ))}
                </div>
                <Field id="qr-phone" label="Phone number">
                  <input id="qr-phone" className="input qr-input" type="tel" placeholder="+1 555 010 0199" autoComplete="off" {...field('phone')} />
                </Field>
                {d.mode === 'sms' && (
                  <Field id="qr-sms" label="Message">
                    <textarea id="qr-sms" className="input qr-input qr-textarea" rows={3} placeholder="Optional" {...field('message')} />
                  </Field>
                )}
              </>
            )}
          </section>

          <section className="panel qr-form" aria-label="Style">
            <div className="qr-pair">
              <ColourField label="Foreground" value={fg} onChange={setFg} swatches={FG_SWATCHES} />
              <ColourField label="Background" value={bg} onChange={setBg} swatches={BG_SWATCHES} />
            </div>
            {(contrast < 3 || inverted) && (
              <p className="notice error qr-notice" role="status">
                <WarningCircle size={16} weight="fill" />
                {contrast < 3 ? 'The colours are too close. Many phones won’t be able to scan this.' : 'Light codes on dark backgrounds don’t scan on every phone.'}
              </p>
            )}

            <div className="qr-pair">
              <div className="qr-field">
                <span className="field-label" id="qr-ecc-label">
                  Error correction
                </span>
                <div className="segmented qr-seg" role="radiogroup" aria-labelledby="qr-ecc-label">
                  {ECC.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      role="radio"
                      aria-checked={ecc === e.id}
                      className={ecc === e.id ? 'on' : ''}
                      onClick={() => setEcc(e.id)}
                      title={`Survives about ${e.detail} damage`}
                    >
                      {e.id}
                    </button>
                  ))}
                </div>
                <span className="qr-hint">{logo && ecc !== 'H' ? 'Use H with a logo so the code still scans.' : 'Higher survives more damage but makes a denser code.'}</span>
              </div>

              <div className="qr-field">
                <label className="field-label qr-label-row" htmlFor="qr-margin">
                  Margin
                  <output className="qr-value" htmlFor="qr-margin">
                    {margin}
                  </output>
                </label>
                <input
                  id="qr-margin"
                  className="qr-range"
                  type="range"
                  min="0"
                  max="8"
                  step="1"
                  value={margin}
                  onChange={(e) => setMargin(Number(e.target.value))}
                  style={{ '--fill': `${(margin / 8) * 100}%` }}
                />
                <span className="qr-hint">Empty border, in modules. Scanners like at least 2.</span>
              </div>
            </div>

            <div className="qr-pair">
              <div className="qr-field">
                <span className="field-label" id="qr-style-label">
                  Modules
                </span>
                <div className="segmented qr-seg" role="radiogroup" aria-labelledby="qr-style-label">
                  {[
                    ['square', 'Square'],
                    ['dots', 'Dots'],
                  ].map(([v, l]) => (
                    <button key={v} type="button" role="radio" aria-checked={style === v} className={style === v ? 'on' : ''} onClick={() => setStyle(v)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="qr-field">
                <span className="field-label">Logo</span>
                <input ref={logoInput} type="file" accept="image/*" hidden onChange={(e) => (addLogo(e.target.files[0]), (e.target.value = ''))} />
                {logo ? (
                  <div className="qr-logo">
                    <img src={logo.dataUrl} alt="" />
                    <span className="qr-logo-name" title={logo.name}>
                      {logo.name}
                    </span>
                    <button type="button" className="icon danger" aria-label="Remove logo" title="Remove logo" onClick={() => setLogo(null)}>
                      <Trash size={16} />
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn small qr-logo-btn" onClick={() => logoInput.current?.click()}>
                    <ImageSquare size={15} />
                    Add a logo
                  </button>
                )}
                {logoError && (
                  <span className="error">
                    <WarningCircle size={14} weight="fill" />
                    {logoError}
                  </span>
                )}
              </div>
            </div>
          </section>
        </div>

        <aside className="qr-preview" aria-label="Preview">
          <div className="qr-stage" style={{ background: qr ? bg : undefined }}>
            {qr ? (
              <canvas ref={canvas} width={PREVIEW} height={PREVIEW} className="qr-canvas" role="img" aria-label="QR code preview" />
            ) : (
              <div className="qr-placeholder">
                <QrCode size={40} weight="thin" aria-hidden="true" />
                <p>{tooLong ? 'That’s too much for one QR code. Try shortening it.' : 'Your code appears here as you type.'}</p>
              </div>
            )}
          </div>

          <div className="qr-export">
            <div className="qr-export-row">
              <span className="field-label" id="qr-size-label">
                PNG size
              </span>
              <div className="segmented qr-sizes" role="radiogroup" aria-labelledby="qr-size-label">
                {SIZES.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={size === s} className={size === s ? 'on' : ''} onClick={() => setSize(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="btn primary" onClick={downloadPng} disabled={!qr}>
              <DownloadSimple size={16} weight="bold" />
              Download PNG
            </button>
            <div className="qr-export-pair">
              <button type="button" className="btn" onClick={downloadSvg} disabled={!qr}>
                <DownloadSimple size={16} />
                SVG
              </button>
              {canCopy && (
                <button type="button" className="btn" onClick={copyImage} disabled={!qr} aria-live="polite">
                  {copied ? <Check size={16} weight="bold" /> : <Copy size={16} />}
                  {copied ? 'Copied' : 'Copy image'}
                </button>
              )}
            </div>
            {qr && (
              <p className="qr-meta">
                Version {qr.version} · {qr.modules.size}×{qr.modules.size} modules · {debounced.length} characters
              </p>
            )}
          </div>
        </aside>
      </div>

      <footer className="footer">Codes are drawn in your browser and never expire, since the content is stored in the pattern itself. Scan a test before you print.</footer>
    </div>
  )
}

function Field({ id, label, children, wide = false }) {
  return (
    <div className={`qr-field${wide ? ' wide' : ''}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  )
}

function PasswordField(props) {
  const [show, setShow] = useState(false)
  return (
    <div className="qr-field">
      <label className="field-label" htmlFor="qr-pass">
        Password
      </label>
      <div className="input-wrap">
        <input id="qr-pass" className="input qr-input qr-pass" type={show ? 'text' : 'password'} autoComplete="off" spellCheck="false" {...props} />
        <button type="button" className="icon qr-pass-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          {show ? <EyeSlash size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </div>
  )
}

function ColourField({ label, value, onChange, swatches }) {
  const id = `qr-${label.toLowerCase()}`
  return (
    <div className="qr-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="qr-colour">
        <span className="qr-colour-well" style={{ background: value }}>
          <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        </span>
        <span className="qr-colour-hex">{value.toUpperCase()}</span>
        <div className="qr-swatches" role="group" aria-label={`${label} presets`}>
          {swatches.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`qr-swatch${s.value === value.toLowerCase() ? ' on' : ''}`}
              style={{ background: s.value }}
              onClick={() => onChange(s.value)}
              aria-label={s.name}
              aria-pressed={s.value === value.toLowerCase()}
              title={s.name}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
