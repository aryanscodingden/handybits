import { useEffect, useRef, useState } from 'react'
import { UploadSimple } from '@phosphor-icons/react'

// Click or drop files. `accept` and `multiple` are passed to the file input;
// dropped files are filtered by the caller, since drag and drop ignores accept.
export default function DropZone({ onFiles, accept, multiple = true, title, sub, button = multiple ? 'Choose files' : 'Choose a file', compact = false }) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const input = useRef(null)

  // Dropping a file outside the zone shouldn't navigate the tab away.
  useEffect(() => {
    const stop = (e) => e.preventDefault()
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])

  return (
    <div
      className={`drop${over ? ' over' : ''}${compact ? ' compact' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click())}
      onDragEnter={(e) => {
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        depth.current = 0
        setOver(false)
        const files = [...e.dataTransfer.files]
        if (files.length) onFiles(multiple ? files : files.slice(0, 1))
      }}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = [...e.target.files]
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
      <span className="drop-icon" aria-hidden="true">
        <UploadSimple size={22} weight="bold" />
      </span>
      <p className="drop-title">{over ? 'Drop to add' : title || (multiple ? 'Drop files here or click to browse' : 'Drop a file here or click to browse')}</p>
      {sub && <p className="drop-sub">{sub}</p>}
      {!compact && (
        <span className="btn small drop-btn" aria-hidden="true">
          {button}
        </span>
      )}
    </div>
  )
}
