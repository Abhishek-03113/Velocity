import { useShallow } from 'zustand/react/shallow'
import { ACCENTS, useUiStore, type Accent } from '../../store/uiStore'
import { THEME_FAMILIES, getThemeFamily, swatchFor, type ThemeFamily, type Appearance } from '../../lib/themes'
import { Icon } from '../Icon'
import { Segmented } from '../ui/Segmented'
import { Sheet } from './Sheet'
import styles from './Overlays.module.css'

const ACCENT_LABELS: Record<Accent, string> = {
  theme: 'Theme default',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  graphite: 'Graphite',
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingLabel}>
        <span>{label}</span>
        {hint && <span className={styles.settingHint}>{hint}</span>}
      </div>
      <div className={styles.settingControl}>{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`${styles.switch} ${checked ? styles.switchOn : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchKnob} />
    </button>
  )
}

/** Mini window drawn in the theme's own colours: sidebar, text lines and an accent pill. */
function ThemeCard({
  family,
  appearance,
  selected,
  onSelect,
}: {
  family: ThemeFamily
  appearance: Appearance
  selected: boolean
  onSelect: () => void
}) {
  const sw = swatchFor(family, appearance)
  const modes = family.appearances.length === 2 ? 'Light & Dark' : family.appearances[0] === 'dark' ? 'Dark only' : 'Light only'
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={family.name}
      title={`${family.name} · ${modes} · ${family.accentName} accent`}
      className={`${styles.themeCard} ${selected ? styles.themeCardSelected : ''}`}
      data-theme-card={family.id}
      onClick={onSelect}
    >
      <span className={styles.themePreview} style={{ background: sw.bg, color: sw.text }} aria-hidden="true">
        <span className={styles.themePreviewSidebar} style={{ background: sw.sidebar }}>
          <i style={{ background: sw.accent }} />
          <i />
          <i />
        </span>
        <span className={styles.themePreviewBody}>
          <b />
          <i />
          <i />
          <em style={{ background: sw.accent }} />
        </span>
      </span>
      <span className={styles.themeName}>{family.name}</span>
      <span className={styles.themeModes}>{modes}</span>
    </button>
  )
}

/** Settings (⌘,) — grouped inset rows in the style of System Settings. */
export default function SettingsSheet() {
  const { prefs, resolvedTheme, setPref, setThemeFamily, setSettingsOpen } = useUiStore(
    useShallow((s) => ({
      prefs: s.prefs,
      resolvedTheme: s.resolvedTheme,
      setPref: s.setPref,
      setThemeFamily: s.setThemeFamily,
      setSettingsOpen: s.setSettingsOpen,
    })),
  )
  const family = getThemeFamily(prefs.themeFamily)
  const close = () => setSettingsOpen(false)

  return (
    <Sheet title="Settings" onClose={close} width={600}>
      <h3 className={styles.groupHeading}>Appearance</h3>
      <div className={styles.group}>
        <div className={styles.themeBlock}>
          <div className={styles.settingLabel}>
            <span>Theme</span>
            <span className={styles.settingHint}>{family.name} · {family.accentName} accent</span>
          </div>
          <div className={styles.themeGrid} role="radiogroup" aria-label="Theme">
            {THEME_FAMILIES.map((f) => (
              <ThemeCard
                key={f.id}
                family={f}
                appearance={resolvedTheme}
                selected={f.id === prefs.themeFamily}
                onSelect={() => setThemeFamily(f.id)}
              />
            ))}
          </div>
        </div>
        <Row
          label="Appearance"
          hint={family.appearances.length === 1 ? `${family.name} only has a ${family.appearances[0]} appearance` : undefined}
        >
          <Segmented
            label="Appearance"
            value={prefs.theme}
            onChange={(v) => setPref('theme', v)}
            options={[
              { value: 'system', label: 'Auto', icon: 'circle.lefthalf.filled' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Row>
        <Row label="Accent colour">
          <div className={styles.swatches} role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map((a) => {
              const label = a === 'theme' ? `Theme default (${family.name}: ${family.accentName})` : ACCENT_LABELS[a]
              return (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={prefs.accent === a}
                aria-label={label}
                title={label}
                className={`${styles.swatch} ${prefs.accent === a ? styles.swatchSelected : ''}`}
                data-swatch={a}
                onClick={() => setPref('accent', a)}
              >
                {prefs.accent === a && a !== 'theme' && <Icon name="checkmark" size={11} strokeWidth={2.6} />}
              </button>
              )
            })}
          </div>
        </Row>
        <Row label="Gaps between tiles" hint="Floating tiles with an accent border on the focused one">
          <Toggle label="Gaps between tiles" checked={prefs.tileGaps} onChange={(v) => setPref('tileGaps', v)} />
        </Row>
      </div>

      <h3 className={styles.groupHeading}>Editor</h3>
      <div className={styles.group}>
        <Row label="Font">
          <Segmented
            label="Font"
            value={prefs.editorFont}
            onChange={(v) => setPref('editorFont', v)}
            options={[
              { value: 'system', label: 'System' },
              { value: 'serif', label: 'Serif' },
              { value: 'mono', label: 'Mono' },
            ]}
          />
        </Row>
        <Row label="Text size" hint={`${prefs.editorSize} pt`}>
          <div className={styles.sliderRow}>
            <span className={styles.sliderGlyph} style={{ fontSize: 11 }}>
              A
            </span>
            <input
              type="range"
              min={12}
              max={24}
              step={1}
              value={prefs.editorSize}
              aria-label="Text size"
              className={styles.slider}
              onChange={(e) => setPref('editorSize', Number(e.target.value))}
            />
            <span className={styles.sliderGlyph} style={{ fontSize: 17 }}>
              A
            </span>
          </div>
        </Row>
        <Row label="Line width">
          <Segmented
            label="Line width"
            value={prefs.measure}
            onChange={(v) => setPref('measure', v)}
            options={[
              { value: 'narrow', label: 'Narrow' },
              { value: 'medium', label: 'Medium' },
              { value: 'wide', label: 'Wide' },
              { value: 'full', label: 'Full' },
            ]}
          />
        </Row>
        <Row label="Check spelling">
          <Toggle label="Check spelling" checked={prefs.spellcheck} onChange={(v) => setPref('spellcheck', v)} />
        </Row>
      </div>

      <h3 className={styles.groupHeading}>Notes list</h3>
      <div className={styles.group}>
        <Row label="Sort by">
          <Segmented
            label="Sort by"
            value={prefs.sort}
            onChange={(v) => setPref('sort', v)}
            options={[
              { value: 'updated', label: 'Date Edited' },
              { value: 'title', label: 'Title' },
            ]}
          />
        </Row>
      </div>

      <p className={styles.sheetFoot}>
        Preferences are stored in this browser. Your notes are saved on your Velocity server and exported as Markdown.
      </p>
    </Sheet>
  )
}
