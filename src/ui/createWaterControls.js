/**
 * Creates and mounts a compact water tuning panel in the page.
 * Inputs: `initialSettings` object and `onChange(partialSettings)` callback.
 * Outputs: object with `element` and `setValues()`; side effect appends panel to document body.
 * Internal: renders shallow/deep color pickers and emits updates on change.
 */
export function createWaterControls(initialSettings, onChange) {
  const panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Water controls');
  panel.style.position = 'fixed';
  panel.style.left = '12px';
  panel.style.bottom = '36px';
  panel.style.zIndex = '20';
  panel.style.padding = '12px';
  panel.style.width = '280px';
  panel.style.maxHeight = 'calc(100vh - 120px)';
  panel.style.overflowY = 'auto';
  panel.style.borderRadius = '10px';
  panel.style.background = 'rgba(10, 22, 32, 0.82)';
  panel.style.border = '1px solid rgba(255,255,255,0.14)';
  panel.style.backdropFilter = 'blur(4px)';
  panel.style.color = '#e8f6ff';
  panel.style.fontFamily = 'Inter, Segoe UI, Arial, sans-serif';
  panel.style.fontSize = '13px';

  panel.innerHTML = `
    <h2 style="margin:0 0 8px;font-size:14px;font-weight:600;">Water</h2>
    <p style="margin:0 0 10px;opacity:.82;line-height:1.35;">Tune water colours.</p>
    ${buildControl('Shallow colour', 'waterColourShallow', 'color', { value: initialSettings.waterColourShallow })}
    ${buildControl('Deep colour', 'waterColourDeep', 'color', { value: initialSettings.waterColourDeep })}
  `;

  /**
   * Parses one DOM input into a typed water settings patch.
   * Inputs: `target` as an `HTMLInputElement` from the panel.
   * Outputs: single-property patch object or `null` when invalid.
   * Internal: maps color inputs to uniform setting keys.
   */
  function parsePatch(target) {
    if (!(target instanceof HTMLInputElement)) {
      return null;
    }

    const { name } = target;
    if (!name) {
      return null;
    }

    if (target.type !== 'color') {
      return null;
    }
    return { [name]: target.value };
  }

  /**
   * Applies committed control values immediately.
   * Inputs: native DOM `change` event from the panel.
   * Outputs: invokes `onChange` with one patch object.
   * Internal: forwards final values without batching delay.
   */
  function handleChange(event) {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    const patch = parsePatch(event.target);
    if (!patch) {
      return;
    }

    onChange(patch);
  }

  panel.addEventListener('change', handleChange);
  document.body.appendChild(panel);

  /**
   * Writes settings into matching form controls without firing callbacks.
   * Inputs: `nextSettings` partial water settings object.
   * Outputs: updates color input values.
   * Internal: only applies known color fields from the provided partial object.
   */
  function setValues(nextSettings) {
    for (const [key, value] of Object.entries(nextSettings ?? {})) {
      const input = panel.querySelector(`input[name="${key}"]`);
      if (!(input instanceof HTMLInputElement)) {
        continue;
      }

      if (value === undefined || value === null) {
        continue;
      }

      input.value = String(value);
    }
  }

  /**
   * Removes the panel and detaches listeners.
   * Inputs: none.
   * Outputs: DOM cleanup side effect.
   * Internal: removes event handlers before detaching the panel element.
   */
  function destroy() {
    panel.removeEventListener('change', handleChange);
    panel.remove();
  }

  return {
    element: panel,
    setValues,
    destroy
  };
}

/**
 * Builds HTML for one labeled control row.
 * Inputs: `label`, `name`, `type`, and `attrs` key-value map.
 * Outputs: html string for a control line with optional numeric value display.
 * Internal: serializes attributes and appends a value badge for non-colour inputs.
 */
function buildControl(label, name, type, attrs) {
  const attrString = Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');

  const showValue = type !== 'color';
  return `
    <label style="display:block;margin-top:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span>${label}</span>
        ${showValue ? `<code style="font-size:11px;opacity:.85;" data-value="${name}">${attrs.value}</code>` : ''}
      </div>
      <input style="width:100%;" name="${name}" type="${type}" ${attrString} />
    </label>
  `;
}
