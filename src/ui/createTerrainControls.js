import { createDefaultTerrainLayer, DEFAULT_BASE_LAYER } from '../terrain/terrainLayers.js';

/**
 * Creates and mounts a terrain control panel with base island and stackable mountain layers.
 * Inputs: `initialSettings` object and `onChange(partialSettings)` callback.
 * Outputs: object with `element`, `setValues()`, and `destroy()`; appends panel to document body.
 * Internal: base plateau sliders plus dynamic per-layer controls and add/remove layer actions.
 */
export function createTerrainControls(initialSettings, onChange) {
  const panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Terrain controls');
  panel.style.position = 'fixed';
  panel.style.top = '12px';
  panel.style.left = '12px';
  panel.style.zIndex = '20';
  panel.style.padding = '12px';
  panel.style.width = '300px';
  panel.style.maxHeight = 'calc(100vh - 24px)';
  panel.style.overflowY = 'auto';
  panel.style.borderRadius = '10px';
  panel.style.background = 'rgba(13, 19, 16, 0.78)';
  panel.style.border = '1px solid rgba(255,255,255,0.14)';
  panel.style.backdropFilter = 'blur(4px)';
  panel.style.color = '#f4f9f3';
  panel.style.fontFamily = 'Inter, Segoe UI, Arial, sans-serif';
  panel.style.fontSize = '13px';

  let layers = Array.isArray(initialSettings.layers)
    ? initialSettings.layers.map((layer, index) => ({ ...createDefaultTerrainLayer(index), ...layer }))
    : [];
  let baseLayer = { ...DEFAULT_BASE_LAYER, ...initialSettings.baseLayer };
  let colorLow = initialSettings.colorLow;
  let colorHigh = initialSettings.colorHigh;

  let pendingPatch = {};
  let frameRequestId = null;

  /**
   * Emits the current base layer and mountain layer stack to the terrain renderer.
   * Inputs: none; reads module-level `baseLayer` and `layers`.
   * Outputs: invokes `onChange` with `{ baseLayer, layers }`.
   * Internal: clones layer objects so downstream state does not share panel references.
   */
  function emitTerrainLayers() {
    onChange({
      baseLayer: { ...baseLayer },
      layers: layers.map((layer, index) => ({ ...createDefaultTerrainLayer(index), ...layer }))
    });
  }

  /**
   * Reads one layer panel's inputs into a layer settings object.
   * Inputs: `layerPanel` element with `data-layer-index`.
   * Outputs: layer settings object or `null` when panel is invalid.
   * Internal: queries named inputs inside the layer panel subtree.
   */
  function readLayerFromPanel(layerPanel) {
    if (!(layerPanel instanceof HTMLElement)) {
      return null;
    }

    const readNumber = (name) => {
      const input = layerPanel.querySelector(`input[name="${name}"]`);
      return input instanceof HTMLInputElement ? Number.parseFloat(input.value) : 0;
    };

    return {
      amplitude: readNumber('amplitude'),
      frequency: readNumber('frequency'),
      octaves: Math.round(readNumber('octaves')),
      lacunarity: readNumber('lacunarity'),
      persistence: readNumber('persistence'),
      enabled: true
    };
  }

  /**
   * Re-syncs the `layers` array from all layer panels in the DOM.
   * Inputs: none.
   * Outputs: mutates module-level `layers`.
   * Internal: preserves seed/offset fields from existing entries when indices match.
   */
  function syncLayersFromDom() {
    const panels = [...panel.querySelectorAll('[data-layer-panel]')];
    layers = panels.map((layerPanel, index) => {
      const parsed = readLayerFromPanel(layerPanel);
      const previous = layers[index] ?? createDefaultTerrainLayer(index);
      return {
        ...createDefaultTerrainLayer(index),
        ...previous,
        ...parsed
      };
    });
  }

  /**
   * Builds HTML for one mountain layer control group.
   * Inputs: `layer` settings and `index` display/layer index.
   * Outputs: HTML string for one layer section.
   * Internal: amplitude slider label clarifies it scales noise displacement only.
   */
  function buildLayerPanelHtml(layer, index) {
    const layerNumber = index + 1;
    return `
      <section data-layer-panel data-layer-index="${index}" style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.12);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <strong style="font-size:13px;">Mountain layer ${layerNumber}</strong>
          <button type="button" data-remove-layer="${index}" style="font-size:11px;padding:2px 8px;cursor:pointer;">Remove</button>
        </div>
        ${buildControl('Amplitude (noise scale)', 'amplitude', 'range', { min: 0, max: 3, step: 0.01, value: layer.amplitude })}
        ${buildControl('Frequency', 'frequency', 'range', { min: 0, max: 3, step: 0.01, value: layer.frequency })}
        ${buildControl('Octaves', 'octaves', 'range', { min: 0, max: 8, step: 1, value: layer.octaves })}
        ${buildControl('Lacunarity', 'lacunarity', 'range', { min: 0, max: 3.2, step: 0.01, value: layer.lacunarity })}
      </section>
    `;
  }

  /**
   * Re-renders the panel body from current base and layer state.
   * Inputs: none.
   * Outputs: updates panel DOM and rebinds layer action listeners.
   * Internal: preserves header/colors, rebuilds layer list and base section.
   */
  function renderPanel() {
    const colorsHtml = `
      ${buildControl('Low Color', 'colorLow', 'color', { value: colorLow })}
      ${buildControl('High Color', 'colorHigh', 'color', { value: colorHigh })}
    `;

    panel.innerHTML = `
      <h2 style="margin:0 0 8px;font-size:14px;font-weight:600;">Terrain Generator</h2>
      <p style="margin:0 0 10px;opacity:.82;line-height:1.35;">
        Island base sets the landmass. Mountain layers stack noise on top; amplitude scales hills only.
      </p>
      <section data-base-panel>
        <strong style="font-size:13px;">Island base (layer 1)</strong>
        ${buildControl('Surface amplitude', 'baseAmplitude', 'range', { min: 0, max: 0.8, step: 0.01, value: baseLayer.amplitude })}
        ${buildControl('Surface frequency', 'baseFrequency', 'range', { min: 0, max: 1.5, step: 0.01, value: baseLayer.frequency })}
      </section>
      <div data-layers-root>
        ${layers.map((layer, index) => buildLayerPanelHtml(layer, index)).join('')}
      </div>
      <button type="button" data-add-layer style="margin-top:12px;width:100%;padding:8px;cursor:pointer;">
        Add mountain layer
      </button>
      <section style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.12);">
        ${colorsHtml}
      </section>
    `;

    const addButton = panel.querySelector('[data-add-layer]');
    if (addButton) {
      addButton.addEventListener('click', handleAddLayer);
    }

    for (const removeButton of panel.querySelectorAll('[data-remove-layer]')) {
      removeButton.addEventListener('click', handleRemoveLayer);
    }
  }

  /**
   * Appends a new mountain layer and refreshes the panel.
   * Inputs: none.
   * Outputs: updates DOM and calls `onChange`.
   * Internal: uses next index for unique seed/offset via `createDefaultTerrainLayer`.
   */
  function handleAddLayer() {
    syncLayersFromDom();
    layers.push(createDefaultTerrainLayer(layers.length));
    renderPanel();
    emitTerrainLayers();
  }

  /**
   * Removes one mountain layer by index and refreshes the panel.
   * Inputs: click `event` from a remove button carrying `data-remove-layer`.
   * Outputs: updates DOM and calls `onChange`.
   * Internal: syncs DOM first so pending slider edits are not lost.
   */
  function handleRemoveLayer(event) {
    const index = Number(event.currentTarget?.getAttribute('data-remove-layer'));
    if (!Number.isInteger(index)) {
      return;
    }
    syncLayersFromDom();
    layers.splice(index, 1);
    renderPanel();
    emitTerrainLayers();
  }

  /**
   * Parses base or layer slider/color input into a settings patch.
   * Inputs: `target` HTMLInputElement from the panel.
   * Outputs: void; schedules or emits layer updates.
   * Internal: routes base panel fields to `baseLayer`, layer fields via DOM sync.
   */
  function handleControlInput(target) {
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.name === 'colorLow' || target.name === 'colorHigh') {
      return;
    }

    const valueBubble = panel.querySelector(`[data-value="${target.name}"]`);
    const nextValue =
      target.name === 'octaves' ? Number.parseInt(target.value, 10) : Number.parseFloat(target.value);
    if (valueBubble) {
      valueBubble.textContent = String(nextValue);
    }

    const inBasePanel = target.closest('[data-base-panel]');
    if (inBasePanel) {
      if (target.name === 'baseAmplitude') {
        baseLayer.amplitude = nextValue;
      }
      if (target.name === 'baseFrequency') {
        baseLayer.frequency = nextValue;
      }
      Object.assign(pendingPatch, { baseLayer: { ...baseLayer } });
    } else if (target.closest('[data-layer-panel]')) {
      syncLayersFromDom();
      Object.assign(pendingPatch, { layers: layers.map((layer, index) => ({ ...layer })) });
    }

    if (frameRequestId === null) {
      frameRequestId = requestAnimationFrame(flushPendingPatch);
    }
  }

  /**
   * Flushes batched slider changes at most once per frame.
   * Inputs: none; reads accumulated `pendingPatch`.
   * Outputs: invokes `onChange` and clears the queue.
   * Internal: coalesces rapid slider input events during drag gestures.
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
   * Handles slider input with RAF batching.
   * Inputs: native DOM `input` event.
   * Outputs: queues partial patches and schedules one frame flush.
   * Internal: skips colour inputs to avoid redundant updates while dragging pickers.
   */
  function handleInput(event) {
    if (!(event.target instanceof HTMLInputElement) || event.target.type === 'color') {
      return;
    }
    handleControlInput(event.target);
  }

  /**
   * Applies committed colour changes immediately.
   * Inputs: native DOM `change` event.
   * Outputs: invokes `onChange` with colour patch.
   * Internal: forwards final colour picker values without batching delay.
   */
  function handleChange(event) {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }
    if (event.target.name === 'colorLow' || event.target.name === 'colorHigh') {
      onChange({ [event.target.name]: event.target.value });
    }
  }

  renderPanel();
  panel.addEventListener('input', handleInput);
  panel.addEventListener('change', handleChange);
  document.body.appendChild(panel);

  /**
   * Writes settings into matching form controls without firing callbacks.
   * Inputs: `nextSettings` partial terrain settings object.
   * Outputs: updates base/layer state and re-renders when layers array changes.
   * Internal: replaces layer list when length differs, otherwise updates color inputs only.
   */
  function setValues(nextSettings) {
    if (nextSettings?.baseLayer) {
      baseLayer = { ...baseLayer, ...nextSettings.baseLayer };
    }
    if (Array.isArray(nextSettings?.layers)) {
      layers = nextSettings.layers.map((layer, index) => ({
        ...createDefaultTerrainLayer(index),
        ...layer
      }));
      renderPanel();
    }

    if (typeof nextSettings?.colorLow === 'string') {
      colorLow = nextSettings.colorLow;
    }
    if (typeof nextSettings?.colorHigh === 'string') {
      colorHigh = nextSettings.colorHigh;
    }

    for (const [key, value] of Object.entries(nextSettings ?? {})) {
      if (key === 'baseLayer' || key === 'layers') {
        continue;
      }
      const input = panel.querySelector(`input[name="${key}"]`);
      if (input instanceof HTMLInputElement && value !== undefined && value !== null) {
        input.value = String(value);
      }
    }
  }

  /**
   * Removes the panel and detaches listeners.
   * Inputs: none.
   * Outputs: DOM cleanup side effect.
   * Internal: cancels any pending animation frame before removing the element.
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
