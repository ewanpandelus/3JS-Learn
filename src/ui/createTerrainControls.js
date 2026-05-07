/**
 * Creates and mounts a compact terrain control panel in the page.
 * Inputs: `initialSettings` object and `onChange(partialSettings)` callback.
 * Outputs: object with `element` and `destroy()`; side effect appends panel to document body.
 * Internal: renders range/number/color/checkbox inputs, batches rapid slider updates per frame, and emits typed setting patches.
 */
export function createTerrainControls(initialSettings, onChange) {
  const panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Terrain controls');
  panel.style.position = 'fixed';
  panel.style.top = '12px';
  panel.style.left = '12px';
  panel.style.zIndex = '20';
  panel.style.padding = '12px';
  panel.style.width = '280px';
  panel.style.borderRadius = '10px';
  panel.style.background = 'rgba(13, 19, 16, 0.78)';
  panel.style.border = '1px solid rgba(255,255,255,0.14)';
  panel.style.backdropFilter = 'blur(4px)';
  panel.style.color = '#f4f9f3';
  panel.style.fontFamily = 'Inter, Segoe UI, Arial, sans-serif';
  panel.style.fontSize = '13px';

  panel.innerHTML = `
    <h2 style="margin:0 0 8px;font-size:14px;font-weight:600;">Terrain Generator</h2>
    <p style="margin:0 0 10px;opacity:.82;line-height:1.35;">Adjust parameters to regenerate terrain in real time.</p>
    ${buildControl('Amplitude', 'amplitude', 'range', { min: 0, max: 4, step: 0.01, value: initialSettings.amplitude })}
    ${buildControl('Sea Level', 'seaLevel', 'range', { min: -1.2, max: 1.2, step: 0.01, value: initialSettings.seaLevel })}
    ${buildControl('Island Radius', 'islandRadius', 'range', { min: 0.2, max: 0.9, step: 0.01, value: initialSettings.islandRadius })}
    ${buildControl('Island Falloff', 'islandFalloff', 'range', { min: 0.08, max: 0.8, step: 0.01, value: initialSettings.islandFalloff })}
    ${buildControl('Coastal Shelf', 'coastalShelf', 'range', { min: 0.05, max: 0.9, step: 0.01, value: initialSettings.coastalShelf })}
    ${buildControl('Slope Smoothing', 'slopeSmoothing', 'range', { min: 0, max: 0.85, step: 0.01, value: initialSettings.slopeSmoothing })}
    ${buildControl('Edge Warp Start', 'edgeWarpStart', 'range', { min: 0.45, max: 0.95, step: 0.01, value: initialSettings.edgeWarpStart })}
    ${buildControl('Edge Warp Strength', 'edgeWarpStrength', 'range', { min: 0, max: 2.2, step: 0.01, value: initialSettings.edgeWarpStrength })}
    ${buildControl('Edge Warp Frequency', 'edgeWarpFrequency', 'range', { min: 0.1, max: 1.4, step: 0.01, value: initialSettings.edgeWarpFrequency })}
    ${buildControl('Frequency', 'frequency', 'range', { min: 0.1, max: 3, step: 0.01, value: initialSettings.frequency })}
    ${buildControl('Octaves', 'octaves', 'range', { min: 1, max: 8, step: 1, value: initialSettings.octaves })}
    ${buildControl('Lacunarity', 'lacunarity', 'range', { min: 1.2, max: 3.2, step: 0.01, value: initialSettings.lacunarity })}
    ${buildControl('Persistence', 'persistence', 'range', { min: 0.2, max: 0.9, step: 0.01, value: initialSettings.persistence })}
    ${buildControl('Seed', 'seed', 'number', { min: 0, max: 1000000, step: 1, value: initialSettings.seed })}
    ${buildControl('Low Color', 'colorLow', 'color', { value: initialSettings.colorLow })}
    ${buildControl('High Color', 'colorHigh', 'color', { value: initialSettings.colorHigh })}
    <label style="display:flex;align-items:center;gap:8px;margin-top:8px;">
      <input type="checkbox" name="wireframe" ${initialSettings.wireframe ? 'checked' : ''} />
      <span>Wireframe</span>
    </label>
  `;

  let pendingPatch = {};
  let frameRequestId = null;

  /**
   * Parses one DOM input value into a typed terrain setting patch.
   * Inputs: `target` as an `HTMLInputElement` from the controls panel.
   * Outputs: single-property patch object or `null` when target is invalid.
   * Internal: maps checkbox/color/integer/float controls to the expected runtime setting types.
   */
  function parsePatch(target) {
    if (!(target instanceof HTMLInputElement)) {
      return null;
    }

    const { name } = target;
    if (!name) {
      return null;
    }

    let nextValue;
    if (target.type === 'checkbox') {
      nextValue = target.checked;
    } else if (target.type === 'color') {
      nextValue = target.value;
    } else if (name === 'octaves' || name === 'seed') {
      nextValue = Number.parseInt(target.value, 10);
    } else {
      nextValue = Number.parseFloat(target.value);
    }

    const valueBubble = panel.querySelector(`[data-value="${name}"]`);
    if (valueBubble && target.type !== 'color' && target.type !== 'checkbox') {
      valueBubble.textContent = String(nextValue);
    }

    return { [name]: nextValue };
  }

  /**
   * Flushes batched UI changes to terrain state at most once per frame.
   * Inputs: none; reads accumulated `pendingPatch`.
   * Outputs: invokes `onChange` with merged patch and resets pending queue.
   * Internal: coalesces rapid slider events into a single update to reduce CPU work during dragging.
   */
  function flushPendingPatch() {
    frameRequestId = null;
    if (Object.keys(pendingPatch).length === 0) {
      return;
    }

    onChange(pendingPatch);
    pendingPatch = {};
  }

  /**
   * Handles high-frequency control events (sliders/number fields) with RAF batching.
   * Inputs: native DOM `event` from the panel.
   * Outputs: queues partial setting updates and schedules one frame flush.
   * Internal: ignores color inputs here to avoid excessive recolor calls while color picker drags.
   */
  function handleInput(event) {
    if (!(event.target instanceof HTMLInputElement) || event.target.type === 'color') {
      return;
    }

    const patch = parsePatch(event.target);
    if (!patch) {
      return;
    }

    Object.assign(pendingPatch, patch);
    if (frameRequestId === null) {
      frameRequestId = requestAnimationFrame(flushPendingPatch);
    }
  }

  /**
   * Handles low-frequency updates that should apply immediately.
   * Inputs: native DOM `change` event from color/checkbox/number controls.
   * Outputs: emits one immediate setting patch through `onChange`.
   * Internal: parses and forwards final committed values, including color picker commits.
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

  panel.addEventListener('input', handleInput);
  panel.addEventListener('change', handleChange);
  document.body.appendChild(panel);

  /**
   * Removes the controls panel and listeners from the DOM.
   * Inputs: none.
   * Outputs: side effect cleanup of event handlers and panel element.
   * Internal: detaches listeners first, then removes mounted element.
   */
  function destroy() {
    panel.removeEventListener('input', handleInput);
    panel.removeEventListener('change', handleChange);
    if (frameRequestId !== null) {
      cancelAnimationFrame(frameRequestId);
    }
    panel.remove();
  }

  return {
    element: panel,
    destroy
  };
}

/**
 * Builds HTML for one labeled control row.
 * Inputs: `label`, `name`, `type`, and `attrs` key-value map.
 * Outputs: html string for a control line with current value display when relevant.
 * Internal: serializes attributes and conditionally appends a numeric value badge.
 */
function buildControl(label, name, type, attrs) {
  const attrString = Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');

  const showValue = type !== 'color' && type !== 'checkbox';
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
