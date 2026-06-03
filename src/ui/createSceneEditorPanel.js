import {
  createDefaultTerrainLayer,
  DEFAULT_BASE_LAYER,
  DEFAULT_ISLAND_SETTINGS
} from '../terrain/terrainLayers.js';
import { applyPanelChrome, buildControl, ensurePanelStyles } from './panelTheme.js';

const TAB_IDS = ['island', 'layers', 'paint', 'water'];

/**
 * Creates a tabbed scene editor panel (island, layers, terrain paint, water).
 * Inputs: terrain/water settings objects and change callbacks.
 * Outputs: `{ element, setTerrainValues, setWaterValues, destroy }`; mounts panel on `document.body`.
 * Internal: accordion mountain layers and RAF-batched slider updates for terrain.
 */
export function createSceneEditorPanel({
  terrainSettings,
  waterSettings,
  onTerrainChange,
  onWaterChange
}) {
  ensurePanelStyles();

  const panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Scene editor');
  applyPanelChrome(panel);

  let layers = Array.isArray(terrainSettings.layers)
    ? terrainSettings.layers.map((layer, index) => ({ ...createDefaultTerrainLayer(index), ...layer }))
    : [];
  let baseLayer = { ...DEFAULT_BASE_LAYER, ...terrainSettings.baseLayer };
  let island = { ...DEFAULT_ISLAND_SETTINGS, ...terrainSettings.island };
  let colorLow = terrainSettings.colorLow;
  let colorHigh = terrainSettings.colorHigh;
  let water = { ...waterSettings };

  let activeTab = 'island';
  let pendingTerrainPatch = {};
  let terrainFrameRequestId = null;

  panel.innerHTML = `
    <header class="editor-panel__header">
      <h2 class="editor-panel__title">Scene editor</h2>
      <p class="editor-panel__hint">Island, layers, paint, and water — one panel, less scrolling.</p>
    </header>
    <div class="editor-tabs" role="tablist" aria-label="Editor sections">
      ${TAB_IDS.map((tabId) => `
        <button type="button" class="editor-tab" role="tab" data-tab="${tabId}" aria-selected="false" aria-controls="editor-tab-${tabId}">
          ${tabLabel(tabId)}
        </button>
      `).join('')}
    </div>
    <div class="editor-panel__body" data-editor-body></div>
  `;

  const body = panel.querySelector('[data-editor-body]');
  document.body.appendChild(panel);

  /**
   * Returns a short human label for a tab id.
   * Inputs: `tabId` string key.
   * Outputs: display label string.
   * Internal: maps internal ids to compact tab captions.
   */
  function tabLabel(tabId) {
    if (tabId === 'island') {
      return 'Island';
    }
    if (tabId === 'layers') {
      return 'Layers';
    }
    if (tabId === 'paint') {
      return 'Paint';
    }
    return 'Water';
  }

  /**
   * Emits the current base layer and mountain layer stack to the terrain renderer.
   * Inputs: none; reads module-level `baseLayer` and `layers`.
   * Outputs: invokes `onTerrainChange` with `{ baseLayer, layers }`.
   * Internal: clones layer objects so downstream state does not share panel references.
   */
  function emitTerrainLayers() {
    onTerrainChange({
      baseLayer: { ...baseLayer },
      layers: layers.map((layer, index) => ({ ...createDefaultTerrainLayer(index), ...layer }))
    });
  }

  /**
   * Builds a unique input name for one mountain layer field.
   * Inputs: `index` layer index, `field` property key string.
   * Outputs: namespaced name string (e.g. `layer-1-octaves`).
   * Internal: avoids duplicate `name` attributes across accordion sections.
   */
  function layerInputName(index, field) {
    return `layer-${index}-${field}`;
  }

  /**
   * Reads one layer panel's inputs into a layer settings object.
   * Inputs: `layerPanel` element with `data-layer-panel` and `data-layer-index`.
   * Outputs: partial layer settings from visible sliders only, or `null` when invalid.
   * Internal: does not read persistence (no UI); caller merges with previous layer state.
   */
  function readLayerFromPanel(layerPanel) {
    if (!(layerPanel instanceof HTMLElement)) {
      return null;
    }

    const index = Number(layerPanel.getAttribute('data-layer-index'));
    if (!Number.isInteger(index)) {
      return null;
    }

    const readNumber = (field) => {
      const input = layerPanel.querySelector(`input[name="${layerInputName(index, field)}"]`);
      return input instanceof HTMLInputElement ? Number.parseFloat(input.value) : 0;
    };

    return {
      amplitude: readNumber('amplitude'),
      frequency: readNumber('frequency'),
      octaves: Math.round(readNumber('octaves')),
      lacunarity: readNumber('lacunarity'),
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
    const layerPanels = [...panel.querySelectorAll('[data-layer-panel]')];
    layers = layerPanels.map((layerPanel, index) => {
      const parsed = readLayerFromPanel(layerPanel);
      const previous = layers[index] ?? createDefaultTerrainLayer(index);
      if (!parsed) {
        return { ...createDefaultTerrainLayer(index), ...previous };
      }
      return {
        ...createDefaultTerrainLayer(index),
        ...previous,
        amplitude: parsed.amplitude,
        frequency: parsed.frequency,
        octaves: parsed.octaves,
        lacunarity: parsed.lacunarity,
        enabled: parsed.enabled
      };
    });
  }

  /**
   * Builds HTML for one collapsible mountain layer block.
   * Inputs: `layer` settings, `index`, and `isOpen` accordion state.
   * Outputs: HTML string for one `<details>` layer section.
   * Internal: summary shows live amplitude/frequency hints when collapsed.
   */
  function buildLayerPanelHtml(layer, index, isOpen) {
    const layerNumber = index + 1;
    const summaryMeta = `amp ${layer.amplitude.toFixed(2)} · freq ${layer.frequency.toFixed(2)}`;
    const openAttr = isOpen ? 'open' : '';

    return `
      <details class="editor-layer" data-layer-panel data-layer-index="${index}" ${openAttr}>
        <summary>
          <span class="editor-layer__title">Mountain ${layerNumber}</span>
          <span class="editor-layer__meta" data-layer-summary="${index}">${summaryMeta}</span>
          <button type="button" class="editor-btn editor-btn--danger" data-remove-layer="${index}">Remove</button>
        </summary>
        <div class="editor-layer__body">
          ${buildControl('Amplitude', layerInputName(index, 'amplitude'), 'range', { min: 0, max: 3, step: 0.01, value: layer.amplitude })}
          ${buildControl('Frequency', layerInputName(index, 'frequency'), 'range', { min: 0.1, max: 3, step: 0.01, value: layer.frequency })}
          ${buildControl('Octaves', layerInputName(index, 'octaves'), 'range', { min: 1, max: 8, step: 1, value: layer.octaves })}
          ${buildControl('Lacunarity', layerInputName(index, 'lacunarity'), 'range', { min: 1.2, max: 3.2, step: 0.01, value: layer.lacunarity })}
        </div>
      </details>
    `;
  }

  /**
   * Renders the active tab’s scrollable content region.
   * Inputs: none; reads `activeTab`, `baseLayer`, and `layers`.
   * Outputs: updates tab panel DOM and rebinds layer action listeners.
   * Internal: only the layers tab rebuilds accordion markup.
   */
  function renderActiveTab() {
    for (const tabButton of panel.querySelectorAll('[data-tab]')) {
      const isSelected = tabButton.getAttribute('data-tab') === activeTab;
      tabButton.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    }

    if (activeTab === 'island') {
      body.innerHTML = `
        <p class="editor-panel__hint" style="margin:0 0 12px;">Landmass shape and noisy coastline height.</p>
        <section data-island-panel>
          <p class="editor-section-title">Plateau surface</p>
          ${buildControl('Surface amplitude', 'baseAmplitude', 'range', { min: 0, max: 0.8, step: 0.01, value: baseLayer.amplitude })}
          ${buildControl('Surface frequency', 'baseFrequency', 'range', { min: 0.05, max: 1.5, step: 0.01, value: baseLayer.frequency })}
          <p class="editor-section-title" style="margin-top:14px;">Coast edge</p>
          ${buildControl('Edge noise height', 'edgeNoiseAmplitude', 'range', { min: 0, max: 0.35, step: 0.01, value: island.edgeNoiseAmplitude })}
          ${buildControl('Edge noise scale', 'edgeNoiseFrequency', 'range', { min: 0.1, max: 2, step: 0.01, value: island.edgeNoiseFrequency })}
        </section>
      `;
      return;
    }

    if (activeTab === 'layers') {
      const layersHtml = layers.length
        ? layers.map((layer, index) => buildLayerPanelHtml(layer, index, index === layers.length - 1)).join('')
        : '<p class="editor-empty">No mountain layers yet. Add one to stack hills on the island.</p>';

      body.innerHTML = `
        <p class="editor-panel__hint" style="margin:0 0 12px;">Stack noise layers; amplitude scales hills only.</p>
        <div data-layers-root>${layersHtml}</div>
        <button type="button" class="editor-btn editor-btn--primary" data-add-layer>Add mountain layer</button>
      `;

      const addButton = body.querySelector('[data-add-layer]');
      if (addButton) {
        addButton.addEventListener('click', handleAddLayer);
      }

      for (const removeButton of body.querySelectorAll('[data-remove-layer]')) {
        removeButton.addEventListener('click', handleRemoveLayer);
      }
      return;
    }

    if (activeTab === 'paint') {
      body.innerHTML = `
        <p class="editor-section-title">Terrain colours</p>
        ${buildControl('Low colour', 'colorLow', 'color', { value: colorLow })}
        ${buildControl('High colour', 'colorHigh', 'color', { value: colorHigh })}
      `;
      return;
    }

    body.innerHTML = `
      <p class="editor-panel__hint" style="margin:0 0 12px;">Shallow and deep water tints on the plane.</p>
      ${buildControl('Shallow colour', 'waterColourShallow', 'color', { value: water.waterColourShallow })}
      ${buildControl('Deep colour', 'waterColourDeep', 'color', { value: water.waterColourDeep })}
    `;
  }

  /**
   * Appends a new mountain layer and refreshes the layers tab.
   * Inputs: none.
   * Outputs: updates DOM and calls `onTerrainChange`.
   * Internal: opens the layers tab so the new entry is visible.
   */
  function handleAddLayer() {
    syncLayersFromDom();
    layers.push(createDefaultTerrainLayer(layers.length));
    activeTab = 'layers';
    renderActiveTab();
    emitTerrainLayers();
  }

  /**
   * Removes one mountain layer by index and refreshes the layers tab.
   * Inputs: click `event` from a remove button carrying `data-remove-layer`.
   * Outputs: updates DOM and calls `onTerrainChange`.
   * Internal: syncs DOM first so pending slider edits are not lost.
   */
  function handleRemoveLayer(event) {
    event.preventDefault();
    event.stopPropagation();
    const index = Number(event.currentTarget?.getAttribute('data-remove-layer'));
    if (!Number.isInteger(index)) {
      return;
    }
    syncLayersFromDom();
    layers.splice(index, 1);
    renderActiveTab();
    emitTerrainLayers();
  }

  /**
   * Updates collapsed layer summary chips after slider moves.
   * Inputs: `layerPanel` element for one mountain layer.
   * Outputs: mutates summary text when present.
   * Internal: reads amplitude/frequency inputs from the open layer body.
   */
  function updateLayerSummary(layerPanel) {
    const index = Number(layerPanel.getAttribute('data-layer-index'));
    const summary = panel.querySelector(`[data-layer-summary="${index}"]`);
    if (!summary) {
      return;
    }
    const amplitude = layerPanel.querySelector(`input[name="${layerInputName(index, 'amplitude')}"]`);
    const frequency = layerPanel.querySelector(`input[name="${layerInputName(index, 'frequency')}"]`);
    if (!(amplitude instanceof HTMLInputElement) || !(frequency instanceof HTMLInputElement)) {
      return;
    }
    summary.textContent = `amp ${Number.parseFloat(amplitude.value).toFixed(2)} · freq ${Number.parseFloat(frequency.value).toFixed(2)}`;
  }

  /**
   * Parses base or layer slider input into a terrain settings patch.
   * Inputs: `target` HTMLInputElement from the panel.
   * Outputs: queues terrain patch fields.
   * Internal: routes base panel fields to `baseLayer`, layer fields via DOM sync.
   */
  function handleTerrainControlInput(target) {
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.name === 'colorLow' || target.name === 'colorHigh') {
      return;
    }

    const valueBubble = target.closest('.editor-control')?.querySelector(`[data-value="${target.name}"]`);
    const isOctaves = target.name.endsWith('-octaves') || target.name === 'octaves';
    const nextValue = isOctaves ? Number.parseInt(target.value, 10) : Number.parseFloat(target.value);
    if (valueBubble) {
      valueBubble.textContent = String(nextValue);
    }

    const layerPanel = target.closest('[data-layer-panel]');
    if (layerPanel) {
      updateLayerSummary(layerPanel);
    }

    const inIslandPanel = target.closest('[data-island-panel]');
    if (inIslandPanel) {
      if (target.name === 'baseAmplitude') {
        baseLayer.amplitude = nextValue;
      }
      if (target.name === 'baseFrequency') {
        baseLayer.frequency = nextValue;
      }
      if (target.name === 'edgeNoiseAmplitude') {
        island.edgeNoiseAmplitude = nextValue;
      }
      if (target.name === 'edgeNoiseFrequency') {
        island.edgeNoiseFrequency = nextValue;
      }
      Object.assign(pendingTerrainPatch, {
        baseLayer: { ...baseLayer },
        island: { ...island }
      });
    } else if (layerPanel) {
      syncLayersFromDom();
      Object.assign(pendingTerrainPatch, { layers: layers.map((layer) => ({ ...layer })) });
    }

    if (terrainFrameRequestId === null) {
      terrainFrameRequestId = requestAnimationFrame(flushPendingTerrainPatch);
    }
  }

  /**
   * Flushes batched terrain slider changes at most once per frame.
   * Inputs: none; reads accumulated `pendingTerrainPatch`.
   * Outputs: invokes `onTerrainChange` and clears the queue.
   * Internal: coalesces rapid slider input events during drag gestures.
   */
  function flushPendingTerrainPatch() {
    terrainFrameRequestId = null;
    if (Object.keys(pendingTerrainPatch).length === 0) {
      return;
    }
    onTerrainChange(pendingTerrainPatch);
    pendingTerrainPatch = {};
  }

  /**
   * Handles slider input with RAF batching for terrain tabs.
   * Inputs: native DOM `input` event.
   * Outputs: queues partial patches and schedules one frame flush.
   * Internal: skips colour and water inputs.
   */
  function handleInput(event) {
    if (!(event.target instanceof HTMLInputElement) || event.target.type === 'color') {
      return;
    }
    if (event.target.name.startsWith('water')) {
      return;
    }
    handleTerrainControlInput(event.target);
  }

  /**
   * Applies committed colour changes immediately.
   * Inputs: native DOM `change` event.
   * Outputs: invokes terrain or water callbacks.
   * Internal: routes by active tab field names.
   */
  function handleChange(event) {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    if (event.target.name === 'colorLow' || event.target.name === 'colorHigh') {
      onTerrainChange({ [event.target.name]: event.target.value });
      return;
    }

    if (event.target.name === 'waterColourShallow' || event.target.name === 'waterColourDeep') {
      onWaterChange({ [event.target.name]: event.target.value });
    }
  }

  /**
   * Switches the visible editor tab.
   * Inputs: click `event` from a tab button.
   * Outputs: updates `activeTab` and re-renders tab body.
   * Internal: preserves layer slider state by syncing DOM before leaving layers tab.
   */
  function handleTabClick(event) {
    const tabButton = event.target.closest('[data-tab]');
    if (!(tabButton instanceof HTMLButtonElement)) {
      return;
    }
    if (activeTab === 'layers') {
      syncLayersFromDom();
    }
    activeTab = tabButton.getAttribute('data-tab') ?? 'island';
    renderActiveTab();
  }

  panel.querySelector('.editor-tabs')?.addEventListener('click', handleTabClick);
  panel.addEventListener('input', handleInput);
  panel.addEventListener('change', handleChange);

  renderActiveTab();

  /**
   * Writes terrain settings into controls and re-renders layers when needed.
   * Inputs: `nextSettings` partial terrain settings object.
   * Outputs: updates base/layer state and visible tab fields.
   * Internal: re-renders layers tab content when the layers array length changes.
   */
  function setTerrainValues(nextSettings) {
    if (nextSettings?.baseLayer) {
      baseLayer = { ...baseLayer, ...nextSettings.baseLayer };
    }
    if (nextSettings?.island) {
      island = { ...island, ...nextSettings.island };
    }
    if (Array.isArray(nextSettings?.layers)) {
      layers = nextSettings.layers.map((layer, index) => ({
        ...createDefaultTerrainLayer(index),
        ...layer
      }));
    }
    if (typeof nextSettings?.colorLow === 'string') {
      colorLow = nextSettings.colorLow;
    }
    if (typeof nextSettings?.colorHigh === 'string') {
      colorHigh = nextSettings.colorHigh;
    }

    renderActiveTab();

    for (const [key, value] of Object.entries(nextSettings ?? {})) {
      if (key === 'baseLayer' || key === 'island' || key === 'layers') {
        continue;
      }
      const input = panel.querySelector(`input[name="${key}"]`);
      if (input instanceof HTMLInputElement && value !== undefined && value !== null) {
        input.value = String(value);
      }
    }
  }

  /**
   * Writes water colour pickers without firing callbacks.
   * Inputs: `nextSettings` partial water settings object.
   * Outputs: updates water tab inputs when that tab is rendered.
   * Internal: only applies shallow/deep colour keys.
   */
  function setWaterValues(nextSettings) {
    water = { ...water, ...nextSettings };
    if (activeTab === 'water') {
      renderActiveTab();
      return;
    }
    for (const [key, value] of Object.entries(nextSettings ?? {})) {
      const input = panel.querySelector(`input[name="${key}"]`);
      if (!(input instanceof HTMLInputElement) || value === undefined || value === null) {
        continue;
      }
      input.value = String(value);
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
    if (terrainFrameRequestId !== null) {
      cancelAnimationFrame(terrainFrameRequestId);
    }
    panel.remove();
  }

  return {
    element: panel,
    setTerrainValues,
    setWaterValues,
    destroy
  };
}
