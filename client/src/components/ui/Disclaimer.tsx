import { C, FONT } from '../../theme'

// Aviso legal: proyecto de fans, no oficial, en beta. Va en el login y en el lobby.
export const OFFICIAL_SITE = 'https://global.bandai-hobby.net/en-us/site/gundam-assemble/'

export function BetaBadge() {
  return (
    <span title="Versión de prueba: puede haber errores y cambios de reglas"
      style={{ fontFamily: FONT.mono, fontSize: 10.5, letterSpacing: '0.16em', color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase' }}>
      Beta
    </span>
  )
}

export function Disclaimer({ style }: { style?: React.CSSProperties }) {
  return (
    <footer role="contentinfo" style={{ fontSize: 11, lineHeight: 1.55, color: C.textDim, textAlign: 'center', maxWidth: 760, margin: '0 auto', ...style }}>
      <p>
        <b style={{ color: C.textSoft }}>Aviso:</b> todos los nombres, diseños, ilustraciones y marcas de Gundam y de Gundam Assemble
        son propiedad de ©SOTSU·SUNRISE, ©SOTSU·MBS y BANDAI SPIRITS.
      </p>
      <p>
        Esta web es un proyecto de fans <b style={{ color: C.textSoft }}>no oficial</b>, gratuito y en fase <b style={{ color: C.textSoft }}>beta</b>,
        sin licencia ni relación con Bandai ni con la marca Gundam. Apoya el juego y la franquicia oficiales en{' '}
        <a href={OFFICIAL_SITE} target="_blank" rel="noopener noreferrer" style={{ color: C.ally }}>la web oficial de Gundam Assemble</a>.
      </p>
    </footer>
  )
}
