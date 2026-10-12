import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowsClockwise, ArrowsLeftRight, ArrowUp, Check, CheckCircle, Copy, DownloadSimple, Info, Trash, WarningCircle, XCircle } from '@phosphor-icons/react'
import DropZone from '../components/DropZone.jsx'
import * as D from '../lib/dev-utils.js'
import { nf, useCopy, useStoredState } from '../lib/text-hooks.js'
import './DevTools.css'

const TABS = [
  ['json', 'JSON'],
  ['base64', 'Base64'],
  ['url', 'URL'],
  ['uuid', 'UUID'],
  ['hash', 'Hash'],
  ['jwt', 'JWT'],
  ['time', 'Timestamp'],
]

const K = (k) => `handybits:dev:${k}`

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function DevTools() {
  const [tab, setTab] = useStoredState(K('tab'), 'json')
  const tabRefs = useRef({})

  function onTabKey(e) {
    const i = TABS.findIndex(([k]) => k === tab)
    let next = null
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length][0]
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length][0]
    else if (e.key === 'Home') next = TABS[0][0]
    else if (e.key === 'End') next = TABS.at(-1)[0]
    if (next) {
      e.preventDefault()
      setTab(next)
      tabRefs.current[next]?.focus()
    }
  }

  useEffect(() => {
    tabRefs.current[tab]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab])

  return (
    <div className="tool dev">
      <header className="header">
        <h1 className="title">Developer tools</h1>
        <p className="lede">Format JSON, encode and decode, generate UUIDs, hash files and inspect tokens. Nothing leaves your browser.</p>
      </header>

      <div className="dev-tabs-wrap">
        <div className="segmented dev-tabs" role="tablist" aria-label="Tool" onKeyDown={onTabKey}>
          {TABS.map(([key, label]) => (
            <button
              key={key}
              ref={(el) => (tabRefs.current[key] = el)}
              type="button"
              role="tab"
              id={`dev-tab-${key}`}
              aria-selected={tab === key}
              aria-controls="dev-panel"
              tabIndex={tab === key ? 0 : -1}
              className={tab === key ? 'on' : ''}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div id="dev-panel" role="tabpanel" aria-labelledby={`dev-tab-${tab}`} className="dev-panel" key={tab}>
        {tab === 'json' && <JsonTab />}
        {tab === 'base64' && <Base64Tab />}
        {tab === 'url' && <UrlTab />}
        {tab === 'uuid' && <UuidTab />}
        {tab === 'hash' && <HashTab />}
        {tab === 'jwt' && <JwtTab />}
        {tab === 'time' && <TimeTab />}
      </div>

      <p className="footer">Everything runs in your browser. Inputs are saved on this device so they’re here when you come back, except JWTs, which are never stored.</p>
    </div>
  )
}

// ---------- Shared bits ----------

function CopyBtn({ text, label = 'Copy', small = true, ghost = false, disabled, what }) {
  const [copied, copy] = useCopy()
  const [failed, setFailed] = useState(false)
  return (
    <button
      type="button"
      className={`btn${small ? ' small' : ''}${ghost ? ' ghost' : ''} dev-copy`}
      disabled={disabled || !text}
      onClick={async () => setFailed(!(await copy(text)))}
      aria-label={what ? `${label} ${what}` : undefined}
    >
      {copied ? <Check size={15} weight="bold" /> : <Copy size={15} />}
      {copied ? 'Copied' : failed ? 'Copy blocked' : label}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  )
}

function SegGroup({ label, value, onChange, options }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={String(key)} type="button" role="radio" aria-checked={value === key} className={value === key ? 'on' : ''} onClick={() => onChange(key)}>
          {text}
        </button>
      ))}
    </div>
  )
}

