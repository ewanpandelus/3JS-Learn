/** Shared layout tokens for editor side panels. */
export const PANEL_Z_INDEX = '20';
export const PANEL_WIDTH_PX = '300px';
export const PANEL_INSET_PX = '12px';
export const PANEL_RADIUS_PX = '12px';
export const PANEL_FONT = 'Inter, Segoe UI, Arial, sans-serif';
export const PANEL_BACKGROUND = 'rgba(13, 19, 16, 0.92)';
export const PANEL_BORDER = '1px solid rgba(255,255,255,0.12)';
export const PANEL_TEXT = '#f4f9f3';
export const PANEL_MUTED = 'rgba(244, 249, 243, 0.72)';
export const TAB_ACTIVE_BG = 'rgba(255, 255, 255, 0.14)';
export const TAB_IDLE_BG = 'transparent';
export const ACCENT = '#5b9cff';
export const DANGER = '#ff8f9a';

/**
 * Applies base fixed-panel chrome to an editor aside element.
 * Inputs: `element` as `HTMLElement` panel root.
 * Outputs: mutates inline styles on `element`.
 * Internal: flex column shell with capped height and hidden outer overflow.
 */
export function applyPanelChrome(element) {
  element.style.position = 'fixed';
  element.style.top = `${PANEL_INSET_PX}`;
  element.style.left = `${PANEL_INSET_PX}`;
  element.style.zIndex = PANEL_Z_INDEX;
  element.style.width = PANEL_WIDTH_PX;
  element.style.maxHeight = `calc(100vh - ${Number.parseInt(PANEL_INSET_PX, 10) * 2}px)`;
  element.style.display = 'flex';
  element.style.flexDirection = 'column';
  element.style.overflow = 'hidden';
  element.style.borderRadius = PANEL_RADIUS_PX;
  element.style.padding = '0';
  element.style.background = PANEL_BACKGROUND;
  element.style.border = PANEL_BORDER;
  element.style.backdropFilter = 'blur(8px)';
  element.style.color = PANEL_TEXT;
  element.style.fontFamily = PANEL_FONT;
  element.style.fontSize = '13px';
  element.style.boxSizing = 'border-box';
  element.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.35)';
}

/**
 * Builds HTML for one labeled control row.
 * Inputs: `label`, `name`, `type`, and `attrs` key-value map.
 * Outputs: html string for a control line with optional numeric value display.
 * Internal: serializes attributes and appends a value badge for non-colour inputs.
 */
export function buildControl(label, name, type, attrs) {
  const attrString = Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');

  const showValue = type !== 'color' && type !== 'checkbox';
  return `
    <label class="editor-control">
      <div class="editor-control__head">
        <span>${label}</span>
        ${showValue ? `<code class="editor-control__value" data-value="${name}">${attrs.value}</code>` : ''}
      </div>
      <input class="editor-control__input" name="${name}" type="${type}" ${attrString} />
    </label>
  `;
}

/**
 * Injects editor panel stylesheet once per page.
 * Inputs: none.
 * Outputs: adds `<style id="editor-panel-styles">` when missing.
 * Internal: defines tabs, accordion layers, and compact control spacing.
 */
export function ensurePanelStyles() {
  if (document.getElementById('editor-panel-styles')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'editor-panel-styles';
  style.textContent = `
    .editor-panel__header {
      padding: 14px 14px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-shrink: 0;
    }
    .editor-panel__title {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    .editor-panel__hint {
      margin: 6px 0 0;
      color: ${PANEL_MUTED};
      line-height: 1.4;
      font-size: 12px;
    }
    .editor-tabs {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-shrink: 0;
    }
    .editor-tab {
      border: 0;
      border-radius: 8px;
      padding: 8px 4px;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      color: ${PANEL_TEXT};
      background: ${TAB_IDLE_BG};
      cursor: pointer;
    }
    .editor-tab[aria-selected="true"] {
      background: ${TAB_ACTIVE_BG};
      color: #fff;
    }
    .editor-panel__body {
      overflow-y: auto;
      padding: 12px 14px 14px;
      flex: 1;
      min-height: 0;
    }
    .editor-tab-panel[hidden] { display: none; }
    .editor-section-title {
      margin: 0 0 10px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${PANEL_MUTED};
    }
    .editor-control {
      display: block;
      margin-top: 10px;
    }
    .editor-control__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 5px;
      gap: 8px;
    }
    .editor-control__value {
      font-size: 11px;
      opacity: 0.85;
    }
    .editor-control__input {
      width: 100%;
      box-sizing: border-box;
    }
    .editor-layer {
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      margin-top: 8px;
      background: rgba(255,255,255,0.03);
      overflow: hidden;
    }
    .editor-layer > summary {
      list-style: none;
      cursor: pointer;
      padding: 10px 10px 10px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .editor-layer > summary::-webkit-details-marker { display: none; }
    .editor-layer__title { font-weight: 600; flex: 1; }
    .editor-layer__meta {
      font-size: 11px;
      color: ${PANEL_MUTED};
      white-space: nowrap;
    }
    .editor-layer__body { padding: 0 12px 12px; }
    .editor-btn {
      border: 0;
      border-radius: 8px;
      padding: 9px 12px;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .editor-btn--primary {
      width: 100%;
      margin-top: 10px;
      background: ${ACCENT};
      color: #0b1220;
    }
    .editor-btn--ghost {
      background: rgba(255,255,255,0.1);
      color: ${PANEL_TEXT};
      padding: 4px 8px;
      font-size: 11px;
    }
    .editor-btn--danger {
      background: rgba(255, 143, 154, 0.18);
      color: ${DANGER};
      padding: 4px 8px;
      font-size: 11px;
    }
    .editor-empty {
      margin: 0;
      padding: 14px 10px;
      text-align: center;
      color: ${PANEL_MUTED};
      border: 1px dashed rgba(255,255,255,0.16);
      border-radius: 10px;
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
}