function Check2({ checked, onChange, children }) {
  return (
    <label className={`check${checked ? ' on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

function Area({ id, label, value, onChange, placeholder, meta, actions, readOnly, rows, mono = true, className = '' }) {
  return (
    <div className={`dev-field ${className}`}>
      <div className="dev-field-head">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        {meta != null && <span className="dev-meta">{meta}</span>}
        {actions && <div className="dev-field-actions">{actions}</div>}
      </div>
      <textarea
        id={id}
        className={`dev-area${readOnly ? ' out' : ''}${mono ? ' mono' : ''}`}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        placeholder={placeholder}
        spellCheck="false"
        autoComplete="off"
        autoCapitalize="off"
        rows={rows}
      />
    </div>
  )
}

function ClearBtn({ onClick, disabled }) {
  return (
    <button type="button" className="btn ghost small danger" onClick={onClick} disabled={disabled}>
      <Trash size={15} />
      Clear
    </button>
  )
}

function ErrorNote({ children }) {
  return (
    <p className="notice error dev-note" role="alert">
      <WarningCircle size={16} weight="bold" />
      <span>{children}</span>
    </p>
  )
}

// ---------- JSON ----------

function JsonTab() {
  const [input, setInput] = useStoredState(K('json'), '')
  const [mode, setMode] = useStoredState(K('json-mode'), 'format')
  const [indent, setIndent] = useStoredState(K('json-indent'), 2)
  const [sorted, setSorted] = useStoredState(K('json-sort'), false)
  const deferred = useDeferredValue(input)

  const result = useMemo(() => {
    if (!deferred.trim()) return null
    const parsed = D.parseJson(deferred)
    if (!parsed.ok) return parsed
    const out = D.formatJson(parsed.value, mode === 'minify' ? 0 : indent, sorted)
    return { ok: true, out, type: Array.isArray(parsed.value) ? 'array' : parsed.value === null ? 'null' : typeof parsed.value }
  }, [deferred, mode, indent, sorted])

  return (
    <>
      <div className="dev-toolbar">
        <SegGroup
          label="Output"
          value={mode}
          onChange={setMode}
          options={[
            ['format', 'Format'],
            ['minify', 'Minify'],
          ]}
        />
        {mode === 'format' && (
          <SegGroup
            label="Indent"
            value={indent}
            onChange={setIndent}
            options={[
              [2, '2 spaces'],
              [4, '4 spaces'],
              ['tab', 'Tab'],
            ]}
          />
        )}
        <Check2 checked={sorted} onChange={setSorted}>
          Sort keys
        </Check2>
      </div>

      <Area
        id="dev-json-in"
        label="JSON"
        value={input}
        onChange={setInput}
        placeholder='{"paste": "your JSON here"}'
        meta={input && `${nf.format(input.length)} characters`}
        actions={<ClearBtn onClick={() => setInput('')} disabled={!input} />}
      />

      <div className="dev-status" aria-live="polite">
        {result?.ok === false && <JsonError text={deferred} err={result} />}
        {result?.ok && (
          <p className="notice ok dev-note">
            <CheckCircle size={16} weight="bold" />
            <span>Valid JSON ({result.type})</span>
          </p>
        )}
      </div>

      <Area
        id="dev-json-out"
        label="Result"
        value={result?.ok ? result.out : ''}
        readOnly
        placeholder="The formatted JSON shows up here."
        meta={result?.ok && `${nf.format(result.out.length)} characters`}
        actions={
          <>
            <button type="button" className="btn ghost small" disabled={!result?.ok} onClick={() => setInput(result.out)}>
              <ArrowUp size={15} />
              Use as input
            </button>
            <CopyBtn text={result?.ok ? result.out : ''} what="result" />
          </>
        }
      />
    </>
  )
}

function JsonError({ text, err }) {
  const hasPos = err.line != null
  let snippet = null
  if (hasPos) {
    const lineText = text.split('\n')[err.line - 1] ?? ''
    // Keep long lines readable: show a window around the error column.
    const start = Math.max(0, err.column - 40)
    const shown = lineText.slice(start, start + 80).replace(/\t/g, ' ')
    const caretAt = err.column - 1 - start
    snippet = (
      <pre className="dev-json-snippet" aria-hidden="true">
        <span className="dev-ln">{err.line}</span>
        {start > 0 ? '…' : ''}
        {shown || ' '}
        {'\n'}
        <span className="dev-ln"> </span>
        {start > 0 ? ' ' : ''}
        {' '.repeat(Math.max(0, caretAt))}
        <span className="dev-caret">^</span>
      </pre>
    )
  }
  return (
    <div className="notice error dev-note dev-json-err" role="alert">
      <XCircle size={16} weight="bold" />
      <div>
        <p>
          {err.message}
          {hasPos && (
            <span className="dev-pos">
              {' '}
              · Line {err.line}, column {err.column}
            </span>
          )}
        </p>
        {snippet}
      </div>
    </div>
  )
}

// ---------- Base64 ----------

function Base64Tab() {
  const [dir, setDir] = useStoredState(K('b64-dir'), 'encode')
  const [urlSafe, setUrlSafe] = useStoredState(K('b64-url'), false)
  const [input, setInput] = useStoredState(K('b64'), '')
  const [file, setFile] = useState(null) // { name, size, type, b64 }
  const [fileFmt, setFileFmt] = useStoredState(K('b64-file-fmt'), 'dataurl')
  const [busy, setBusy] = useState(false)
  const [fileErr, setFileErr] = useState('')

  const res = useMemo(() => {
    if (!input) return { out: '' }
    try {
      if (dir === 'encode') return { out: D.encodeBase64Text(input, urlSafe) }
      const { data } = D.splitDataUrl(input)
      const r = D.decodeBase64Text(data)
      return { out: r.text, valid: r.valid, bytes: r.bytes }
    } catch (e) {
      return { out: '', error: e.message }
    }
  }, [input, dir, urlSafe])

  async function onFile(files) {
    const f = files[0]
    setFileErr('')
    if (f.size > 200 * 1024 ** 2) {
      setFileErr('That file is over 200 MB, which is too big to turn into text in the browser.')
      return
    }
    setBusy(true)
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      setFile({ name: f.name, size: f.size, type: f.type || 'application/octet-stream', b64: D.bytesToBase64(bytes) })
    } catch {
      setFileErr('Couldn’t read that file.')
    } finally {
      setBusy(false)
    }
  }

  function downloadDecoded() {
    const { mime } = D.splitDataUrl(input)
    const sniff = D.sniffType(res.bytes)
    const type = mime || sniff?.mime || (res.valid ? 'text/plain' : 'application/octet-stream')
    const ext = sniff?.ext || D.extForMime(type)
    download(new Blob([res.bytes], { type }), `decoded.${ext}`)
  }

  const fileOut = file ? (fileFmt === 'dataurl' ? `data:${file.type};base64,${file.b64}` : file.b64) : ''
  const PREVIEW = 20000

  return (
    <>
      <div className="dev-toolbar">
        <SegGroup
          label="Direction"
          value={dir}
          onChange={setDir}
          options={[
            ['encode', 'Encode'],
            ['decode', 'Decode'],
          ]}
        />
        {dir === 'encode' && (
          <Check2 checked={urlSafe} onChange={setUrlSafe}>
            URL-safe
          </Check2>
        )}
        <button
          type="button"
          className="btn ghost small"
          disabled={!res.out || res.error || (dir === 'decode' && !res.valid)}
          onClick={() => {
            setInput(res.out)
            setDir(dir === 'encode' ? 'decode' : 'encode')
          }}
        >
          <ArrowsLeftRight size={15} />
          Swap
        </button>
      </div>

      <Area
        id="dev-b64-in"
        label={dir === 'encode' ? 'Text' : 'Base64'}
        value={input}
        onChange={setInput}
        mono={dir === 'decode'}
        placeholder={dir === 'encode' ? 'Type or paste text to encode…' : 'Paste Base64 or a data: URL…'}
        meta={input && `${nf.format(input.length)} characters`}
        actions={<ClearBtn onClick={() => setInput('')} disabled={!input} />}
      />
      <div className="dev-status" aria-live="polite">
        {res.error && <ErrorNote>{res.error}</ErrorNote>}
        {dir === 'decode' && res.out && !res.valid && (
          <p className="notice dev-note dev-warn">
            <Info size={16} weight="bold" />
            <span>This decodes to binary data, not UTF-8 text. Download it as a file instead.</span>
          </p>
        )}
      </div>
      <Area
        id="dev-b64-out"
        label={dir === 'encode' ? 'Base64' : 'Text'}
        value={dir === 'decode' && !res.valid ? '' : res.out}
        readOnly
        mono={dir === 'encode'}
        placeholder="The result shows up here."
        meta={res.bytes && `${formatBytes(res.bytes.length)}`}
        actions={
          <>
            {dir === 'decode' && (
              <button type="button" className="btn ghost small" disabled={!res.bytes?.length} onClick={downloadDecoded}>
                <DownloadSimple size={15} />
                Download as file
              </button>
            )}
            <CopyBtn text={dir === 'decode' && !res.valid ? '' : res.out} what="result" />
          </>
        }
      />

      <section className="section" aria-labelledby="dev-b64-file-h">
        <div className="section-head">
          <h2 id="dev-b64-file-h">Encode a file</h2>
          {file && (
            <SegGroup
              label="File output"
              value={fileFmt}
              onChange={setFileFmt}
              options={[
                ['dataurl', 'Data URL'],
                ['raw', 'Base64'],
              ]}
            />
          )}
        </div>
        <DropZone compact multiple={false} onFiles={onFile} title={busy ? 'Reading…' : file ? 'Drop another file or click to browse' : 'Drop a file here or click to browse'} />
        {fileErr && <ErrorNote>{fileErr}</ErrorNote>}
        {file && (
          <div className="dev-file-out">
            <div className="dev-field-head">
              <span className="field-label dev-filename">{file.name}</span>
              <span className="dev-meta">
                {formatBytes(file.size)} → {formatBytes(fileOut.length)} of text
              </span>
              <div className="dev-field-actions">
                <CopyBtn text={fileOut} what="encoded file" />
              </div>
            </div>
            <pre className="dev-pre">
              {fileOut.length > PREVIEW ? `${fileOut.slice(0, PREVIEW)}…` : fileOut}
            </pre>
            {fileOut.length > PREVIEW && <p className="dev-hint">Showing the first {nf.format(PREVIEW)} characters. Copy gets all of it.</p>}
          </div>
        )}
      </section>
    </>
  )
}

// ---------- URL ----------

function UrlTab() {
  const [dir, setDir] = useStoredState(K('url-dir'), 'encode')
  const [scope, setScope] = useStoredState(K('url-scope'), 'component')
  const [input, setInput] = useStoredState(K('url'), '')
  const [toParse, setToParse] = useStoredState(K('url-parse'), '')

  const res = useMemo(() => {
    if (!input) return { out: '' }
    try {
      if (dir === 'encode') return { out: scope === 'component' ? encodeURIComponent(input) : encodeURI(input) }
      const plus = input.replace(/\+/g, scope === 'component' ? ' ' : '+')
      return { out: scope === 'component' ? decodeURIComponent(plus) : decodeURI(input) }
    } catch {
      return { out: '', error: dir === 'encode' ? 'This text has a broken character (a lone surrogate) that can’t be encoded.' : 'This has a % sequence that isn’t valid, like %E0%A4%A or a stray %.' }
    }
  }, [input, dir, scope])

  const parsed = useMemo(() => {
    if (!toParse.trim()) return null
    try {
      return D.parseUrl(toParse)
    } catch {
      return { error: 'That isn’t a full URL. Include the scheme, like https://' }
    }
  }, [toParse])

  const parts = parsed && !parsed.error ? [
    ['Protocol', parsed.protocol],
    ['Username', parsed.username],
    ['Password', parsed.password],
    ['Host', parsed.hostname],
    ['Port', parsed.port],
    ['Origin', parsed.origin],
    ['Path', parsed.pathname],
    ['Query', parsed.search],
    ['Fragment', parsed.hash],
  ].filter(([, v]) => v) : []

  return (
    <>
      <div className="dev-toolbar">
        <SegGroup
          label="Direction"
          value={dir}
          onChange={setDir}
          options={[
            ['encode', 'Encode'],
            ['decode', 'Decode'],
          ]}
        />
        <SegGroup
          label="Scope"
          value={scope}
          onChange={setScope}
          options={[
            ['component', 'Component'],
            ['full', 'Full URL'],
          ]}
        />
      </div>
      <p className="dev-hint dev-hint-top">
        {scope === 'component'
          ? 'Component encodes everything except letters, digits and - _ . ! ~ * \' ( ), for a single query value or path segment.'
          : 'Full URL keeps characters like : / ? & = # so the address still works.'}
      </p>
      <Area
        id="dev-url-in"
        label="Input"
        value={input}
        onChange={setInput}
        placeholder={dir === 'encode' ? 'Text to encode, like a search term with spaces & symbols' : 'Encoded text, like caf%C3%A9%20au%20lait'}
        actions={<ClearBtn onClick={() => setInput('')} disabled={!input} />}
      />
      <div className="dev-status" aria-live="polite">
        {res.error && <ErrorNote>{res.error}</ErrorNote>}
      </div>
      <Area id="dev-url-out" label="Result" value={res.out} readOnly placeholder="The result shows up here." actions={<CopyBtn text={res.out} what="result" />} />

      <section className="section" aria-labelledby="dev-url-parse-h">
        <div className="section-head">
          <h2 id="dev-url-parse-h">Break down a URL</h2>
        </div>
        <label className="sr-only" htmlFor="dev-url-parse">
          URL to break down
        </label>
        <input id="dev-url-parse" className="input dev-input mono" value={toParse} onChange={(e) => setToParse(e.target.value)} placeholder="https://example.com:8080/path/page?q=hello%20world&lang=en#top" spellCheck="false" autoComplete="off" />
        {parsed?.error && <ErrorNote>{parsed.error}</ErrorNote>}
        {parts.length > 0 && (
          <table className="dev-table">
            <tbody>
              {parts.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>
                    <code>{v}</code>
                  </td>
                  <td className="dev-td-act">
                    <CopyBtn text={v} ghost what={k} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {parsed?.params?.length > 0 && (
          <>
            <h3 className="dev-sub">
              Query parameters <span className="count">{parsed.params.length}</span>
            </h3>
            <table className="dev-table">
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Value (decoded)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {parsed.params.map(([k, v], i) => (
                  <tr key={i}>
                    <td>
                      <code>{k}</code>
                    </td>
                    <td>
                      <code>{v || <span className="dev-empty-val">empty</span>}</code>
                    </td>
                    <td className="dev-td-act">
                      <CopyBtn text={v} ghost what={`value of ${k}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </>
  )
}

// ---------- UUID ----------

function UuidTab() {
  const [opts, setOpts] = useStoredState(K('uuid-opts'), { version: 'v4', count: 5, upper: false, hyphens: true })
  const [list, setList] = useState([])
  const [countText, setCountText] = useState(String(opts.count))

  function generate(o = opts) {
    const n = Math.min(100, Math.max(1, o.count | 0))
    setList(Array.from({ length: n }, () => (o.version === 'v7' ? D.uuidv7() : D.uuidv4())))
  }

  useEffect(() => {
    generate()
    // Only on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function set(patch) {
    const next = { ...opts, ...patch }
    setOpts(next)
    if ('version' in patch || 'count' in patch) generate(next)
  }

  const shown = list.map((u) => {
    let s = opts.hyphens ? u : u.replace(/-/g, '')
    return opts.upper ? s.toUpperCase() : s
  })

  return (
    <>
      <div className="dev-toolbar">
        <SegGroup
          label="Version"
          value={opts.version}
          onChange={(v) => set({ version: v })}
          options={[
            ['v4', 'v4 random'],
            ['v7', 'v7 time-ordered'],
          ]}
        />
        <label className="dev-count">
          <span className="field-label">How many</span>
          <input
            type="number"
            className="input dev-input dev-num"
            min="1"
            max="100"
            value={countText}
            onChange={(e) => {
              setCountText(e.target.value)
              const n = parseInt(e.target.value, 10)
              if (n >= 1 && n <= 100) set({ count: n })
            }}
            onBlur={() => setCountText(String(opts.count))}
          />
        </label>
        <Check2 checked={opts.upper} onChange={(v) => set({ upper: v })}>
          Uppercase
        </Check2>
        <Check2 checked={!opts.hyphens} onChange={(v) => set({ hyphens: !v })}>
          No hyphens
        </Check2>
      </div>
      <p className="dev-hint dev-hint-top">
        {opts.version === 'v7'
          ? 'Version 7 starts with the current time in milliseconds, so new IDs sort after older ones. Good for database keys.'
          : 'Version 4 is 122 random bits from your browser’s secure random generator.'}
      </p>

      <div className="dev-uuids panel">
        <div className="dev-field-head">
          <span className="field-label">
            UUIDs <span className="count">{shown.length}</span>
          </span>
          <span className="dev-meta" />
          <div className="dev-field-actions">
            <button type="button" className="btn ghost small" onClick={() => generate()}>
              <ArrowsClockwise size={15} />
              Regenerate
            </button>
            <CopyBtn text={shown.join('\n')} label="Copy all" small what="UUIDs" />
          </div>
        </div>
        <ul className="dev-uuid-list">
          {shown.map((u, i) => (
            <li key={i}>
              <code>{u}</code>
              <CopyBtn text={u} ghost what={u} />
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

// ---------- Hash ----------

const BIG = 500 * 1024 ** 2

function HashTab() {
  const [source, setSource] = useStoredState(K('hash-src'), 'text')
  const [input, setInput] = useStoredState(K('hash'), '')
  const [fmt, setFmt] = useStoredState(K('hash-fmt'), 'hex')
  const [expected, setExpected] = useStoredState(K('hash-expected'), '')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [textResults, setTextResults] = useState({})
  const [fileResults, setFileResults] = useState({})
  const deferred = useDeferredValue(input)
  const results = source === 'text' ? textResults : fileResults
  const fileToken = useRef(0)

  // Hash text as you type.
  useEffect(() => {
    if (source !== 'text') return
    let live = true
    Promise.all(D.HASHES.map((a) => D.digest(a, deferred))).then((rs) => {
      if (live) setTextResults(Object.fromEntries(rs.map((r, i) => [D.HASHES[i], r])))
    })
    return () => {
      live = false
    }
  }, [deferred, source])

  async function onFile(files) {
    const f = files[0]
    const token = ++fileToken.current
    setErr('')
    setFile({ name: f.name, size: f.size })
    setFileResults({})
    setBusy(true)
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const rs = await Promise.all(D.HASHES.map((a) => D.digest(a, bytes)))
      if (token === fileToken.current) setFileResults(Object.fromEntries(rs.map((r, i) => [D.HASHES[i], r])))
    } catch {
      if (token === fileToken.current) setErr('Couldn’t read or hash that file. It may be too large to load into memory.')
    } finally {
      if (token === fileToken.current) setBusy(false)
    }
  }

  const fmtOut = (bytes) => (fmt === 'hex' ? D.toHexString(bytes) : D.bytesToBase64(bytes))
  const matches = expected.trim() ? D.HASHES.filter((a) => results[a] && D.hashesMatch(expected, results[a])) : []

  return (
    <>
      <div className="dev-toolbar">
        <SegGroup
          label="Source"
          value={source}
          onChange={setSource}
          options={[
            ['text', 'Text'],
            ['file', 'File'],
          ]}
        />
        <SegGroup
          label="Output format"
          value={fmt}
          onChange={setFmt}
          options={[
            ['hex', 'Hex'],
            ['base64', 'Base64'],
          ]}
        />
      </div>

      {source === 'text' ? (
        <Area id="dev-hash-in" label="Text" value={input} onChange={setInput} mono={false} placeholder="Type or paste text. It’s hashed as UTF-8." actions={<ClearBtn onClick={() => setInput('')} disabled={!input} />} />
      ) : (
        <>
          <DropZone compact multiple={false} onFiles={onFile} title={file ? 'Drop another file or click to browse' : 'Drop a file to hash, or click to browse'} />
          {file && (
            <p className="dev-hint">
              <strong>{file.name}</strong> · {formatBytes(file.size)}
              {busy && ' · Hashing…'}
            </p>
          )}
          {file?.size > BIG && (
            <p className="notice dev-note dev-warn">
              <Info size={16} weight="bold" />
              <span>This file is over 500 MB. The browser has to load all of it into memory to hash it, which may be slow or fail on some devices.</span>
            </p>
          )}
          {err && <ErrorNote>{err}</ErrorNote>}
        </>
      )}

      <ul className="dev-hashes" aria-busy={busy}>
        {D.HASHES.map((a) => {
          const out = results[a] ? fmtOut(results[a]) : ''
          const hit = matches.includes(a)
          return (
            <li key={a} className={hit ? 'hit' : ''}>
              <div className="dev-hash-head">
                <span className="dev-hash-name">{a}</span>
                {hit && (
                  <span className="dev-match">
                    <CheckCircle size={14} weight="fill" /> Matches
                  </span>
                )}
                <CopyBtn text={out} ghost what={a} />
              </div>
              <code className="dev-hash-val">{out || (source === 'file' ? '—' : '')}</code>
            </li>
          )
        })}
      </ul>

      <div className="dev-field dev-expected">
        <div className="dev-field-head">
          <label className="field-label" htmlFor="dev-hash-exp">
            Compare with an expected hash
          </label>
        </div>
        <input id="dev-hash-exp" className="input dev-input mono" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Paste a checksum (hex or Base64)" spellCheck="false" autoComplete="off" />
        <div aria-live="polite">
          {expected.trim() &&
            Object.keys(results).length > 0 &&
            (matches.length ? (
              <p className="notice ok dev-note">
                <CheckCircle size={16} weight="bold" />
                <span>Match: the {matches.join(', ')} hash is the same.</span>
              </p>
            ) : (
              <p className="notice error dev-note">
                <XCircle size={16} weight="bold" />
                <span>No match. None of the hashes above equal this value.</span>
              </p>
            ))}
        </div>
      </div>
    </>
  )
}

// ---------- JWT ----------

const CLAIMS = { exp: 'Expires', iat: 'Issued', nbf: 'Not before' }

function JwtTab() {
  const [token, setToken] = useState('')
  const now = useNow(1000)

  const res = useMemo(() => {
    if (!token.trim()) return null
    try {
      return { ok: true, ...D.decodeJwt(token) }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }, [token])

  const claims = res?.ok && res.payload && typeof res.payload === 'object' ? Object.keys(CLAIMS).filter((k) => typeof res.payload[k] === 'number') : []

  function describe(k, v) {
    const ms = v * 1000
    const rel = D.relativeTime(ms, now)
    if (k === 'exp') return ms < now ? `Expired ${rel}` : `Expires ${rel}`
    if (k === 'nbf') return ms > now ? `Not valid until ${rel}` : `Valid since ${rel}`
    return `Issued ${rel}`
  }

  const header = res?.ok ? JSON.stringify(res.header, null, 2) : ''
  const payload = res?.ok ? JSON.stringify(res.payload, null, 2) : ''

  return (
    <>
      <p className="notice dev-note dev-warn">
        <Info size={16} weight="bold" />
        <span>This only decodes the token. The signature is not verified, so don’t trust the contents. Tokens aren’t saved anywhere, not even on this device.</span>
      </p>
      <Area
        id="dev-jwt-in"
        label="Token"
        value={token}
        onChange={setToken}
        placeholder="eyJhbGciOi…"
        className="dev-jwt-in"
        actions={<ClearBtn onClick={() => setToken('')} disabled={!token} />}
      />
      <div className="dev-status" aria-live="polite">
        {res && !res.ok && <ErrorNote>{res.error}</ErrorNote>}
      </div>
      {res?.ok && (
        <>
          {claims.length > 0 && (
            <table className="dev-table dev-claims">
              <tbody>
                {claims.map((k) => {
                  const v = res.payload[k]
                  const bad = (k === "exp" && v * 1000 < now) || (k === "nbf" && v * 1000 > now)
                  const tone = bad ? " bad" : k === "exp" ? "" : " neutral"
                  return (
                    <tr key={k}>
                      <th scope="row">
                        {CLAIMS[k]} <code>{k}</code>
                      </th>
                      <td>
                        {new Date(v * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })}
                        <span className={`dev-rel${tone}`}>{describe(k, v)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div className="dev-jwt-grid">
            <div className="dev-file-out">
              <div className="dev-field-head">
                <span className="field-label">Header</span>
                <span className="dev-meta">{res.header?.alg && `alg ${res.header.alg}`}</span>
                <div className="dev-field-actions">
                  <CopyBtn text={header} ghost what="header" />
                </div>
              </div>
              <pre className="dev-pre">{header}</pre>
            </div>
            <div className="dev-file-out">
              <div className="dev-field-head">
                <span className="field-label">Payload</span>
                <span className="dev-meta" />
                <div className="dev-field-actions">
                  <CopyBtn text={payload} ghost what="payload" />
                </div>
              </div>
              <pre className="dev-pre">{payload}</pre>
            </div>
          </div>
          <div className="dev-file-out">
            <div className="dev-field-head">
              <span className="field-label">Signature</span>
              <span className="dev-meta">not verified</span>
              <div className="dev-field-actions">
                <CopyBtn text={res.signature} ghost what="signature" />
              </div>
            </div>
            <pre className="dev-pre dev-sig">{res.signature || '(empty, unsigned token)'}</pre>
          </div>
        </>
      )}
    </>
  )
}

// ---------- Timestamp ----------

function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(id)
  }, [interval])
  return now
}

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone

function TimeTab() {
  const now = useNow(250)
  const [input, setInput] = useStoredState(K('time'), '')
  const parsed = useMemo(() => D.parseTimestamp(input), [input])
  const nowSec = Math.floor(now / 1000)

  const rows = parsed
    ? [
        ['Seconds', String(Math.floor(parsed.ms / 1000))],
        ['Milliseconds', String(Math.round(parsed.ms))],
        ['ISO 8601 (UTC)', new Date(parsed.ms).toISOString()],
        [`Local (${localZone})`, D.formatLocal(parsed.ms)],
        ['UTC', D.formatLocal(parsed.ms, 'UTC')],
        ['Relative', D.relativeTime(parsed.ms, now)],
      ]
    : []

  return (
    <>
      <div className="dev-now panel">
        <div className="dev-now-item">
          <span className="field-label">Unix seconds</span>
          <code className="dev-now-val">{nowSec}</code>
          <CopyBtn text={String(nowSec)} ghost what="current Unix seconds" />
        </div>
        <div className="dev-now-item">
          <span className="field-label">Milliseconds</span>
          <code className="dev-now-val">{now}</code>
          <CopyBtn text={String(now)} ghost what="current milliseconds" />
        </div>
        <div className="dev-now-item dev-now-iso">
          <span className="field-label">ISO 8601</span>
          <code className="dev-now-val">{new Date(nowSec * 1000).toISOString().replace('.000', '')}</code>
          <CopyBtn text={new Date(nowSec * 1000).toISOString()} ghost what="current ISO time" />
        </div>
      </div>

      <div className="dev-field dev-expected">
        <div className="dev-field-head">
          <label className="field-label" htmlFor="dev-time-in">
            Convert a timestamp or date
          </label>
          <span className="dev-meta">{parsed && parsed.unit !== 'date' ? `Read as ${parsed.unit}` : parsed ? 'Read as a date' : ''}</span>
          <div className="dev-field-actions">
            <button type="button" className="btn ghost small" onClick={() => setInput(String(nowSec))}>
              Use now
            </button>
          </div>
        </div>
        <input id="dev-time-in" className="input dev-input mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder="1700000000, 1700000000000 or 2024-05-01T12:00:00Z" spellCheck="false" autoComplete="off" />
        {input.trim() && !parsed && <ErrorNote>That doesn’t look like a Unix timestamp or a date. Try seconds, milliseconds or an ISO date like 2024-05-01T12:00:00Z.</ErrorNote>}
      </div>
      {rows.length > 0 && (
        <table className="dev-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>
                  <code>{v}</code>
                </td>
                <td className="dev-td-act">
                  <CopyBtn text={v} ghost what={k} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
