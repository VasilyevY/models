const elements = {
    viewport: document.getElementById("viewport"),
    loadingOverlay: document.getElementById("loading-overlay"),
    loadingMessage: document.getElementById("loading-message"),
    statusText: document.getElementById("status-text"),
    workspace: document.querySelector(".workspace"),
    viewportHint: document.getElementById("viewport-hint"),
    viewportToolbar: document.querySelector(".viewport-toolbar"),
    displayModeButtons: Array.from(document.querySelectorAll("[data-display-mode]")),
    zoomIn: document.getElementById("zoom-in"),
    zoomOut: document.getElementById("zoom-out"),
    backgroundColor: document.getElementById("background-color"),
    backgroundSwatchFill: document.getElementById("background-swatch-fill"),
    statusBar: document.querySelector(".status-bar")
};

const BASE_LIGHT_HEMISPHERE_INTENSITY = 0.75;
const BASE_LIGHT_FILL_MULTIPLIER = 2;
const BASE_LIGHT_FILL_INTENSITY = BASE_LIGHT_HEMISPHERE_INTENSITY * BASE_LIGHT_FILL_MULTIPLIER;
const BASE_LIGHT_AMBIENT_INTENSITY = 0.5;
const BEAM_KELVIN_MIN = 1000;
const BEAM_KELVIN_MAX = 12000;
const BEAM_KELVIN_DEFAULT = 5000;
const BEAM_INTENSITY_MIN = 0;
const BEAM_INTENSITY_MAX = 5;
const BEAM_INTENSITY_DEFAULT = 1.6;
const BEAM_SATURATION_MIN = 0;
const BEAM_SATURATION_MAX = 1;
const BEAM_SATURATION_DEFAULT = 0.15;
const BEAM_OBSERVER_POSITION_EPSILON = 1e-6;
const BEAM_OBSERVER_ANGLE_MAX = 0.001;
const BEAM_DARK_LUMINANCE_LIMIT = 12;
const BEAM_DARK_PIXEL_PERCENT_MAX = 8;
const BEAM_OBSERVER_VIEW_PLANS = [
    { id: "front", label: "спереди", direction: [0, 0.15, 1] },
    { id: "side", label: "сбоку", direction: [1, 0.15, 0] },
    { id: "topback", label: "сверху-сзади", direction: [-0.5, 0.85, -0.6] }
];
const LIGHT_MANIPULATOR_FORBIDDEN_NAMES = [
    "Источник света: манипулятор",
    "Источник света: сфера",
    "Источник света: направление"
];
const PICK_STACK_HINT = "Повторный щелчок — следующая деталь под курсором.";
const CAPTURE_SCENARIOS = ["selection", "context-menu", "pick-stack", "toolbar-panels-hidden", "toolbar-zoom-in", "texture-detail"];

function isCaptureScenario(scenario) {
    return typeof scenario === "string" && CAPTURE_SCENARIOS.includes(scenario);
}

const DISPLAY_MODES = [
    { id: "facets", label: "Грани в цвете", meshes: "visible", edges: true, edgeColor: "facets", flatShading: true, transparent: false },
    { id: "transparent", label: "Прозрачный", meshes: "visible", edges: false, edgeColor: "contrast", flatShading: false, transparent: true },
    { id: "wireframe", label: "Каркасный", meshes: "hidden", edges: true, edgeColor: "contrast", flatShading: false, transparent: false }
];
const DISPLAY_MODE_DEFAULT = "facets";
const DISPLAY_MODE_TRANSPARENT = "transparent";
const DISPLAY_MODE_IDS = DISPLAY_MODES.map(mode => mode.id);

const state = {
    THREE: null,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    loader: null,
    modelRoot: null,
    displayMode: DISPLAY_MODE_DEFAULT,
    wireframeLines: new Map(),
    wireframeLineColor: null,
    markerGroup: null,
    markers: [],
    partMarkers: [],
    fastenerRecords: 0,
    holeRecords: 0,
    fastenerGeometryRecords: 0,
    fastenerSynthesizedRecords: 0,
    suppressedFastenerGeometry: 0,
    fastenerAxisVectorRecords: 0,
    fastenerTiltedAxisRecords: 0,
    fastenerAxisVectorErrors: 0,
    lastStrayMarkerCount: null,
    partObjects: new Map(),
    selectionHelper: null,
    selectionOutlines: new Map(),
    selectionOutlineGeometries: new Map(),
    selectionOutlineMaterial: null,
    selectionOutlineObjects: [],
    selectionOutlineBuildMs: 0,
    selectionMaterials: new Map(),
    selectedBlock: null,
    selectedObjects: [],
    hiddenObjects: new Set(),
    treeBlocks: new Map(),
    pickStack: null,
    lastViewportClick: null,
    ground: null,
    mixer: null,
    activeAction: null,
    openClipIndices: new Set(),
    animatingClipIndices: new Set(),
    clipOpenPoseTimes: new Map(),
    clips: [],
    clock: null,
    raycaster: null,
    pointer: null,
    pickTargets: [],
    selectedObject: null,
    openSelectionKey: null,
    treeButtons: new Map(),
    treeGroups: [],
    treeGroupsByKey: new Map(),
    packageMetadata: null,
    packageParts: new Map(),
    animationLookup: new Map(),
    clipSourceIndices: new Map(),
    animationNodeSources: new Map(),
    activeClipIndex: -1,
    activeAnimationIndex: null,
    requestedClipIndex: -1,
    measurements: null,
    glowProfiles: new Map(),
    glowMaterials: new Map(),
    beam: {
        light: null,
        hemisphereLight: null,
        ambientLight: null,
        enabled: true,
        kelvin: BEAM_KELVIN_DEFAULT,
        intensity: BEAM_INTENSITY_DEFAULT,
        saturation: BEAM_SATURATION_DEFAULT,
        colorHex: 0
    },
    hierarchy: {
        defined: false,
        source: "не определена",
        moduleCount: 0,
        blockCount: 0
    },
    selectionDiagnostic: {
        selectedObject: null,
        animationIndex: null,
        hierarchySource: "не определена",
        autoOpenSucceeded: false
    },
    animationPlaying: false,
    animationDirection: "idle",
    doorOpen: false,
    openPoseTime: 0,
    openSeconds: 1,
    closeSeconds: 1,
    timingClipIndex: -1,
    defaultCameraPosition: null,
    defaultCameraTarget: null,
    modelSphereCenter: null,
    modelRadius: 0,
    zoomAnimation: null,
    panelsHidden: false,
    loadToken: 0,
    renderFrame: 0,
    renderedFrameCount: 0,
    ready: false,
    pointerDown: null
};

const WIREFRAME_EDGE_THRESHOLD = 20;
const WIREFRAME_LINE_ON_LIGHT_BACKGROUND = 0x22384f;
const WIREFRAME_LINE_ON_DARK_BACKGROUND = 0xb9e2ff;
const FACETS_EDGE_LINE_COLOR = 0x33404d;
const FACETS_EDGE_LINE_COLOR_ON_DARK = 0x8fa4b8;
const WIREFRAME_OVERLAY_KEY = "viewerWireframeOverlay";
const DEFAULT_BACKGROUND_COLOR = 0xe9ecef;
// Градиент окна просмотра: сверху 198, 210, 207 к белому внизу.
const DEFAULT_BACKGROUND_TOP_COLOR = 0xc6d2cf;
const DEFAULT_BACKGROUND_BOTTOM_COLOR = 0xffffff;

function createDefaultBackgroundTexture(THREE) {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, `#${DEFAULT_BACKGROUND_TOP_COLOR.toString(16).padStart(6, "0")}`);
    gradient.addColorStop(1, `#${DEFAULT_BACKGROUND_BOTTOM_COLOR.toString(16).padStart(6, "0")}`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace !== undefined) {
        texture.colorSpace = THREE.SRGBColorSpace;
    }
    return texture;
}
const SELECTION_OUTLINE_COLOR = 0x4f7bb5;
const SELECTION_OUTLINE_EDGE_THRESHOLD = 12;
const SELECTION_OUTLINE_RENDER_ORDER = 999;
const SELECTION_OUTLINE_EMISSIVE_COLOR = 0x1d2c3f;
const SELECTION_OUTLINE_EMISSIVE_INTENSITY = 0.17;
const SELECTION_OUTLINE_PIXEL_CHANNEL_DELTA = 24;
const DISPLAY_MODE_TRANSPARENT_OPACITY = 0.35;
const DISPLAY_MODE_TRANSPARENT_ALPHA_HASH = false;
const DISPLAY_MODE_SINGLE_SIDE_DEFAULT = 0;
const PICK_STACK_PIXEL_RADIUS = 6;
const PICK_STACK_DOUBLE_CLICK_MS = 400;
const TREE_CONTEXT_MENU_EDGE_GAP = 6;
const TRANSPARENT_RENDER_ORDER_BASE = -100000;
const TRANSPARENT_PROBE_FRAMES = 8;
const TRANSPARENT_PROBE_STEP_DEG = 45;
const TRANSPARENT_PROBE_MICRO_FRAMES = 9;
const TRANSPARENT_PROBE_MICRO_STEP_DEG = 5;
const TRANSPARENT_PROBE_VIEW_ELEVATION_DEG = 20;
const TRANSPARENT_PROBE_PART_COUNT = 20;
const TRANSPARENT_PROBE_SPREAD_PART_COUNT = 16;
const TRANSPARENT_PROBE_PART_VIEWS = 4;
const TRANSPARENT_PROBE_PART_FRAME_MARGIN = 3;
const TRANSPARENT_PROBE_BACKGROUND_TOLERANCE = 8;
const TRANSPARENT_PROBE_PIXEL_DELTA = 8;
const TRANSPARENT_PROBE_HIGHLIGHT_COLOR = 0x00ff00;
const TRANSPARENT_PROBE_HIGHLIGHT_INTENSITY = 8;
const TRANSPARENT_PROBE_CHANGE_DELTA = 6;
const ANIMATION_SECONDS_MIN = 0.05;
const ANIMATION_SECONDS_MAX = 60;
const ANIMATION_SECONDS_DEFAULT = 1;
const ANIMATION_SECONDS_EPSILON = 0.00001;
const CAMERA_NEAR_RADIUS_RATIO = 0.002;
const CAMERA_NEAR_ABSOLUTE_MIN = 0.001;
const CAMERA_MIN_DISTANCE_RADIUS_RATIO = 0.015;
const ZOOM_STEP_FACTOR = 0.8;
const ZOOM_MIN_STEP_MS = 140;
const ZOOM_MAX_STEP_MS = 260;
const ZOOM_DISTANCE_EPSILON_RATIO = 1e-6;
const ZOOM_SETTLE_MAX_FRAMES = 240;
const ZOOM_CLAMP_CLICKS = 80;
const ZOOM_CAPTURE_STEPS = 4;
const TEXTURE_DETAIL_VIEW_FILL = 0.75;
const TEXTURE_DETAIL_SURFACE_MIN = 0.3;
const TEXTURE_DETAIL_SURFACE_MAX = 0.6;
const TEXTURE_DETAIL_VIEW_ANGLE_DEGREES = 35;
const TEXTURE_DETAIL_AZIMUTH_DEGREES = 20;
const CAMERA_FAR_CLEARANCE_RADII = 10;
const CAMERA_FAR_RADIUS_MINIMUM = 30;
const FRAMED_FASTENER_TARGET_DIAGONAL = 0.06;
const FRAMED_FASTENER_MARGIN = 3.0;
const MARKER_STRAY_DISTANCE_LIMIT = 0.0005;
const FRAMED_GROUP_INWARD_FRACTION = 0.17;
const ORIGINAL_MATERIAL_PROPERTIES_KEY = "originalMaterialProperties";
const MILLIMETERS_PER_WORLD_UNIT = 1000;
const MEASUREMENT_DECIMALS = 1;
const MEASUREMENT_PLAUSIBLE_MILLIMETERS = 1000000;
const GLOW_KELVIN_MIN = 1000;
const GLOW_KELVIN_MAX = 12000;
const GLOW_KELVIN_DEFAULT = 6500;
const GLOW_INTENSITY_MIN = 0;
const GLOW_INTENSITY_MAX = 10;
const GLOW_INTENSITY_DEFAULT = 1.6;
const GLOW_SATURATION_MIN = 0;
const GLOW_SATURATION_MAX = 1;
const GLOW_SATURATION_DEFAULT = 0.35;
const GLOW_SIZE_MIN = 0;
const GLOW_SIZE_MAX = 5000;
const GLOW_SIZE_DEFAULT = 0;
const INSPECTOR_REMOVED_IDS = [
    "selection-type",
    "selection-name",
    "selection-dimensions",
    "selection-dimensions-local",
    "selection-geometry",
    "selection-pick-stack",
    "selection-pick-hint",
    "selection-visibility",
    "selection-dimensions-note",
    "animation-select",
    "animation-summary",
    "animation-toggle",
    "animation-reset",
    "animation-door-toggle",
    "glow-toggle",
    "glow-toggle-off",
    "glow-kelvin",
    "glow-intensity",
    "glow-saturation",
    "glow-size",
    "glow-readout",
    "beam-power",
    "beam-kelvin",
    "beam-intensity",
    "beam-saturation",
    "beam-readout",
    "marker-summary"
];
const INSPECTOR_REMOVED_CLASSES = [
    "inspector-panel",
    "inspector-content",
    "inspector-note",
    "selection-name",
    "measure-readout",
    "measure-secondary",
    "measure-note",
    "pick-stack-readout",
    "animation-timing",
    "timing-field",
    "timing-label",
    "timing-value",
    "timing-input",
    "timing-unit",
    "animation-actions",
    "animation-summary",
    "glow-actions",
    "glow-fields",
    "glow-field",
    "glow-label-text",
    "glow-input",
    "glow-readout",
    "glow-label",
    "beam-buttons",
    "beam-fields",
    "beam-field",
    "beam-label-text",
    "beam-input",
    "beam-readout",
    "beam-label",
    "marker-summary",
    "marker-label"
];
const INSPECTOR_REMOVED_LABELS = [
    "ИНСПЕКТОР",
    ">Выделение<",
    ">Анимация<",
    ">Подсветка детали<",
    ">Источник света<",
    ">Крепёж и фурнитура<",
    ">Воспроизвести<",
    ">Открыть выбранное<",
    ">Сбросить<",
    "Ничего не выбрано"
];
const DISPLAY_MODE_TEXTURE_PROPERTIES = [
    "map",
    "alphaMap",
    "aoMap",
    "bumpMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "gradientMap",
    "lightMap",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
    "specularMap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "clearcoatRoughnessMap",
    "sheenColorMap",
    "sheenRoughnessMap",
    "transmissionMap",
    "thicknessMap",
    "specularColorMap",
    "specularIntensityMap",
    "iridescenceMap",
    "iridescenceThicknessMap"
];

function getOriginalMaterialProperties(material) {
    if (!material || typeof material !== "object") {
        return null;
    }
    if (!material.userData || typeof material.userData !== "object") {
        material.userData = {};
    }
    const existing = material.userData[ORIGINAL_MATERIAL_PROPERTIES_KEY];
    if (existing && typeof existing === "object") {
        return existing;
    }
    const properties = {
        hasColor: Boolean(material.color),
        color: material.color && typeof material.color.clone === "function" ? material.color.clone() : null,
        wireframe: material.wireframe === true,
        opacity: material.opacity,
        transparent: material.transparent === true,
        alphaHash: material.alphaHash === true,
        depthWrite: material.depthWrite !== false,
        depthTest: material.depthTest !== false,
        side: material.side,
        polygonOffset: material.polygonOffset === true,
        polygonOffsetFactor: material.polygonOffsetFactor,
        polygonOffsetUnits: material.polygonOffsetUnits,
        alphaTest: material.alphaTest,
        blending: material.blending,
        premultipliedAlpha: material.premultipliedAlpha === true,
        colorWrite: material.colorWrite !== false,
        visible: material.visible !== false,
        flatShading: material.flatShading === true,
        vertexColors: material.vertexColors === true,
        toneMapped: material.toneMapped !== false,
        dithering: material.dithering === true
    };
    for (const property of DISPLAY_MODE_TEXTURE_PROPERTIES) {
        properties[property] = material[property] ?? null;
    }
    material.userData[ORIGINAL_MATERIAL_PROPERTIES_KEY] = properties;
    return properties;
}

function restoreMaterialProperties(material, properties) {
    if (!material || !properties) {
        return;
    }
    if (properties.hasColor && properties.color && material.color && typeof material.color.copy === "function") {
        material.color.copy(properties.color);
    }
    for (const property of [
        "wireframe",
        "opacity",
        "transparent",
        "alphaHash",
        "depthWrite",
        "depthTest",
        "side",
        "polygonOffset",
        "polygonOffsetFactor",
        "polygonOffsetUnits",
        "alphaTest",
        "blending",
        "premultipliedAlpha",
        "colorWrite",
        "visible",
        "flatShading",
        "vertexColors",
        "toneMapped",
        "dithering"
    ]) {
        if (Object.prototype.hasOwnProperty.call(properties, property)) {
            material[property] = properties[property];
        }
    }
    for (const property of DISPLAY_MODE_TEXTURE_PROPERTIES) {
        if (Object.prototype.hasOwnProperty.call(properties, property)) {
            material[property] = properties[property];
        }
    }
    material.needsUpdate = true;
}

const transparentRenderOrderEntries = [];

function resetTransparentRenderOrder() {
    for (const entry of transparentRenderOrderEntries) {
        entry.mesh.renderOrder = entry.renderOrder;
    }
    transparentRenderOrderEntries.length = 0;
}

function setCameraAzimuth(degrees) {
    const numeric = Number(degrees);
    if (!Number.isFinite(numeric) || !state.THREE || !state.camera || !state.controls) {
        return false;
    }
    const center = getBeamObserverViewCenter();
    const distance = getBeamObserverViewDistance();
    const azimuth = (numeric * Math.PI) / 180;
    const elevation = (TRANSPARENT_PROBE_VIEW_ELEVATION_DEG * Math.PI) / 180;
    const horizontal = Math.cos(elevation) * distance;
    state.controls.target.copy(center);
    state.camera.position.set(
        center.x + Math.sin(azimuth) * horizontal,
        center.y + Math.sin(elevation) * distance,
        center.z + Math.cos(azimuth) * horizontal);
    state.controls.update();
    state.controls.update();
    updateCameraClipping();
    state.camera.updateMatrixWorld(true);
    updateBeamLight();
    return true;
}

function updateTransparentRenderOrder() {
    const meshes = getModelMeshes();
    const entries = [];
    for (const mesh of meshes) {
        const bounds = getGeometryBounds(mesh.geometry);
        if (!bounds) {
            continue;
        }
        const sphere = bounds.getBoundingSphere(new state.THREE.Sphere()).clone().applyMatrix4(mesh.matrixWorld);
        const distance = state.camera.position.distanceTo(sphere.center) - sphere.radius;
        entries.push({ mesh, distance, renderOrder: mesh.renderOrder });
    }
    entries.sort((first, second) => second.distance - first.distance);
    for (let index = 0; index < entries.length; index += 1) {
        entries[index].mesh.renderOrder = TRANSPARENT_RENDER_ORDER_BASE + index;
    }
    transparentRenderOrderEntries.length = 0;
    for (const entry of entries) {
        transparentRenderOrderEntries.push(entry);
    }
    return entries.length;
}

function updateDisplayModeButtons() {
    for (const button of elements.displayModeButtons) {
        button.setAttribute("aria-pressed", button.dataset.displayMode === state.displayMode ? "true" : "false");
    }
}

function getDisplayModeButtonCatalog() {
    return elements.displayModeButtons.map(button => ({
        id: button.dataset.displayMode || "",
        label: button.getAttribute("title") || "",
        ariaLabel: button.getAttribute("aria-label") || "",
        iconPresent: Boolean(button.querySelector("svg")),
        pressed: button.getAttribute("aria-pressed") === "true"
    }));
}

function getDisplayMode(id) {
    return DISPLAY_MODES.find(mode => mode.id === id) || null;
}

function isDisplayMode(id) {
    return DISPLAY_MODES.some(mode => mode.id === id);
}

function isWireframeOverlay(object) {
    return Boolean(object && object.userData && object.userData[WIREFRAME_OVERLAY_KEY]);
}

function isSelectionOutline(object) {
    return Boolean(object && object.userData && object.userData.isSelectionOutline === true);
}

function isWireframeExcludedObject(object) {
    const userData = object && object.userData && typeof object.userData === "object" ? object.userData : null;
    return object === state.markerGroup || object === state.selectionHelper || isSelectionOutline(object) ||
        Boolean(userData && (userData.viewerHelper === true || userData.isHelper === true || userData.markerType));
}

function getBackgroundLuminance() {
    if (!state.scene || !state.scene.background || !state.scene.background.isColor || !state.THREE) {
        return 0;
    }
    const backgroundHex = state.scene.background.getHex(state.THREE.SRGBColorSpace);
    const red = (backgroundHex >> 16) & 255;
    const green = (backgroundHex >> 8) & 255;
    const blue = backgroundHex & 255;
    return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
}

function updateWireframeLineColor() {
    if (!state.scene || !state.scene.background || !state.scene.background.isColor) {
        return;
    }
    const luminance = getBackgroundLuminance();
    const mode = getDisplayMode(state.displayMode);
    const facetsEdge = Boolean(mode && mode.edgeColor === "facets");
    const lineColor = luminance > 0.48
        ? (facetsEdge ? FACETS_EDGE_LINE_COLOR : WIREFRAME_LINE_ON_LIGHT_BACKGROUND)
        : (facetsEdge ? FACETS_EDGE_LINE_COLOR_ON_DARK : WIREFRAME_LINE_ON_DARK_BACKGROUND);
    state.wireframeLineColor = lineColor;
    for (const line of state.wireframeLines.values()) {
        if (line.material && line.material.color && typeof line.material.color.setHex === "function") {
            line.material.color.setHex(lineColor);
        }
    }
}

function syncBackgroundControls(value) {
    if (elements.backgroundColor) {
        elements.backgroundColor.value = value;
    }
    if (elements.backgroundSwatchFill) {
        elements.backgroundSwatchFill.style.backgroundColor = value;
    }
}

function applyBackgroundColor(value) {
    if (!state.scene || !state.scene.background || !state.THREE) {
        return false;
    }
    const normalized = /^#[0-9a-f]{6}$/i.test(String(value || ""))
        ? String(value).toLowerCase()
        : `#${DEFAULT_BACKGROUND_COLOR.toString(16).padStart(6, "0")}`;
    if (!state.scene.background.isColor) {
        // Пользователь выбрал цвет: градиент подменяется сплошным цветом.
        state.scene.background = new state.THREE.Color(normalized);
    } else {
        state.scene.background.set(normalized);
    }
    syncBackgroundControls(normalized);
    updateWireframeLineColor();
    return true;
}

function ensureWireframeOverlays() {
    if (!state.modelRoot || !state.THREE) {
        return 0;
    }
    const modelMeshes = [];
    state.modelRoot.traverse(object => {
        if (object.isMesh && !isWireframeOverlay(object) && !isWireframeExcludedObject(object)) {
            modelMeshes.push(object);
        }
    });
    for (const mesh of modelMeshes) {
        if (state.wireframeLines.has(mesh) || !mesh.geometry) {
            continue;
        }
        let edgeGeometry;
        try {
            edgeGeometry = new state.THREE.EdgesGeometry(mesh.geometry, WIREFRAME_EDGE_THRESHOLD);
        } catch {
            continue;
        }
        const lineMaterial = new state.THREE.LineBasicMaterial({
            color: state.wireframeLineColor ?? WIREFRAME_LINE_ON_LIGHT_BACKGROUND,
            depthTest: true,
            depthWrite: false,
            transparent: false,
            polygonOffset: false,
            toneMapped: false,
            fog: false
        });
        const line = new state.THREE.LineSegments(edgeGeometry, lineMaterial);
        line.name = `Каркас: ${mesh.name || "Меш"}`;
        line.renderOrder = 1;
        line.userData = {
            [WIREFRAME_OVERLAY_KEY]: true,
            sourceMeshId: mesh.userData && mesh.userData.viewerId ? mesh.userData.viewerId : mesh.uuid
        };
        line.raycast = () => {};
        mesh.add(line);
        state.wireframeLines.set(mesh, line);
    }
    updateWireframeLineColor();
    return state.wireframeLines.size;
}

function setWireframeOverlayVisibility(visible) {
    for (const line of state.wireframeLines.values()) {
        line.visible = visible;
    }
}

function removeWireframeOverlays() {
    for (const [mesh, line] of state.wireframeLines) {
        if (line.parent) {
            line.parent.remove(line);
        }
        if (line.geometry && typeof line.geometry.dispose === "function") {
            line.geometry.dispose();
        }
        const materials = Array.isArray(line.material) ? line.material : line.material ? [line.material] : [];
        for (const material of materials) {
            if (material && typeof material.dispose === "function") {
                material.dispose();
            }
        }
        if (mesh && mesh.userData) {
            delete mesh.userData[WIREFRAME_OVERLAY_KEY];
        }
    }
    state.wireframeLines.clear();
    state.wireframeLineColor = null;
}

function getSelectionOutlineMaterial() {
    if (!state.selectionOutlineMaterial && state.THREE) {
        state.selectionOutlineMaterial = new state.THREE.LineBasicMaterial({
            color: SELECTION_OUTLINE_COLOR,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            opacity: 1,
            toneMapped: false,
            fog: false
        });
    }
    return state.selectionOutlineMaterial;
}

function getSelectionOutlineEdges(mesh) {
    const geometry = mesh && mesh.geometry;
    if (!geometry || !state.THREE) {
        return null;
    }
    const cached = state.selectionOutlineGeometries.get(geometry.uuid);
    if (cached) {
        return cached;
    }
    let edges = null;
    try {
        edges = new state.THREE.EdgesGeometry(geometry, SELECTION_OUTLINE_EDGE_THRESHOLD);
    } catch {
        return null;
    }
    const position = edges && edges.attributes ? edges.attributes.position : null;
    if (!position || !Number.isInteger(position.count) || position.count < 3) {
        if (edges && typeof edges.dispose === "function") {
            edges.dispose();
        }
        return null;
    }
    state.selectionOutlineGeometries.set(geometry.uuid, edges);
    return edges;
}

function createSelectionOutline(mesh) {
    const edges = getSelectionOutlineEdges(mesh);
    const material = getSelectionOutlineMaterial();
    if (!edges || !material) {
        return null;
    }
    const line = new state.THREE.LineSegments(edges, material);
    line.name = `Выделение: ${mesh.name || getObjectName(mesh)}`;
    line.renderOrder = SELECTION_OUTLINE_RENDER_ORDER;
    line.frustumCulled = false;
    line.visible = true;
    line.raycast = () => {};
    line.userData = {
        isSelectionOutline: true,
        viewerHelper: true,
        sourceMeshId: mesh.userData && mesh.userData.viewerId ? mesh.userData.viewerId : mesh.uuid
    };
    mesh.add(line);
    return line;
}

function setSelectionOutlineVisibility(visible) {
    for (const line of state.selectionOutlines.values()) {
        line.visible = visible;
    }
}

function removeSelectionOutlines() {
    for (const line of state.selectionOutlines.values()) {
        if (line.parent) {
            line.parent.remove(line);
        }
    }
    state.selectionOutlines.clear();
    state.selectionOutlineObjects = [];
    state.selectionOutlineBuildMs = 0;
    restoreAllSelectionMaterials();
}

function disposeSelectionOutlineCache() {
    for (const edges of state.selectionOutlineGeometries.values()) {
        if (edges && typeof edges.dispose === "function") {
            edges.dispose();
        }
    }
    state.selectionOutlineGeometries.clear();
    if (state.selectionOutlineMaterial && typeof state.selectionOutlineMaterial.dispose === "function") {
        state.selectionOutlineMaterial.dispose();
    }
    state.selectionOutlineMaterial = null;
}

function getSelectionMeshes(objects) {
    const meshes = [];
    const seen = new Set();
    for (const object of objects) {
        for (const mesh of collectPartGeometry(object)) {
            if (!seen.has(mesh)) {
                seen.add(mesh);
                meshes.push(mesh);
            }
        }
    }
    return meshes;
}

function applySelectionOutlines(object, objects) {
    const started = performance.now();
    const list = objects || (object ? [object] : []);
    if (sameSelectionObjects(state.selectionOutlineObjects, list)) {
        state.selectionOutlineBuildMs = performance.now() - started;
        return state.selectionOutlines.size;
    }
    removeSelectionOutlines();
    state.selectionOutlineObjects = list.slice();
    if (list.length === 0) {
        state.selectionOutlineBuildMs = performance.now() - started;
        return 0;
    }
    for (const mesh of getSelectionMeshes(list)) {
        const line = createSelectionOutline(mesh);
        if (line) {
            state.selectionOutlines.set(mesh, line);
        }
    }
    applySelectionEmissive(object, list);
    state.selectionOutlineBuildMs = performance.now() - started;
    return state.selectionOutlines.size;
}

function sameSelectionObjects(first, second) {
    if (!first || !second || first.length !== second.length) {
        return false;
    }
    return first.every((object, index) => object === second[index]);
}

function applyDisplayMode(mode) {
    const definition = getDisplayMode(mode);
    if (!definition) {
        return false;
    }
    state.displayMode = definition.id;
    updateDisplayModeButtons();
    if (!state.modelRoot) {
        return true;
    }
    const processedMaterials = new Set();
    state.modelRoot.traverse(object => {
        if (!object.isMesh || isWireframeOverlay(object) || isWireframeExcludedObject(object)) {
            return;
        }
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        for (const material of materials) {
            if (!material || processedMaterials.has(material)) {
                continue;
            }
            processedMaterials.add(material);
            const original = getOriginalMaterialProperties(material);
            restoreMaterialProperties(material, original);
            material.wireframe = false;
            const transparent = definition.transparent;
            material.visible = definition.meshes === "hidden" ? false : true;
            material.transparent = transparent;
            material.alphaHash = false;
            material.opacity = transparent ? DISPLAY_MODE_TRANSPARENT_OPACITY : 1;
            material.depthWrite = true;
            material.depthTest = true;
            material.side = original.side !== undefined ? original.side : DISPLAY_MODE_SINGLE_SIDE_DEFAULT;
            material.polygonOffset = false;
            material.polygonOffsetFactor = 0;
            material.polygonOffsetUnits = 0;
            material.flatShading = definition.flatShading;
            material.needsUpdate = true;
        }
    });
    if (definition.transparent) {
        state.scene.updateMatrixWorld(true);
        updateTransparentRenderOrder();
    } else {
        resetTransparentRenderOrder();
    }
    if (definition.edges) {
        ensureWireframeOverlays();
        setWireframeOverlayVisibility(true);
    } else {
        setWireframeOverlayVisibility(false);
    }
    updateWireframeLineColor();
    setSelectionOutlineVisibility(true);
    if (state.selectedObjects.length > 0) {
        applySelectionEmissive(state.selectedObject, state.selectedObjects);
    }
    return true;
}

function resetDisplayMode() {
    if (state.modelRoot) {
        applyDisplayMode(DISPLAY_MODE_DEFAULT);
        return;
    }
    state.displayMode = DISPLAY_MODE_DEFAULT;
    updateDisplayModeButtons();
}

function sendToHost(message) {
    if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === "function") {
        window.chrome.webview.postMessage(message);
    }
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function userErrorMessage(error, prefix) {
    return `${prefix}: ${errorMessage(error) || "Неизвестная ошибка."}`;
}

function setStatus(message, tone = "info") {
    elements.statusText.textContent = message;
    if (elements.statusBar) {
        elements.statusBar.dataset.tone = tone === "error" ? "error" : "info";
    }
}

function setLoading(message, isError = false) {
    elements.loadingMessage.textContent = message;
    elements.loadingOverlay.classList.toggle("hidden", !message);
    elements.loadingOverlay.classList.toggle("error", isError);
}

function hideLoading() {
    setLoading("");
}

function reportError(message, requestId = null) {
    setStatus(message, "error");
    setLoading(message, true);
    sendToHost({ type: "viewerError", requestId, message });
}

function decodeBase64(value) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error("Пустое значение недопустимо для расшифровки.");
    }
    let binary;
    try {
        binary = window.atob(value);
    } catch {
        throw new Error("Не удалось декодировать данные модели.");
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
}

function disableSceneShadows() {
    if (state.renderer && state.renderer.shadowMap) {
        state.renderer.shadowMap.enabled = false;
        state.renderer.shadowMap.autoUpdate = false;
        state.renderer.shadowMap.needsUpdate = false;
    }
    if (!state.scene) {
        return;
    }
    state.scene.traverse(object => {
        if (object.isLight) {
            object.castShadow = false;
        }
        if (object.isMesh) {
            object.castShadow = false;
            object.receiveShadow = false;
        }
    });
}

function clampValue(value, minimum, maximum, fallback = minimum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    return Math.min(maximum, Math.max(minimum, numeric));
}

function kelvinToRgb(kelvin) {
    const temperature = clampValue(kelvin, GLOW_KELVIN_MIN, GLOW_KELVIN_MAX, GLOW_KELVIN_DEFAULT) / 100;
    let red = 255;
    let green = 0;
    let blue = 0;
    if (temperature <= 66) {
        green = 99.4708025861 * Math.log(temperature) - 161.1195681661;
        blue = temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
    } else {
        red = 329.698727446 * Math.pow(temperature - 60, -0.1332047592);
        green = 288.1221695283 * Math.pow(temperature - 60, -0.0755148492);
        blue = 255;
    }
    return {
        red: Math.round(clampValue(red, 0, 255, 0)),
        green: Math.round(clampValue(green, 0, 255, 0)),
        blue: Math.round(clampValue(blue, 0, 255, 0))
    };
}

function getGlowColorHex(kelvin, saturation) {
    const base = kelvinToRgb(kelvin);
    const mix = clampValue(saturation, GLOW_SATURATION_MIN, GLOW_SATURATION_MAX, GLOW_SATURATION_DEFAULT);
    const luminance = base.red * 0.2126 + base.green * 0.7152 + base.blue * 0.0722;
    const red = Math.round(luminance + (base.red - luminance) * mix);
    const green = Math.round(luminance + (base.green - luminance) * mix);
    const blue = Math.round(luminance + (base.blue - luminance) * mix);
    return ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255);
}

function getBeamColorHex(kelvin, saturation) {
    return getGlowColorHex(kelvin, saturation);
}

function colorToHexPadded(hex) {
    return `#${(hex & 0xffffff).toString(16).padStart(6, "0")}`;
}

function formatMillimeters(value) {
    if (!Number.isFinite(value)) {
        return "н/д";
    }
    const rounded = Math.round(value * 10) / 10;
    return (rounded === 0 ? 0 : rounded).toFixed(MEASUREMENT_DECIMALS);
}

function formatMillimeterTriple(size) {
    if (!size) {
        return "н/д";
    }
    return `${formatMillimeters(size.x)} × ${formatMillimeters(size.y)} × ${formatMillimeters(size.z)} мм`;
}

function isFiniteTriple(value) {
    return Boolean(value) && [value.x, value.y, value.z].every(Number.isFinite);
}

function getGeometryBounds(geometry) {
    if (!geometry || typeof geometry.computeBoundingBox !== "function") {
        return null;
    }
    try {
        if (!geometry.boundingBox) {
            geometry.computeBoundingBox();
        }
    } catch {
        return null;
    }
    const box = geometry.boundingBox;
    if (!box || box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x) ||
        !Number.isFinite(box.min.y) || !Number.isFinite(box.max.y) ||
        !Number.isFinite(box.min.z) || !Number.isFinite(box.max.z)) {
        return null;
    }
    return box;
}

function collectPartGeometry(object) {
    const meshes = [];
    const collect = current => {
        if (!current || isWireframeOverlay(current) || isWireframeExcludedObject(current)) {
            return;
        }
        if (current.isMesh && current.geometry) {
            meshes.push(current);
        }
        for (const child of current.children) {
            collect(child);
        }
    };
    collect(object);
    return meshes;
}

function countGeometryTriangles(geometry) {
    if (!geometry) {
        return 0;
    }
    if (geometry.index && Number.isInteger(geometry.index.count)) {
        return Math.floor(geometry.index.count / 3);
    }
    const position = geometry.attributes ? geometry.attributes.position : null;
    return position && Number.isInteger(position.count) ? Math.floor(position.count / 3) : 0;
}

function isDescendantObject(object, ancestor) {
    if (!object || !ancestor) {
        return false;
    }
    for (let current = object; current; current = current.parent) {
        if (current === ancestor) {
            return true;
        }
    }
    return false;
}

function isAnimatedPart(object) {
    if (!object) {
        return false;
    }
    if (getDirectAnimationIndex(object) !== null || getSourceAnimationIndex(object) !== null) {
        return true;
    }
    return hasAnimatedAncestor(object);
}

function measurePartGeometry(object) {
    const THREE = state.THREE;
    const result = {
        meshes: [],
        worldBox: new THREE.Box3(),
        localBox: new THREE.Box3(),
        localCenters: [],
        triangleCount: 0
    };
    if (!object || !THREE) {
        return result;
    }
    const meshes = collectPartGeometry(object);
    if (meshes.length === 0) {
        return result;
    }
    if (typeof object.updateWorldMatrix === "function") {
        object.updateWorldMatrix(true, true);
    }
    const inverseRoot = new THREE.Matrix4().copy(object.matrixWorld).invert();
    const worldTemp = new THREE.Box3();
    const localTemp = new THREE.Box3();
    for (const mesh of meshes) {
        const bounds = getGeometryBounds(mesh.geometry);
        if (!bounds) {
            continue;
        }
        result.meshes.push(mesh);
        result.triangleCount += countGeometryTriangles(mesh.geometry);
        worldTemp.copy(bounds).applyMatrix4(mesh.matrixWorld);
        result.worldBox.union(worldTemp);
        localTemp.copy(bounds).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld));
        result.localBox.union(localTemp);
        result.localCenters.push(localTemp.getCenter(new THREE.Vector3()));
    }
    return result;
}

function toMillimeterVector(vector) {
    return vector ? {
        x: vector.x * MILLIMETERS_PER_WORLD_UNIT,
        y: vector.y * MILLIMETERS_PER_WORLD_UNIT,
        z: vector.z * MILLIMETERS_PER_WORLD_UNIT
    } : null;
}

function getPartMeasurements(object) {
    const THREE = state.THREE;
    const empty = {
        valid: false,
        meshCount: 0,
        triangleCount: 0,
        worldSize: null,
        worldSizeMm: null,
        localSize: null,
        localSizeMm: null,
        centerMm: null,
        localCenter: null,
        localBoundsValid: false,
        animated: isAnimatedPart(object)
    };
    if (!object || !THREE) {
        return empty;
    }
    const measured = measurePartGeometry(object);
    if (measured.meshes.length === 0) {
        return empty;
    }
    const localBoundsValid = !measured.localBox.isEmpty();
    const worldSize = localBoundsValid ? measured.worldBox.getSize(new THREE.Vector3()) : null;
    const localSize = localBoundsValid ? measured.localBox.getSize(new THREE.Vector3()) : null;
    const worldSizeMm = toMillimeterVector(worldSize);
    const localSizeMm = toMillimeterVector(localSize);
    const centerMm = toMillimeterVector(measured.worldBox.getCenter(new THREE.Vector3()));
    const localCenter = localBoundsValid ? measured.localBox.getCenter(new THREE.Vector3()) : null;
    const valid = localBoundsValid && isFiniteTriple(worldSizeMm) && isFiniteTriple(localSizeMm) &&
        Math.max(localSizeMm.x, localSizeMm.y, localSizeMm.z) > 0 &&
        Math.max(localSizeMm.x, localSizeMm.y, localSizeMm.z) < MEASUREMENT_PLAUSIBLE_MILLIMETERS;
    return {
        valid,
        meshCount: measured.meshes.length,
        triangleCount: measured.triangleCount,
        worldSize: worldSize ? { x: worldSize.x, y: worldSize.y, z: worldSize.z } : null,
        worldSizeMm,
        localSize: localSize ? { x: localSize.x, y: localSize.y, z: localSize.z } : null,
        localSizeMm,
        centerMm,
        localCenter: localCenter ? { x: localCenter.x, y: localCenter.y, z: localCenter.z } : null,
        localBoundsValid,
        animated: isAnimatedPart(object)
    };
}

function getBlockMeasurements(block) {
    const THREE = state.THREE;
    const empty = {
        valid: false,
        meshCount: 0,
        partCount: 0,
        triangleCount: 0,
        worldSize: null,
        worldSizeMm: null,
        localSize: null,
        localSizeMm: null,
        centerMm: null,
        localCenter: null,
        localBoundsValid: false,
        animated: false
    };
    if (!block || !THREE || block.objects.length === 0) {
        return empty;
    }
    const worldBox = new THREE.Box3();
    const localBox = new THREE.Box3();
    const localTemp = new THREE.Box3();
    const inverseRoot = new THREE.Matrix4();
    const worldTemp = new THREE.Box3();
    let meshCount = 0;
    let triangleCount = 0;
    let animated = false;
    for (const object of block.objects) {
        if (typeof object.updateWorldMatrix === "function") {
            object.updateWorldMatrix(true, true);
        }
        inverseRoot.copy(object.matrixWorld).invert();
        for (const mesh of collectPartGeometry(object)) {
            const bounds = getGeometryBounds(mesh.geometry);
            if (!bounds) {
                continue;
            }
            meshCount += 1;
            triangleCount += countGeometryTriangles(mesh.geometry);
            worldTemp.copy(bounds).applyMatrix4(mesh.matrixWorld);
            worldBox.union(worldTemp);
            localTemp.copy(bounds).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld));
            localBox.union(localTemp);
        }
        animated = animated || isAnimatedPart(object);
    }
    if (meshCount === 0) {
        return empty;
    }
    const localBoundsValid = !localBox.isEmpty();
    const worldSize = localBoundsValid ? worldBox.getSize(new THREE.Vector3()) : null;
    const localSize = localBoundsValid ? localBox.getSize(new THREE.Vector3()) : null;
    const worldSizeMm = toMillimeterVector(worldSize);
    const localSizeMm = toMillimeterVector(localSize);
    const centerMm = toMillimeterVector(worldBox.getCenter(new THREE.Vector3()));
    const localCenter = localBoundsValid ? localBox.getCenter(new THREE.Vector3()) : null;
    const valid = localBoundsValid && isFiniteTriple(worldSizeMm) && isFiniteTriple(localSizeMm) &&
        Math.max(localSizeMm.x, localSizeMm.y, localSizeMm.z) > 0 &&
        Math.max(localSizeMm.x, localSizeMm.y, localSizeMm.z) < MEASUREMENT_PLAUSIBLE_MILLIMETERS;
    return {
        valid,
        meshCount,
        partCount: block.objects.length,
        triangleCount,
        worldSize: worldSize ? { x: worldSize.x, y: worldSize.y, z: worldSize.z } : null,
        worldSizeMm,
        localSize: localSize ? { x: localSize.x, y: localSize.y, z: localSize.z } : null,
        localSizeMm,
        centerMm,
        localCenter: localCenter ? { x: localCenter.x, y: localCenter.y, z: localCenter.z } : null,
        localBoundsValid,
        animated
    };
}

function getSelectionLabel() {
    if (state.selectedBlock) {
        return `Блок ${state.selectedBlock.blockIndex + 1}, деталей: ${state.selectedBlock.objects.length}`;
    }
    return state.selectedObject ? getObjectName(state.selectedObject) : "";
}

function getBlockSelectionStatus(block) {
    return `Блок ${block.blockIndex + 1} выбран.`;
}

function refreshSelectionMeasurements() {
    state.measurements = state.selectedBlock
        ? getBlockMeasurements(state.selectedBlock)
        : (state.selectedObject ? getPartMeasurements(state.selectedObject) : null);
}

function getMeshMaterials(value) {
    if (Array.isArray(value)) {
        return value.filter(item => item);
    }
    return value ? [value] : [];
}

function materialsIdentical(first, second) {
    if (first === second) {
        return true;
    }
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
        return false;
    }
    return first.every((item, index) => item === second[index]);
}

function cloneGlowMaterial(material) {
    if (!material || typeof material.clone !== "function") {
        return null;
    }
    const clone = material.clone();
    clone.userData = material.userData;
    getOriginalMaterialProperties(clone);
    return clone;
}

function cloneGlowMaterials(value) {
    if (Array.isArray(value)) {
        return value.map(item => (item ? cloneGlowMaterial(item) : item));
    }
    return value ? cloneGlowMaterial(value) : value;
}

function disposeGlowMaterials(value) {
    for (const material of getMeshMaterials(value)) {
        if (typeof material.dispose === "function") {
            material.dispose();
        }
    }
}

function ensureGlowMaterial(mesh) {
    restoreSelectionMaterial(mesh);
    const current = mesh.material;
    const existing = state.glowMaterials.get(mesh);
    if (existing && materialsIdentical(mesh.material, existing.clone)) {
        return existing;
    }
    if (existing) {
        state.glowMaterials.delete(mesh);
        disposeGlowMaterials(existing.clone);
    }
    const clone = cloneGlowMaterials(current);
    if (!clone) {
        return null;
    }
    const entry = { original: current, clone };
    state.glowMaterials.set(mesh, entry);
    mesh.material = clone;
    return entry;
}

function restoreGlowMaterial(mesh) {
    const entry = state.glowMaterials.get(mesh);
    if (!entry) {
        return false;
    }
    state.glowMaterials.delete(mesh);
    if (materialsIdentical(mesh.material, entry.clone)) {
        mesh.material = entry.original;
    }
    disposeGlowMaterials(entry.clone);
    return true;
}

function applyGlowEmissive(material, colorHex, intensity) {
    if (!material || !material.emissive || typeof material.emissive.setHex !== "function") {
        return false;
    }
    material.emissive.setHex(colorHex, state.THREE.SRGBColorSpace);
    material.emissiveIntensity = intensity;
    material.needsUpdate = true;
    return true;
}

function ensureSelectionMaterial(mesh) {
    if (state.glowMaterials.has(mesh)) {
        return null;
    }
    const existing = state.selectionMaterials.get(mesh);
    if (existing && materialsIdentical(mesh.material, existing.clone)) {
        return existing;
    }
    if (existing) {
        state.selectionMaterials.delete(mesh);
        disposeGlowMaterials(existing.clone);
    }
    const clone = cloneGlowMaterials(mesh.material);
    if (!clone) {
        return null;
    }
    const entry = { original: mesh.material, clone };
    state.selectionMaterials.set(mesh, entry);
    mesh.material = clone;
    return entry;
}

function restoreSelectionMaterial(mesh) {
    const entry = state.selectionMaterials.get(mesh);
    if (!entry) {
        return false;
    }
    state.selectionMaterials.delete(mesh);
    if (materialsIdentical(mesh.material, entry.clone)) {
        mesh.material = entry.original;
    }
    disposeGlowMaterials(entry.clone);
    return true;
}

function restoreAllSelectionMaterials() {
    for (const mesh of Array.from(state.selectionMaterials.keys())) {
        restoreSelectionMaterial(mesh);
    }
}

function applySelectionEmissive(object, objects) {
    const list = objects || (object ? [object] : []);
    if (list.length === 0 || state.displayMode === "wireframe") {
        return 0;
    }
    let applied = 0;
    for (const mesh of getSelectionMeshes(list)) {
        if (state.glowMaterials.has(mesh)) {
            continue;
        }
        const entry = ensureSelectionMaterial(mesh);
        if (!entry) {
            continue;
        }
        for (const material of getMeshMaterials(entry.clone)) {
            if (applyGlowEmissive(material, SELECTION_OUTLINE_EMISSIVE_COLOR, SELECTION_OUTLINE_EMISSIVE_INTENSITY)) {
                applied += 1;
            }
        }
    }
    return applied;
}

function collectGlowTargets(object, profile) {
    const measured = measurePartGeometry(object);
    const meshes = measured.meshes;
    if (!(profile.size > 0) || measured.localBox.isEmpty() || measured.localCenters.length === 0) {
        return { meshes, included: meshes.slice() };
    }
    const center = measured.localBox.getCenter(new state.THREE.Vector3());
    const radius = profile.size / MILLIMETERS_PER_WORLD_UNIT;
    const included = [];
    for (let index = 0; index < meshes.length; index += 1) {
        const meshCenter = measured.localCenters[index];
        if (meshCenter && meshCenter.distanceTo(center) <= radius) {
            included.push(meshes[index]);
        }
    }
    return { meshes, included };
}

function getGlowProfile(object, create = false) {
    if (!object) {
        return null;
    }
    const existing = state.glowProfiles.get(object);
    if (existing) {
        return existing;
    }
    if (!create) {
        return null;
    }
    const profile = {
        enabled: false,
        kelvin: GLOW_KELVIN_DEFAULT,
        intensity: GLOW_INTENSITY_DEFAULT,
        saturation: GLOW_SATURATION_DEFAULT,
        size: GLOW_SIZE_DEFAULT,
        colorHex: 0,
        appliedMaterialCount: 0
    };
    state.glowProfiles.set(object, profile);
    return profile;
}

function deleteGlowProfile(object) {
    if (!state.glowProfiles.has(object)) {
        return false;
    }
    clearGlowForObject(object);
    return state.glowProfiles.delete(object);
}

function applyGlowToObject(object) {
    const profile = getGlowProfile(object, true);
    if (!profile) {
        return null;
    }
    const colorHex = getGlowColorHex(profile.kelvin, profile.saturation);
    const targets = collectGlowTargets(object, profile);
    const included = new Set(targets.included);
    let applied = 0;
    for (const mesh of targets.meshes) {
        if (!included.has(mesh)) {
            restoreGlowMaterial(mesh);
            continue;
        }
        const entry = ensureGlowMaterial(mesh);
        if (!entry) {
            continue;
        }
        for (const material of getMeshMaterials(entry.clone)) {
            if (applyGlowEmissive(material, colorHex, profile.intensity)) {
                applied += 1;
            }
        }
    }
    profile.colorHex = colorHex;
    profile.appliedMaterialCount = applied;
    return profile;
}

function clearGlowForObject(object) {
    let restored = 0;
    for (const mesh of Array.from(state.glowMaterials.keys())) {
        if (object && !isDescendantObject(mesh, object)) {
            continue;
        }
        if (restoreGlowMaterial(mesh)) {
            restored += 1;
        }
    }
    const profile = state.glowProfiles.get(object);
    if (profile) {
        profile.enabled = false;
        profile.appliedMaterialCount = 0;
    }
    return restored;
}

function setGlowEnabled(object, enabled, refreshSelectionEmissive = true) {
    const profile = getGlowProfile(object, true);
    if (!profile) {
        return null;
    }
    profile.enabled = enabled === true;
    if (profile.enabled) {
        applyGlowToObject(object);
    } else {
        clearGlowForObject(object);
    }
    if (refreshSelectionEmissive && state.selectedObjects.length > 0) {
        applySelectionEmissive(state.selectedObject, state.selectedObjects);
    }
    return profile;
}

function toggleSelectedGlow(forceEnabled = null) {
    const object = state.selectedObject;
    if (!object) {
        return null;
    }
    const profile = getGlowProfile(object, true);
    const enabled = forceEnabled === null ? !profile.enabled : forceEnabled === true;
    setGlowEnabled(object, enabled);
    setStatus(enabled
        ? `Подсветка детали «${getObjectName(object)}» включена.`
        : `Подсветка детали «${getObjectName(object)}» выключена, материал восстановлен.`);
    return profile;
}

function setGlowParameters(values) {
    const object = state.selectedObject;
    const profile = getGlowProfile(object, true);
    if (!profile) {
        return null;
    }
    if (values && typeof values === "object") {
        if (values.kelvin !== undefined) {
            profile.kelvin = clampValue(values.kelvin, GLOW_KELVIN_MIN, GLOW_KELVIN_MAX, profile.kelvin);
        }
        if (values.intensity !== undefined) {
            profile.intensity = clampValue(values.intensity, GLOW_INTENSITY_MIN, GLOW_INTENSITY_MAX, profile.intensity);
        }
        if (values.saturation !== undefined) {
            profile.saturation = clampValue(values.saturation, GLOW_SATURATION_MIN, GLOW_SATURATION_MAX, profile.saturation);
        }
        if (values.size !== undefined) {
            profile.size = clampValue(values.size, GLOW_SIZE_MIN, GLOW_SIZE_MAX, profile.size);
        }
    }
    if (profile.enabled) {
        applyGlowToObject(object);
    }
    return profile;
}

function clearAllGlow() {
    for (const mesh of Array.from(state.glowMaterials.keys())) {
        restoreGlowMaterial(mesh);
    }
    state.glowProfiles.clear();
    state.glowMaterials.clear();
}

function countPermanentEmissiveMaterials() {
    let count = 0;
    for (const mesh of getModelMeshes()) {
        if (state.glowMaterials.has(mesh) || state.selectionMaterials.has(mesh)) {
            continue;
        }
        for (const material of getMeshMaterials(mesh.material)) {
            if (!material || !material.emissive || typeof material.emissive.getHex !== "function") {
                continue;
            }
            if (material.emissive.getHex(state.THREE.SRGBColorSpace) !== 0) {
                count += 1;
            }
        }
    }
    return count;
}

function getInspectorPanelArtifacts() {
    const found = [];
    for (const id of INSPECTOR_REMOVED_IDS) {
        if (document.getElementById(id)) {
            found.push(`id=${id}`);
        }
    }
    for (const className of INSPECTOR_REMOVED_CLASSES) {
        if (document.getElementsByClassName(className).length > 0) {
            found.push(`.${className}`);
        }
    }
    const markup = document.documentElement.outerHTML;
    for (const label of INSPECTOR_REMOVED_LABELS) {
        if (markup.includes(label)) {
            found.push(label);
        }
    }
    return found;
}

function getBeamObserverDirectionVector() {
    const beam = state.beam;
    if (!state.THREE || !beam.light) {
        return null;
    }
    const direction = beam.light.target.position.clone().sub(beam.light.position);
    if (direction.lengthSq() <= 1e-12) {
        return null;
    }
    return direction.normalize();
}

function getBeamObserverAngleDegrees() {
    if (!state.THREE || !state.camera || !state.controls) {
        return null;
    }
    const travel = getBeamObserverDirectionVector();
    const viewForward = state.controls.target.clone().sub(state.camera.position);
    if (!travel || viewForward.lengthSq() <= 1e-12) {
        return null;
    }
    const cosine = Math.min(1, Math.max(-1, travel.dot(viewForward.normalize())));
    return Math.acos(cosine) * 180 / Math.PI;
}

function getBeamObserverDiagnostics() {
    const light = state.beam.light;
    if (!state.THREE || !light || !state.camera || !state.controls) {
        return null;
    }
    light.updateMatrixWorld(true);
    light.target.updateMatrixWorld(true);
    const cameraPosition = state.camera.position.clone();
    const controlsTarget = state.controls.target.clone();
    const lightWorldPosition = light.getWorldPosition(new state.THREE.Vector3());
    const lightTargetWorldPosition = light.target.getWorldPosition(new state.THREE.Vector3());
    return {
        position: lightWorldPosition,
        target: lightTargetWorldPosition,
        camera: cameraPosition,
        controlsTarget,
        positionDeviation: lightWorldPosition.distanceTo(cameraPosition),
        targetDeviation: lightTargetWorldPosition.distanceTo(controlsTarget),
        angleDeg: getBeamObserverAngleDegrees()
    };
}

function getBeamObserverViewCenter() {
    if (state.modelSphereCenter) {
        return state.modelSphereCenter.clone();
    }
    if (state.controls) {
        return state.controls.target.clone();
    }
    return new state.THREE.Vector3(0, 0, 0);
}

function getBeamObserverViewDistance() {
    if (state.defaultCameraPosition && state.defaultCameraTarget) {
        return state.defaultCameraPosition.distanceTo(state.defaultCameraTarget);
    }
    return Math.max(state.modelRadius * 3, 1);
}

function placeBeamObserverView(planId) {
    const plan = BEAM_OBSERVER_VIEW_PLANS.find(item => item.id === planId);
    if (!plan || !state.THREE || !state.camera || !state.controls) {
        return null;
    }
    const direction = new state.THREE.Vector3(plan.direction[0], plan.direction[1], plan.direction[2]).normalize();
    const center = getBeamObserverViewCenter();
    state.controls.target.copy(center);
    state.camera.position.copy(center).addScaledVector(direction, getBeamObserverViewDistance());
    state.controls.update();
    updateCameraClipping();
    state.camera.updateMatrixWorld(true);
    updateBeamLight();
    return plan.id;
}

function countLightManipulatorObjects() {
    let count = 0;
    if (!state.scene) {
        return count;
    }
    state.scene.traverse(object => {
        const userData = object.userData && typeof object.userData === "object" ? object.userData : null;
        if (userData && userData.lightManipulator === true) {
            count += 1;
            return;
        }
        if (object.type === "ArrowHelper" || LIGHT_MANIPULATOR_FORBIDDEN_NAMES.includes(object.name)) {
            count += 1;
        }
    });
    return count;
}

function updateBeamLight() {
    const beam = state.beam;
    if (!state.THREE || !beam.light || !state.camera || !state.controls) {
        return null;
    }
    const colorHex = getBeamColorHex(beam.kelvin, beam.saturation);
    beam.colorHex = colorHex;
    beam.light.color.setHex(colorHex, state.THREE.SRGBColorSpace);
    beam.light.intensity = beam.enabled ? beam.intensity : 0;
    beam.light.visible = beam.enabled;
    beam.light.castShadow = false;
    beam.light.position.copy(state.camera.position);
    beam.light.target.position.copy(state.controls.target);
    beam.light.target.updateWorldMatrix(true, false);
    return beam;
}

function setBeamControlValues(values) {
    const beam = state.beam;
    const source = values && typeof values === "object" ? values : {};
    if (source.kelvin !== undefined) {
        beam.kelvin = clampValue(source.kelvin, BEAM_KELVIN_MIN, BEAM_KELVIN_MAX, beam.kelvin);
    }
    if (source.intensity !== undefined) {
        beam.intensity = clampValue(source.intensity, BEAM_INTENSITY_MIN, BEAM_INTENSITY_MAX, beam.intensity);
    }
    if (source.saturation !== undefined) {
        beam.saturation = clampValue(source.saturation, BEAM_SATURATION_MIN, BEAM_SATURATION_MAX, beam.saturation);
    }
    updateBeamLight();
    return beam;
}

function setBeamEnabled(enabled) {
    const beam = state.beam;
    beam.enabled = enabled === true;
    updateBeamLight();
    setStatus(beam.enabled
        ? `Свет от наблюдателя включён: ${Math.round(beam.kelvin)} К, интенсивность ${beam.intensity.toFixed(2)}.`
        : "Свет от наблюдателя выключен, сцена освещается заполняющим светом.");
    return beam;
}

function resetBeamSettings() {
    const beam = state.beam;
    beam.enabled = true;
    beam.kelvin = BEAM_KELVIN_DEFAULT;
    beam.intensity = BEAM_INTENSITY_DEFAULT;
    beam.saturation = BEAM_SATURATION_DEFAULT;
    updateBeamLight();
    return beam;
}

function getBaseLightDiagnostics() {
    let hemisphereCount = 0;
    let directionalCount = 0;
    let ambientCount = 0;
    let pointCount = 0;
    let spotCount = 0;
    let rectAreaCount = 0;
    let otherCount = 0;
    let shadowCasterCount = 0;
    if (state.scene) {
        state.scene.traverse(object => {
            if (!object.isLight) {
                return;
            }
            if (object.isHemisphereLight) {
                hemisphereCount += 1;
            } else if (object.isDirectionalLight) {
                directionalCount += 1;
            } else if (object.isAmbientLight) {
                ambientCount += 1;
            } else if (object.isPointLight) {
                pointCount += 1;
            } else if (object.isSpotLight) {
                spotCount += 1;
            } else if (object.isRectAreaLight) {
                rectAreaCount += 1;
            } else {
                otherCount += 1;
            }
            if (object.castShadow === true) {
                shadowCasterCount += 1;
            }
        });
    }
    const artifacts = getInspectorPanelArtifacts();
    const permanentEmissiveMaterialCount = countPermanentEmissiveMaterials();
    const beam = state.beam;
    return {
        hemisphereCount,
        directionalCount,
        ambientCount,
        pointCount,
        spotCount,
        rectAreaCount,
        otherCount,
        totalCount: hemisphereCount + directionalCount + ambientCount + pointCount + spotCount + rectAreaCount + otherCount,
        shadowCasterCount,
        permanentEmissiveMaterialCount,
        lightPanelArtifacts: artifacts,
        lightPanelRemoved: artifacts.length === 0,
        hemisphereIntensity: beam.hemisphereLight ? Number(beam.hemisphereLight.intensity) : null,
        ambientIntensity: beam.ambientLight ? Number(beam.ambientLight.intensity) : null,
        keyLightIntensity: beam.light ? Number(beam.light.intensity) : null,
        keyLightCastShadow: beam.light ? beam.light.castShadow === true : null,
        valid: hemisphereCount === 1 && directionalCount === 1 && ambientCount === 1 && pointCount === 0 && spotCount === 0 &&
            rectAreaCount === 0 && otherCount === 0 && shadowCasterCount === 0 &&
            permanentEmissiveMaterialCount === 0 && artifacts.length === 0
    };
}

function getBeamRigDiagnostics() {
    const beam = state.beam;
    const light = beam.light;
    updateBeamLight();
    const observer = light ? getBeamObserverDiagnostics() : null;
    const travelDirection = getBeamObserverDirectionVector();
    const rangesValid = beam.kelvin >= BEAM_KELVIN_MIN && beam.kelvin <= BEAM_KELVIN_MAX &&
        beam.intensity >= BEAM_INTENSITY_MIN && beam.intensity <= BEAM_INTENSITY_MAX &&
        beam.saturation >= BEAM_SATURATION_MIN && beam.saturation <= BEAM_SATURATION_MAX;
    const defaultSettingsValid = beam.enabled === true &&
        Math.round(beam.kelvin) === BEAM_KELVIN_DEFAULT &&
        Math.abs(beam.intensity - BEAM_INTENSITY_DEFAULT) <= BEAM_OBSERVER_POSITION_EPSILON &&
        Math.abs(beam.saturation - BEAM_SATURATION_DEFAULT) <= BEAM_OBSERVER_POSITION_EPSILON;
    const expectedColorHex = getBeamColorHex(beam.kelvin, beam.saturation);
    const actualColorHex = light ? light.color.getHex(state.THREE.SRGBColorSpace) : null;
    const colorMatchesKelvin = actualColorHex === expectedColorHex;
    const gizmoObjectCount = countLightManipulatorObjects();
    const permanentEmissiveMaterialCount = countPermanentEmissiveMaterials();
    const lightPresent = Boolean(light) && light.isDirectionalLight === true;
    const lightInScene = Boolean(light) && light.parent === state.scene;
    const lightTargetInScene = Boolean(light) && light.target.parent === state.scene;
    const positionMatchesCamera = Boolean(observer) && observer.positionDeviation < BEAM_OBSERVER_POSITION_EPSILON;
    const targetMatchesControls = Boolean(observer) && observer.targetDeviation < BEAM_OBSERVER_POSITION_EPSILON;
    const observerAngleDeg = observer ? observer.angleDeg : null;
    const observerAngleValid = observerAngleDeg !== null && observerAngleDeg <= BEAM_OBSERVER_ANGLE_MAX;
    const viewForward = state.camera && state.controls
        ? state.controls.target.clone().sub(state.camera.position)
        : null;
    if (viewForward && viewForward.lengthSq() > 1e-12) {
        viewForward.normalize();
    }
    const travelDirectionMatchesView = isSameDirection(travelDirection, viewForward, BEAM_OBSERVER_POSITION_EPSILON);
    return {
        rangesValid,
        enabled: beam.enabled,
        kelvin: beam.kelvin,
        intensity: beam.intensity,
        saturation: beam.saturation,
        directionLabel: "свет от наблюдателя",
        defaultSettingsValid,
        lightPresent,
        lightInScene,
        lightTargetInScene,
        lightCastShadow: light ? light.castShadow === true : null,
        lightVisible: light ? light.visible === true : null,
        lightIntensity: light ? Number(light.intensity) : null,
        lightColor: actualColorHex === null ? null : colorToHexPadded(actualColorHex),
        keyColorHex: actualColorHex,
        expectedColorHex,
        kelvinColorHex: colorToHexPadded(expectedColorHex),
        colorMatchesKelvin,
        observerPosition: observer ? vectorData(observer.position) : null,
        observerTarget: observer ? vectorData(observer.target) : null,
        cameraPosition: observer ? vectorData(observer.camera) : null,
        controlsTarget: observer ? vectorData(observer.controlsTarget) : null,
        lightPositionDeviation: observer ? observer.positionDeviation : null,
        lightTargetDeviation: observer ? observer.targetDeviation : null,
        lightObserverPositionMatchesCamera: positionMatchesCamera,
        lightTargetMatchesControls: targetMatchesControls,
        observerAngleDeg,
        observerAngleValid,
        travelDirection: travelDirection ? vectorData(travelDirection) : null,
        viewForwardDirection: viewForward ? vectorData(viewForward) : null,
        travelDirectionMatchesView,
        darkLuminanceLimit: BEAM_DARK_LUMINANCE_LIMIT,
        gizmoObjectCount,
        gizmoPresent: gizmoObjectCount > 0,
        modelRadius: state.modelRadius,
        modelDiagonal: state.modelRadius * 2,
        permanentEmissiveMaterialCount,
        valid: rangesValid && defaultSettingsValid && lightPresent &&
            light.castShadow === false && lightInScene && lightTargetInScene &&
            colorMatchesKelvin && gizmoObjectCount === 0 && positionMatchesCamera &&
            targetMatchesControls && observerAngleValid && travelDirectionMatchesView &&
            permanentEmissiveMaterialCount === 0
    };
}

function getGlowDiagnostics() {
    const object = state.selectedObject;
    const profile = getGlowProfile(object, false);
    let emissiveCloneValid = true;
    let emissiveMaterialCount = 0;
    for (const entry of state.glowMaterials.values()) {
        if (materialsIdentical(entry.original, entry.clone)) {
            emissiveCloneValid = false;
        }
        emissiveMaterialCount += getMeshMaterials(entry.clone).length;
    }
    const rangesValid = !profile || (profile.kelvin >= GLOW_KELVIN_MIN && profile.kelvin <= GLOW_KELVIN_MAX &&
        profile.intensity >= GLOW_INTENSITY_MIN && profile.intensity <= GLOW_INTENSITY_MAX &&
        profile.saturation >= GLOW_SATURATION_MIN && profile.saturation <= GLOW_SATURATION_MAX &&
        profile.size >= GLOW_SIZE_MIN && profile.size <= GLOW_SIZE_MAX);
    const enabledPartCount = Array.from(state.glowProfiles.values()).filter(item => item.enabled).length;
    const measurements = state.measurements;
    return {
        rangesValid,
        hasSelection: Boolean(object),
        selectedName: object ? getObjectName(object) : null,
        enabled: Boolean(profile && profile.enabled),
        kelvin: profile ? profile.kelvin : null,
        intensity: profile ? profile.intensity : null,
        saturation: profile ? profile.saturation : null,
        size: profile ? profile.size : null,
        color: profile ? colorToHexPadded(getGlowColorHex(profile.kelvin, profile.saturation)) : null,
        sizeTarget: "радиус подсветки выбранной детали в мм",
        enabledPartCount,
        glowingMeshCount: state.glowMaterials.size,
        emissiveMaterialCount,
        emissiveCloneValid,
        profileCount: state.glowProfiles.size,
        measurementValid: Boolean(measurements && measurements.valid),
        dimensionsMm: measurements && measurements.valid ? measurements.worldSizeMm : null,
        localDimensionsMm: measurements && measurements.valid ? measurements.localSizeMm : null,
        triangleCount: measurements ? measurements.triangleCount : 0,
        meshCount: measurements ? measurements.meshCount : 0,
        animatedPart: Boolean(measurements && measurements.animated),
        valid: rangesValid && emissiveCloneValid
    };
}

function getShadowDiagnostics() {
    let casterCount = 0;
    let receiverCount = 0;
    let lightShadowCount = 0;
    if (state.scene) {
        state.scene.traverse(object => {
            if (object.isLight && object.castShadow === true) {
                lightShadowCount += 1;
            }
            if (object.castShadow === true) {
                casterCount += 1;
            }
            if (object.receiveShadow === true) {
                receiverCount += 1;
            }
        });
    }
    const shadowMapEnabled = Boolean(state.renderer && state.renderer.shadowMap && state.renderer.shadowMap.enabled);
    return {
        shadowMapEnabled,
        shadowMapAutoUpdate: Boolean(state.renderer && state.renderer.shadowMap && state.renderer.shadowMap.autoUpdate),
        casterCount,
        receiverCount,
        lightShadowCount,
        groundVisible: Boolean(state.ground && state.ground.visible),
        valid: !shadowMapEnabled && casterCount === 0 && receiverCount === 0 && lightShadowCount === 0
    };
}

function onCameraChanged() {
    resetPickStack();
    updateCameraClipping();
}

function createScene() {
    const THREE = state.THREE;
    state.scene = new THREE.Scene();
    state.scene.background = createDefaultBackgroundTexture(THREE);
    syncBackgroundControls(`#${DEFAULT_BACKGROUND_TOP_COLOR.toString(16).padStart(6, "0")}`);
    state.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    state.camera.position.set(8, 6, 10);
    state.renderer = new THREE.WebGLRenderer({
        logarithmicDepthBuffer: true,
        antialias: true,
        stencil: false,
        alpha: false,
        powerPreference: "high-performance"
    });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    state.renderer.outputColorSpace = THREE.SRGBColorSpace;
    state.renderer.shadowMap.enabled = false;
    state.renderer.shadowMap.autoUpdate = false;
    state.renderer.shadowMap.needsUpdate = false;
    elements.viewport.appendChild(state.renderer.domElement);

    state.controls = new state.OrbitControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.08;
    state.controls.minDistance = 0.01;
    state.controls.maxDistance = 1000;
    state.controls.screenSpacePanning = true;
    state.controls.target.set(0, 0, 0);
    state.controls.addEventListener("change", onCameraChanged);

    const hemisphereLight = new THREE.HemisphereLight(0xd8e6f4, 0x55616c, BASE_LIGHT_FILL_INTENSITY);
    hemisphereLight.name = "Заполняющий свет";
    hemisphereLight.castShadow = false;
    state.scene.add(hemisphereLight);
    state.beam.hemisphereLight = hemisphereLight;
    const ambientLight = new THREE.AmbientLight(0xffffff, BASE_LIGHT_AMBIENT_INTENSITY);
    ambientLight.name = "Общий рассеянный свет";
    ambientLight.castShadow = false;
    state.scene.add(ambientLight);
    state.beam.ambientLight = ambientLight;
    const keyLight = new THREE.DirectionalLight(getBeamColorHex(BEAM_KELVIN_DEFAULT, BEAM_SATURATION_DEFAULT), BEAM_INTENSITY_DEFAULT);
    keyLight.name = "Свет от наблюдателя";
    keyLight.position.set(8, 6, 10);
    keyLight.castShadow = false;
    state.scene.add(keyLight);
    state.scene.add(keyLight.target);
    state.beam.light = keyLight;
    state.beam.enabled = true;
    state.beam.kelvin = BEAM_KELVIN_DEFAULT;
    state.beam.intensity = BEAM_INTENSITY_DEFAULT;
    state.beam.saturation = BEAM_SATURATION_DEFAULT;
    updateBeamLight();

    state.ground = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
    );
    state.ground.rotation.x = -Math.PI / 2;
    state.ground.position.y = -0.001;
    state.ground.castShadow = false;
    state.ground.receiveShadow = false;
    state.ground.visible = false;
    state.ground.name = "Ground";
    state.scene.add(state.ground);
    disableSceneShadows();

    state.clock = new THREE.Clock();
    state.raycaster = new THREE.Raycaster();
    state.pointer = new THREE.Vector2();
    state.loader = new state.GLTFLoader();
    resizeViewport();
    const resizeObserver = new ResizeObserver(resizeViewport);
    resizeObserver.observe(elements.viewport);
}

function resizeViewport() {
    if (!state.renderer || !state.camera) {
        return;
    }
    const width = Math.max(elements.viewport.clientWidth, 1);
    const height = Math.max(elements.viewport.clientHeight, 1);
    state.camera.aspect = width / height;
    updateCameraClipping();
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(width, height, false);
}

function resetCamera() {
    if (!state.camera || !state.controls) {
        return false;
    }
    state.zoomAnimation = null;
    if (state.defaultCameraPosition && state.defaultCameraTarget) {
        state.camera.position.copy(state.defaultCameraPosition);
        state.controls.target.copy(state.defaultCameraTarget);
    } else {
        state.camera.position.set(8, 6, 10);
        state.controls.target.set(0, 0, 0);
    }
    state.controls.update();
    updateCameraClipping();
    updateBeamLight();
    return true;
}

function getZoomLimits() {
    const clipping = getCameraClippingValues();
    const fitDistance = state.defaultCameraPosition && state.defaultCameraTarget
        ? state.defaultCameraPosition.distanceTo(state.defaultCameraTarget)
        : getCameraDistance();
    return {
        minimum: clipping.minimumDistance,
        maximum: state.controls ? state.controls.maxDistance : Number.POSITIVE_INFINITY,
        fit: fitDistance,
        current: getCameraDistance()
    };
}

function startZoomToDistance(targetDistance) {
    if (!state.camera || !state.controls || !Number.isFinite(targetDistance)) {
        return false;
    }
    const limits = getZoomLimits();
    const position = getCameraDistance();
    if (!(position > 0)) {
        return false;
    }
    const base = state.zoomAnimation ? state.zoomAnimation.to : position;
    const to = clampValue(targetDistance, limits.minimum, limits.maximum, base);
    if (Math.abs(to - base) <= ZOOM_DISTANCE_EPSILON_RATIO * Math.max(1, base)) {
        return false;
    }
    const duration = Math.min(
        ZOOM_MAX_STEP_MS,
        Math.max(ZOOM_MIN_STEP_MS, Math.abs(Math.log(to / position)) * ZOOM_MAX_STEP_MS * 2));
    state.zoomAnimation = { from: position, to, elapsed: 0, duration };
    return true;
}

function zoomCameraByStep(direction) {
    const position = getCameraDistance();
    if (!(position > 0) || !Number.isFinite(direction) || direction === 0) {
        return false;
    }
    const base = state.zoomAnimation ? state.zoomAnimation.to : position;
    return startZoomToDistance(direction > 0 ? base * ZOOM_STEP_FACTOR : base / ZOOM_STEP_FACTOR);
}

function applyZoomAnimation(deltaMs) {
    const animation = state.zoomAnimation;
    if (!animation || !state.camera || !state.controls) {
        return false;
    }
    animation.elapsed = Math.min(animation.duration, animation.elapsed + deltaMs);
    const ratio = animation.duration > 0 ? animation.elapsed / animation.duration : 1;
    const eased = ratio < 0.5 ? 2 * ratio * ratio : 1 - Math.pow(-2 * ratio + 2, 2) / 2;
    const offset = state.camera.position.clone().sub(state.controls.target);
    const length = offset.length();
    if (!(length > 0)) {
        state.zoomAnimation = null;
        return false;
    }
    const distance = animation.from + (animation.to - animation.from) * eased;
    state.camera.position.copy(state.controls.target).addScaledVector(offset, distance / length);
    state.controls.update();
    updateCameraClipping();
    updateBeamLight();
    if (animation.elapsed >= animation.duration) {
        state.zoomAnimation = null;
    }
    return true;
}

function applyZoomAction(action) {
    if (action === "in") {
        return zoomCameraByStep(1);
    }
    if (action === "out") {
        return zoomCameraByStep(-1);
    }
    return false;
}

function getZoomKeyAction(event) {
    if (!event) {
        return null;
    }
    const key = String(event.key || "");
    if (key === "+" || key === "=" || key === "Add") {
        return "in";
    }
    if (key === "-" || key === "_" || key === "Subtract") {
        return "out";
    }
    return null;
}

function waitForZoomSettled() {
    return new Promise(resolve => {
        let frames = 0;
        const check = () => {
            frames += 1;
            if (!state.zoomAnimation || frames >= ZOOM_SETTLE_MAX_FRAMES) {
                resolve();
                return;
            }
            window.requestAnimationFrame(check);
        };
        window.requestAnimationFrame(check);
    });
}

function setPanelsHidden(hidden) {
    state.panelsHidden = hidden === true;
}

function startRenderLoop() {
    const renderFrame = () => {
        state.renderFrame = window.requestAnimationFrame(renderFrame);
        const delta = state.clock.getDelta();
        if (state.mixer && state.animatingClipIndices.size > 0) {
            state.mixer.update(delta);
            updateUnselectedAnimations();
            if (isSelectedClipAnimating()) {
                updateTimedAnimation();
            }
            if (state.measurements && state.measurements.animated) {
                refreshSelectionMeasurements();
            }
        }
        if (state.zoomAnimation) {
            applyZoomAnimation(delta * 1000);
        }
        state.controls.update();
        updateCameraClipping();
        updateBeamLight();
        if (state.displayMode === "transparent" && state.modelRoot) {
            state.scene.updateMatrixWorld(true);
            updateTransparentRenderOrder();
        }
        state.renderer.render(state.scene, state.camera);
        state.renderedFrameCount += 1;
    };
    state.renderFrame = window.requestAnimationFrame(renderFrame);
}

function getModelExtension(fileName) {
    const parts = String(fileName).toLowerCase().split(".");
    return parts.length > 1 ? parts.at(-1) : "";
}

function getGlbJsonDocument(arrayBuffer) {
    if (arrayBuffer.byteLength < 12) {
        throw new Error("Контейнер GLB слишком мал.");
    }
    const view = new DataView(arrayBuffer);
    if (view.getUint32(0, true) !== 0x46546C67) {
        throw new Error("Недопустимое магическое значение GLB.");
    }
    if (view.getUint32(4, true) !== 2) {
        throw new Error("Поддерживается только GLB версии 2.");
    }
    const declaredLength = view.getUint32(8, true);
    if (declaredLength < 12 || declaredLength > arrayBuffer.byteLength) {
        throw new Error("Недопустимая длина контейнера GLB.");
    }
    let offset = 12;
    while (offset + 8 <= declaredLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        if (chunkLength > declaredLength - offset - 8) {
            throw new Error("Фрагмент GLB превышает длину контейнера.");
        }
        if (chunkType === 0x4E4F534A) {
            const jsonBytes = new Uint8Array(arrayBuffer, offset + 8, chunkLength);
            return JSON.parse(new TextDecoder().decode(jsonBytes));
        }
        offset += 8 + chunkLength;
    }
    throw new Error("JSON-фрагмент GLB отсутствует.");
}

function getGltfJsonDocument(fileName, arrayBuffer) {
    return getModelExtension(fileName) === "glb"
        ? getGlbJsonDocument(arrayBuffer)
        : JSON.parse(new TextDecoder().decode(arrayBuffer));
}

function assertLocalReferences(documentModel, resourceBase) {
    for (const collectionName of ["buffers", "images"]) {
        const entries = Array.isArray(documentModel[collectionName]) ? documentModel[collectionName] : [];
        for (const entry of entries) {
            const uri = entry && typeof entry.uri === "string" ? entry.uri : "";
            if (!uri || uri.toLowerCase().startsWith("data:")) {
                continue;
            }
            if (!resourceBase) {
                throw new Error("Для внешних ресурсов glTF требуется проверенный локальный каталог ресурсов.");
            }
            const baseUrl = new URL(resourceBase);
            const resourceUrl = new URL(uri, baseUrl);
            if (resourceUrl.protocol !== "file:") {
                throw new Error("Удалённые ресурсы glTF запрещены в просмотрщике.");
            }
            const decodedPath = decodeURIComponent(resourceUrl.pathname);
            if (decodedPath.split("/").some(segment => segment === "." || segment === "..")) {
                throw new Error("Обход пути к ресурсу glTF запрещён.");
            }
            const baseHref = baseUrl.href.endsWith("/") ? baseUrl.href.toLowerCase() : `${baseUrl.href}/`.toLowerCase();
            if (!resourceUrl.href.toLowerCase().startsWith(baseHref)) {
                throw new Error("Внешние ресурсы glTF должны оставаться внутри выбранного каталога.");
            }
        }
    }
}

function parseModel(arrayBuffer, resourceBase) {
    if (typeof state.loader.parseAsync === "function") {
        return state.loader.parseAsync(arrayBuffer, resourceBase);
    }
    return new Promise((resolve, reject) => {
        state.loader.parse(arrayBuffer, resourceBase, resolve, reject);
    });
}

function disposeMaterial(material, disposedMaterials) {
    if (!material || disposedMaterials.has(material)) {
        return;
    }
    disposedMaterials.add(material);
    for (const value of Object.values(material)) {
        if (value && value.isTexture) {
            value.dispose();
        }
    }
    material.dispose();
}

function disposeObject(object) {
    const disposedGeometries = new Set();
    const disposedMaterials = new Set();
    object.traverse((child) => {
        if (child.geometry && !disposedGeometries.has(child.geometry)) {
            disposedGeometries.add(child.geometry);
            child.geometry.dispose();
        }
        if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const material of materials) {
                disposeMaterial(material, disposedMaterials);
            }
        }
    });
}

function removeSelectionHelper() {
    const helper = state.selectionHelper;
    state.selectionHelper = null;
    if (!helper) {
        return;
    }
    if (state.scene && helper.parent === state.scene) {
        state.scene.remove(helper);
    }
    if (helper.geometry && typeof helper.geometry.dispose === "function") {
        helper.geometry.dispose();
    }
    const materials = Array.isArray(helper.material) ? helper.material : helper.material ? [helper.material] : [];
    for (const material of materials) {
        if (material && typeof material.dispose === "function") {
            material.dispose();
        }
    }
}

function clearModel() {
    state.loadToken += 1;
    removeWireframeOverlays();
    removeSelectionOutlines();
    disposeSelectionOutlineCache();
    state.selectedObject = null;
    state.selectedBlock = null;
    state.selectedObjects = [];
    state.hiddenObjects.clear();
    state.treeBlocks.clear();
    state.treeGroupsByKey.clear();
    state.lastViewportClick = null;
    closeTreeContextMenu();
    clearAllGlow();
    resetBeamSettings();
    resetDisplayMode();
    if (state.mixer) {
        state.mixer.stopAllAction();
        state.mixer = null;
    }
    state.activeAction = null;
    if (state.markerGroup) {
        detachPartMarkers();
    } else {
        state.partMarkers.length = 0;
        state.markers.length = 0;
    }
    if (state.modelRoot) {
        state.scene.remove(state.modelRoot);
        disposeObject(state.modelRoot);
        state.modelRoot = null;
    }
    if (state.markerGroup) {
        state.scene.remove(state.markerGroup);
        disposeObject(state.markerGroup);
        state.markerGroup = null;
    }
    state.partObjects.clear();
    state.fastenerRecords = 0;
    state.holeRecords = 0;
    state.fastenerGeometryRecords = 0;
    state.fastenerSynthesizedRecords = 0;
    state.suppressedFastenerGeometry = 0;
    state.fastenerAxisVectorRecords = 0;
    state.fastenerTiltedAxisRecords = 0;
    state.fastenerAxisVectorErrors = 0;
    removeSelectionHelper();
    state.clips = [];
    state.openSelectionKey = null;
    state.pickTargets = [];
    resetPickStack();
    state.measurements = null;
    state.packageMetadata = null;
    state.packageParts.clear();
    state.animationLookup.clear();
    state.clipSourceIndices.clear();
    state.animationNodeSources.clear();
    state.activeClipIndex = -1;
    state.activeAnimationIndex = null;
    state.hierarchy = {
        defined: false,
        source: "не определена",
        moduleCount: 0,
        blockCount: 0
    };
    state.selectionDiagnostic = {
        selectedObject: null,
        animationIndex: null,
        hierarchySource: "не определена",
        autoOpenSucceeded: false
    };
    state.animationPlaying = false;
    state.animationDirection = "idle";
    state.doorOpen = false;
    state.openPoseTime = 0;
    state.timingClipIndex = -1;
    state.requestedClipIndex = -1;
    state.openClipIndices.clear();
    state.animatingClipIndices.clear();
    state.clipOpenPoseTimes.clear();
    setAnimationTimingDefaults();
    state.defaultCameraPosition = null;
    state.defaultCameraTarget = null;
    state.modelSphereCenter = null;
    state.modelRadius = 0;
    state.zoomAnimation = null;
    state.controls.minDistance = 0.01;
    state.controls.maxDistance = 1000;
    state.treeButtons.clear();
    state.treeGroups.length = 0;
    state.treeGroupsByKey.clear();
    state.renderer.renderLists.dispose();
    resetCamera();
}

function getObjectExtras(object) {
    const userData = object && object.userData && typeof object.userData === "object" ? object.userData : null;
    const nested = userData && userData.extras && typeof userData.extras === "object" ? userData.extras : null;
    if (nested && userData) {
        return { ...nested, ...userData };
    }
    return nested || userData || {};
}

function getSourceFields(object) {
    const extras = getObjectExtras(object);
    if (extras.sourceFields && typeof extras.sourceFields === "object") {
        return extras.sourceFields;
    }
    if (object && object.userData && object.userData.sourceFields && typeof object.userData.sourceFields === "object") {
        return object.userData.sourceFields;
    }
    return {};
}

function getIntegerValue(value) {
    if (typeof value === "number" && Number.isInteger(value)) {
        return value;
    }
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
        return Number(value.trim());
    }
    return null;
}

function getDirectAnimationIndex(object) {
    const userData = object && object.userData && typeof object.userData === "object" ? object.userData : {};
    const nestedUserData = userData.extras && typeof userData.extras === "object" ? userData.extras : null;
    const direct = getIntegerValue(userData.animationIndex);
    if (direct !== null) {
        return direct;
    }
    const nested = nestedUserData ? getIntegerValue(nestedUserData.animationIndex) : null;
    if (nested !== null) {
        return nested;
    }
    const extras = getObjectExtras(object);
    return getIntegerValue(extras.animationIndex);
}

function getSourceAnimationIndex(object) {
    const extras = getObjectExtras(object);
    const sourceIndex = getIntegerValue(extras.sourceAnimationIndex);
    if (sourceIndex !== null) {
        return sourceIndex;
    }
    const fields = getSourceFields(object);
    const fieldIndex = getIntegerValue(fields.animIdx);
    return fieldIndex !== null && fieldIndex >= 0 ? fieldIndex : null;
}

function getAnimationRootNode(object) {
    const extras = getObjectExtras(object);
    const value = extras.animationRootNode;
    if (value && typeof value === "object") {
        return value;
    }
    const numeric = getIntegerValue(value);
    return numeric !== null ? numeric : null;
}

function getPartId(object) {
    const extras = getObjectExtras(object);
    return typeof extras.partId === "string" && extras.partId ? extras.partId : null;
}

function getPackagePart(object) {
    const partId = getPartId(object);
    return partId ? state.packageParts.get(partId) || null : null;
}

function buildPartObjectMap(root) {
    state.partObjects.clear();
    if (!root) {
        return 0;
    }
    root.traverse(object => {
        if (isWireframeOverlay(object) || isWireframeExcludedObject(object)) {
            return;
        }
        const partId = getPartId(object);
        if (!partId) {
            return;
        }
        const depth = getObjectDepth(object);
        const existing = state.partObjects.get(partId);
        if (!existing || depth < existing.depth) {
            state.partObjects.set(partId, { object, depth });
        }
    });
    return state.partObjects.size;
}

function getPartObject(partId) {
    if (typeof partId !== "string" || !partId) {
        return null;
    }
    const entry = state.partObjects.get(partId);
    return entry ? entry.object : null;
}

function detachPartMarkers() {
    const group = state.markerGroup;
    for (const marker of state.partMarkers) {
        if (marker.parent) {
            marker.parent.remove(marker);
        }
        if (group) {
            group.add(marker);
        }
    }
    state.partMarkers.length = 0;
    state.markers.length = 0;
}

function getObjectName(object, fallbackIndex = 0) {
    const userData = object && object.userData && typeof object.userData === "object" ? object.userData : {};
    const extras = getObjectExtras(object);
    if (typeof userData.viewerName === "string" && userData.viewerName) {
        return userData.viewerName;
    }
    if (typeof extras.viewerName === "string" && extras.viewerName) {
        return extras.viewerName;
    }
    if (typeof extras.partName === "string" && extras.partName) {
        return extras.partName;
    }
    const packagePart = getPackagePart(object);
    if (packagePart && typeof packagePart.name === "string" && packagePart.name) {
        return packagePart.name;
    }
    if (object && object.name) {
        return object.name;
    }
    return `Деталь_${fallbackIndex}`;
}

function getObjectTypeLabel(type) {
    if (type === "Mesh") {
        return "Меш";
    }
    if (type === "Group") {
        return "Группа";
    }
    if (type === "Scene") {
        return "Сцена";
    }
    if (type === "Object3D") {
        return "Объект 3D";
    }
    if (type === "SkinnedMesh") {
        return "Меш со скелетом";
    }
    if (type === "InstancedMesh") {
        return "Экземпляр меша";
    }
    if (type === "Bone") {
        return "Кость";
    }
    if (type === "Line") {
        return "Линия";
    }
    if (type === "LineSegments") {
        return "Сегменты линии";
    }
    if (type === "Points") {
        return "Точки";
    }
    return type || "Объект";
}

function assignObjectIdentity(root) {
    let index = 0;
    root.traverse((object) => {
        if (!object.userData.viewerId) {
            object.userData.viewerId = `object_${index}`;
        }
        if (!object.userData.viewerName) {
            object.userData.viewerName = getObjectName(object, index);
        }
        index += 1;
    });
    return index;
}

function getPackageParts(metadata) {
    return metadata && Array.isArray(metadata.parts) ? metadata.parts : [];
}

function preparePackageMetadata(metadata) {
    state.packageMetadata = metadata && typeof metadata === "object" ? metadata : null;
    state.packageParts.clear();
    for (const part of getPackageParts(state.packageMetadata)) {
        if (!part || typeof part !== "object" || typeof part.id !== "string" || !part.id) {
            continue;
        }
        const sourceFields = part.sourceFields && typeof part.sourceFields === "object"
            ? part.sourceFields
            : part.metadata && part.metadata.sourceFields && typeof part.metadata.sourceFields === "object"
                ? part.metadata.sourceFields
                : null;
        state.packageParts.set(part.id, {
            id: part.id,
            name: typeof part.name === "string" ? part.name : "",
            parentId: typeof part.parentId === "string" ? part.parentId : "",
            sourceFields
        });
    }
}

function getModuleNames(metadata) {
    const candidates = [];
    if (metadata && Array.isArray(metadata.modules)) {
        candidates.push(metadata.modules);
    }
    if (metadata && metadata.model && metadata.model.metadata && metadata.model.metadata.sourceManifest &&
        Array.isArray(metadata.model.metadata.sourceManifest.modules)) {
        candidates.push(metadata.model.metadata.sourceManifest.modules);
    }
    if (metadata && metadata.sourceManifest && Array.isArray(metadata.sourceManifest.modules)) {
        candidates.push(metadata.sourceManifest.modules);
    }
    const modules = candidates.find(candidate => candidate.length > 0) || candidates[0] || [];
    return modules.map(module => {
        if (typeof module === "string" && module.trim()) {
            return module.trim();
        }
        if (module && typeof module === "object" && typeof module.name === "string" && module.name.trim()) {
            return module.name.trim();
        }
        return null;
    });
}

function getObjectDepth(object) {
    let depth = 0;
    for (let current = object; current; current = current.parent) {
        depth += 1;
    }
    return depth;
}

function getPartBlockIndex(object) {
    const extras = getObjectExtras(object);
    const fields = getSourceFields(object);
    const packagePart = getPackagePart(object);
    const packageFields = packagePart && packagePart.sourceFields ? packagePart.sourceFields : {};
    const value = fields.blockIdx ?? extras.blockIdx ?? packageFields.blockIdx;
    const index = getIntegerValue(value);
    return index !== null && index >= 0 ? index : null;
}

function getPartAnimationIndex(object) {
    const extras = getObjectExtras(object);
    const fields = getSourceFields(object);
    const packagePart = getPackagePart(object);
    const packageFields = packagePart && packagePart.sourceFields ? packagePart.sourceFields : {};
    const value = fields.animIdx ?? extras.animIdx ?? packageFields.animIdx;
    const index = getIntegerValue(value);
    return index !== null && index >= 0 ? index : null;
}

function getOwnAnimationFieldIndex(object) {
    const extras = getObjectExtras(object);
    const fields = getSourceFields(object);
    return getIntegerValue(fields.animIdx ?? extras.animIdx);
}

function getOwnAnimationDeclaration(object) {
    const direct = getDirectAnimationIndex(object);
    if (direct !== null && direct >= 0) {
        return { sourceIndex: direct, source: "animationIndex" };
    }
    const sourceIndex = getIntegerValue(getObjectExtras(object).sourceAnimationIndex);
    if (sourceIndex !== null && sourceIndex >= 0) {
        return { sourceIndex, source: "sourceAnimationIndex" };
    }
    const fieldIndex = getOwnAnimationFieldIndex(object);
    if (fieldIndex !== null && fieldIndex >= 0) {
        return { sourceIndex: fieldIndex, source: "sourceFields.animIdx" };
    }
    const rootReference = resolveAnimationRootReference(object);
    if (rootReference !== null && rootReference.sourceIndex >= 0) {
        return { sourceIndex: rootReference.sourceIndex, source: "extras.animationRootNode" };
    }
    return null;
}

function isMeshInsidePart(object, ancestor) {
    if (!object || !ancestor || object === ancestor || !object.isMesh) {
        return false;
    }
    for (let current = object; current; current = current.parent) {
        if (current === ancestor) {
            return true;
        }
        if (current !== object && getPartId(current) !== null) {
            return false;
        }
    }
    return false;
}

function canBindAnimationFrom(object, ancestor, sourceIndex) {
    if (!object || !ancestor) {
        return false;
    }
    if (object === ancestor) {
        return true;
    }
    if (getOwnAnimationDeclaration(object) === null && getOwnAnimationFieldIndex(object) !== null) {
        return false;
    }
    const objectPartId = getPartId(object);
    if (objectPartId !== null) {
        if (getPartId(ancestor) === objectPartId) {
            return true;
        }
        const own = getOwnAnimationDeclaration(object);
        return Boolean(own && own.sourceIndex === sourceIndex);
    }
    return isMeshInsidePart(object, ancestor);
}

function collectPartRecords(root) {
    const records = new Map();
    root.traverse(object => {
        const partId = getPartId(object);
        if (!partId) {
            return;
        }
        let record = records.get(partId);
        if (!record) {
            record = {
                id: partId,
                objects: [],
                blockIndex: null,
                animationIndex: null,
                blockConflict: false,
                animationConflict: false
            };
            records.set(partId, record);
        }
        record.objects.push({ object, depth: getObjectDepth(object) });
        const blockIndex = getPartBlockIndex(object);
        if (blockIndex !== null) {
            if (record.blockIndex === null) {
                record.blockIndex = blockIndex;
            } else if (record.blockIndex !== blockIndex) {
                record.blockConflict = true;
            }
        }
        const animationIndex = getPartAnimationIndex(object);
        if (animationIndex !== null) {
            if (record.animationIndex === null) {
                record.animationIndex = animationIndex;
            } else if (record.animationIndex !== animationIndex) {
                record.animationConflict = true;
            }
        }
    });
    for (const record of records.values()) {
        record.objects.sort((first, second) => first.depth - second.depth);
        record.canonical = record.objects.length > 0 ? record.objects[0].object : null;
    }
    return records;
}

function buildHierarchyModel(root, packageMetadata) {
    const moduleNames = getModuleNames(packageMetadata);
    const records = collectPartRecords(root);
    let validBlockCount = 0;
    let invalidBlockCount = 0;
    for (const record of records.values()) {
        if (record.blockConflict) {
            invalidBlockCount += 1;
            continue;
        }
        if (record.blockIndex === null) {
            continue;
        }
        if (record.blockIndex >= 0 && record.blockIndex < moduleNames.length && moduleNames[record.blockIndex]) {
            validBlockCount += 1;
        } else {
            invalidBlockCount += 1;
        }
    }
    const moduleDefinitionsValid = moduleNames.length > 0 && moduleNames.every(name => typeof name === "string");
    const defined = moduleDefinitionsValid && validBlockCount > 0 && invalidBlockCount === 0;
    const moduleBlocks = new Map();
    const unassigned = [];
    const usedBlocks = new Set();
    if (defined) {
        for (const record of records.values()) {
            if (record.blockIndex === null || record.blockConflict || !moduleNames[record.blockIndex]) {
                unassigned.push(record);
                continue;
            }
            const blockKey = record.blockIndex;
            usedBlocks.add(blockKey);
            if (!moduleBlocks.has(blockKey)) {
                moduleBlocks.set(blockKey, []);
            }
            moduleBlocks.get(blockKey).push(record);
        }
    } else {
        for (const record of records.values()) {
            unassigned.push(record);
        }
    }
    return {
        defined,
        source: defined ? "модули и sourceFields.blockIdx" : "иерархия объектов GLB",
        moduleNames,
        records,
        moduleBlocks,
        unassigned,
        moduleCount: moduleNames.length,
        blockCount: usedBlocks.size
    };
}

function appendTreeGroup(label, parentList, block = null) {
    const item = document.createElement("li");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tree-group-row tree-group-toggle";
    const arrow = document.createElement("span");
    arrow.className = "tree-group-arrow";
    arrow.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "tree-group-label";
    text.textContent = label;
    text.title = label;
    const count = document.createElement("span");
    count.className = "tree-group-count";
    count.textContent = "0";
    toggle.append(arrow, text, count);
    const childList = document.createElement("ul");
    childList.className = "tree-group-children";
    item.append(toggle, childList);
    parentList.appendChild(item);
    const group = {
        item,
        toggle,
        childList,
        label,
        block,
        expanded: false,
        setExpanded(value) {
            const expanded = value === true;
            group.expanded = expanded;
            toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
            toggle.setAttribute("aria-label", `${expanded ? "Развернуть" : "Свернуть"} группу ${label}`);
            childList.hidden = !expanded;
        },
        refreshCount() {
            count.textContent = String(childList.querySelectorAll("li").length);
        }
    };
    toggle.addEventListener("click", () => {
        if (block) {
            selectBlock(block);
        }
        group.setExpanded(!group.expanded);
        updateCollapseAllButton();
    });
    if (block) {
        toggle.dataset.selectable = "true";
        toggle.dataset.selected = "false";
        toggle.dataset.hidden = "false";
        toggle.addEventListener("contextmenu", event => {
            event.preventDefault();
            event.stopPropagation();
            openTreeContextMenu(event.clientX, event.clientY, { kind: "block", block });
        });
        state.treeGroupsByKey.set(block.key, group);
    }
    group.setExpanded(false);
    state.treeGroups.push(group);
    return group;
}

function updateCollapseAllButton() {}

function collapseAllTreeGroups() {}

function expandAncestorGroups(object) {
    const button = state.treeButtons.get(object);
    if (!button) {
        return false;
    }
    let changed = false;
    for (let parent = button.parentElement; parent; parent = parent.parentElement) {
        if (parent.classList && parent.classList.contains("tree-group-children") && parent.hidden) {
            const group = state.treeGroups.find(item => item.childList === parent);
            if (group) {
                group.setExpanded(true);
                changed = true;
            }
        }
    }
    if (changed) {
        updateCollapseAllButton();
    }
    return changed;
}

function getTreeDiagnostics() {
    return {
        valid: true,
        controlsValid: true,
        groupCount: 0,
        collapsedGroups: 0,
        expandedGroups: 0,
        hiddenMarkedRows: 0
    };
}

function appendObjectTreeNode(object, parentList, assigned, allowedPartId = null) {
    if (!object || assigned.has(object) || isWireframeOverlay(object) || isWireframeExcludedObject(object)) {
        return null;
    }
    assigned.add(object);
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "object-button";
    const name = document.createElement("span");
    name.textContent = getObjectName(object);
    name.title = name.textContent;
    const type = document.createElement("span");
    type.className = "object-type";
    type.textContent = getObjectTypeLabel(object.type);
    const hiddenTag = document.createElement("span");
    hiddenTag.className = "object-hidden-tag";
    hiddenTag.textContent = "скрыта";
    hiddenTag.hidden = !state.hiddenObjects.has(object);
    button.append(name, type, hiddenTag);
    button.dataset.hidden = state.hiddenObjects.has(object) ? "true" : "false";
    button.addEventListener("click", () => selectObject(object));
    button.addEventListener("dblclick", event => {
        event.preventDefault();
        event.stopPropagation();
        selectObject(object);
        toggleAnimatedObject(object);
    });
    button.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        openTreeContextMenu(event.clientX, event.clientY, { kind: "part", object });
    });
    item.appendChild(button);
    parentList.appendChild(item);
    state.treeButtons.set(object, button);
    const childList = document.createElement("ul");
    for (const child of object.children) {
        if (isWireframeOverlay(child) || isWireframeExcludedObject(child)) {
            continue;
        }
        const childPartId = getPartId(child);
        if (allowedPartId !== null && childPartId !== null && childPartId !== allowedPartId) {
            continue;
        }
        appendObjectTreeNode(child, childList, assigned, allowedPartId);
    }
    if (childList.childElementCount > 0) {
        item.appendChild(childList);
    }
    return { item, childList };
}

function appendPartRecord(record, parentList, assigned) {
    if (!record.canonical) {
        return;
    }
    const result = appendObjectTreeNode(record.canonical, parentList, assigned, record.id);
    if (!result) {
        return;
    }
    const childList = document.createElement("ul");
    for (const entry of record.objects) {
        if (!assigned.has(entry.object)) {
            appendObjectTreeNode(entry.object, childList, assigned, record.id);
        }
    }
    if (childList.childElementCount > 0) {
        result.item.appendChild(childList);
    }
}

function createTreeBlock(moduleIndex, blockIndex, moduleName, records) {
    const objects = [];
    const seen = new Set();
    for (const record of records) {
        if (!record.canonical || seen.has(record.canonical)) {
            continue;
        }
        seen.add(record.canonical);
        objects.push(record.canonical);
    }
    return {
        key: `block:${moduleIndex}:${blockIndex}`,
        moduleIndex,
        blockIndex,
        moduleLabel: `Блок ${blockIndex + 1}`,
        moduleName,
        records,
        objects
    };
}

function buildObjectTree(root, packageMetadata) {
    return 0;
}

function collectPartMarkersOf(object) {
    const markers = [];
    for (const marker of state.partMarkers) {
        if (isDescendantObject(marker, object) || marker === object) {
            markers.push(marker);
        }
    }
    return markers;
}

function setObjectHidden(object, hidden) {
    for (const marker of collectPartMarkersOf(object)) {
        marker.visible = !hidden;
    }
    object.visible = !hidden;
    if (hidden) {
        state.hiddenObjects.add(object);
    } else {
        state.hiddenObjects.delete(object);
    }
}

function hideTreeObjects(objects) {
    let affected = 0;
    for (const object of objects) {
        if (state.hiddenObjects.has(object)) {
            continue;
        }
        setObjectHidden(object, true);
        affected += 1;
    }
    return affected;
}

function showAllTreeObjects() {
    const affected = state.hiddenObjects.size;
    for (const object of Array.from(state.hiddenObjects)) {
        setObjectHidden(object, false);
    }
    return affected;
}

function isBlockHidden(block) {
    return Boolean(block) && block.objects.some(object => state.hiddenObjects.has(object));
}

function refreshVisibilityState() {
    refreshTreeSelectionState();
    refreshPickTargets();
    if (state.selectedObjects.some(object => state.hiddenObjects.has(object))) {
        applySelectionTarget(null, null);
    }
}

const TREE_CONTEXT_MENU_ITEMS = [
    { id: "hide", label: "Скрыть блок", kinds: ["block"] },
    { id: "hide", label: "Скрыть деталь", kinds: ["part"] },
    { id: "select", label: "Выделить блок", kinds: ["block"] },
    { id: "select", label: "Выделить деталь", kinds: ["part"] },
    { id: "toggle-door", label: "Открыть", kinds: ["part"], animated: true },
    { id: "toggle-playback", label: "Воспроизвести", kinds: ["part"], animated: true },
    { id: "reset-animation", label: "Сбросить анимацию", kinds: ["part"], animated: true },
    { id: "show-all", label: "Показать всё", kinds: ["block", "part"] }
];

function getTreeContextMenuTargetAnimation(target) {
    if (target.kind !== "part" || !target.object) {
        return null;
    }
    const binding = findAnimationBinding(target.object);
    return binding.valid ? binding : null;
}

function getTreeContextMenuEntries(target) {
    const hidden = state.hiddenObjects.size;
    const animation = getTreeContextMenuTargetAnimation(target);
    const key = animation ? getSelectionKey(target.object, animation) : null;
    return TREE_CONTEXT_MENU_ITEMS
        .filter(item => item.kinds.includes(target.kind))
        .filter(item => !item.animated || animation !== null)
        .map(item => {
            if (item.id === "show-all") {
                return { ...item, disabled: hidden === 0 };
            }
            if (item.id === "hide") {
                const objects = target.kind === "block" ? target.block.objects : [target.object];
                return { ...item, disabled: !objects.some(object => !state.hiddenObjects.has(object)) };
            }
            if (item.id === "toggle-door") {
                return { ...item, label: isSelectionOpen(key) ? "Закрыть" : "Открыть", disabled: false };
            }
            if (item.id === "toggle-playback") {
                const clipIndex = animation.clipIndex;
                return { ...item, label: state.animatingClipIndices.has(clipIndex) ? "Пауза" : "Воспроизвести", disabled: false };
            }
            return { ...item, disabled: false };
        });
}

function closeTreeContextMenu() {}

function runTreeContextMenuAction(id, target) {
    closeTreeContextMenu();
    if (id === "show-all") {
        const restored = showAllTreeObjects();
        refreshVisibilityState();
        setStatus(restored > 0
            ? `Показаны все детали: восстановлено ${restored}. Дерево и диагностика обновлены.`
            : "Скрытых деталей нет, видимость уже полная.");
        return;
    }
    if (id === "hide") {
        const objects = target.kind === "block" ? target.block.objects : [target.object];
        const hidden = hideTreeObjects(objects);
        refreshVisibilityState();
        setStatus(target.kind === "block"
            ? `Скрыт блок ${target.block.blockIndex + 1}: деталей — ${hidden}. Выбор мышью их больше не ловит.`
            : `Скрыта деталь «${getObjectName(target.object)}». Выбор мышью её больше не ловит.`);
        return;
    }
    if (id === "toggle-door" || id === "toggle-playback" || id === "reset-animation") {
        if (!activateTreePartAnimation(target)) {
            return;
        }
        if (id === "reset-animation") {
            setStatus(resetSelectedAnimation()
                ? `Анимация детали «${getObjectName(target.object)}» сброшена в исходное положение.`
                : "У детали нет подготовленной анимации.");
            return;
        }
        if (id === "toggle-playback") {
            setStatus(toggleAnimation()
                ? "Воспроизведение связанной анимации детали переключено."
                : "У детали нет подготовленной анимации.");
            return;
        }
        toggleAnimatedObject(target.object);
        return;
    }
    if (target.kind === "block") {
        selectBlock(target.block);
        return;
    }
    selectObject(target.object);
}

function activateTreePartAnimation(target) {
    const animation = getTreeContextMenuTargetAnimation(target);
    if (!animation) {
        setStatus(`У детали «${getObjectName(target.object)}» нет связанной анимации.`);
        return false;
    }
    selectObject(target.object);
    return selectAnimation(animation.clipIndex);
}

function openTreeContextMenu() {
    return false;
}

function getAnimationIndexFromRecord(record) {
    if (!record || typeof record !== "object") {
        return null;
    }
    const extras = record.extras && typeof record.extras === "object" ? record.extras : record;
    return getIntegerValue(extras.animationIndex);
}

function buildAnimationLookup(gltf, documentModel) {
    state.animationLookup.clear();
    state.clipSourceIndices.clear();
    state.animationNodeSources.clear();
    const clips = Array.isArray(gltf && gltf.animations) ? gltf.animations : [];
    const documentAnimations = documentModel && Array.isArray(documentModel.animations) ? documentModel.animations : [];
    for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
        const clip = clips[clipIndex];
        if (!clip || !Array.isArray(clip.tracks) || clip.tracks.length === 0) {
            continue;
        }
        const clipExtras = getObjectExtras(clip);
        let sourceIndex = getIntegerValue(clipExtras.animationIndex);
        if (sourceIndex === null && clipIndex < documentAnimations.length) {
            sourceIndex = getAnimationIndexFromRecord(documentAnimations[clipIndex]);
        }
        if (sourceIndex === null || sourceIndex < 0) {
            continue;
        }
        if (!state.animationLookup.has(sourceIndex)) {
            state.animationLookup.set(sourceIndex, clipIndex);
            state.clipSourceIndices.set(clipIndex, sourceIndex);
        }
    }
    const documentNodes = documentModel && Array.isArray(documentModel.nodes) ? documentModel.nodes : [];
    documentNodes.forEach((node, nodeIndex) => {
        const sourceIndex = getAnimationIndexFromRecord(node);
        if (sourceIndex !== null && sourceIndex >= 0) {
            state.animationNodeSources.set(nodeIndex, sourceIndex);
        }
    });
}

function getClipIndexForSource(sourceIndex) {
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0) {
        return null;
    }
    const clipIndex = state.animationLookup.get(sourceIndex);
    if (!Number.isInteger(clipIndex) || clipIndex < 0 || clipIndex >= state.clips.length) {
        return null;
    }
    const clip = state.clips[clipIndex];
    return clip && Array.isArray(clip.tracks) && clip.tracks.length > 0 ? clipIndex : null;
}

function findAncestorWithAnimationIndex(object, animationIndex) {
    for (let current = object; current; current = current.parent) {
        if (getDirectAnimationIndex(current) === animationIndex) {
            return current;
        }
    }
    return null;
}

function resolveAnimationRootReference(object) {
    const reference = getAnimationRootNode(object);
    if (reference === null) {
        return null;
    }
    if (typeof reference === "object") {
        const sourceIndex = getDirectAnimationIndex(reference);
        return sourceIndex === null ? null : { sourceIndex, root: reference };
    }
    const sourceIndex = state.animationNodeSources.get(reference);
    return sourceIndex === undefined ? null : { sourceIndex, root: null };
}

function findAnimationBinding(object) {
    if (!object) {
        return { valid: false, message: "Объект не выбран." };
    }
    const chain = [];
    for (let current = object; current; current = current.parent) {
        chain.push(current);
    }
    let invalidReference = false;
    for (const current of chain) {
        const animationIndex = getDirectAnimationIndex(current);
        if (animationIndex === null) {
            continue;
        }
        if (!canBindAnimationFrom(object, current, animationIndex)) {
            continue;
        }
        const clipIndex = getClipIndexForSource(animationIndex);
        if (clipIndex === null) {
            invalidReference = true;
            continue;
        }
        return {
            valid: true,
            sourceIndex: animationIndex,
            clipIndex,
            root: findAncestorWithAnimationIndex(object, animationIndex),
            source: current === object ? "собственный animationIndex" : "прямой animationIndex"
        };
    }
    for (const current of chain) {
        const sourceIndex = getSourceAnimationIndex(current);
        if (sourceIndex !== null) {
            if (!canBindAnimationFrom(object, current, sourceIndex)) {
                continue;
            }
            const clipIndex = getClipIndexForSource(sourceIndex);
            if (clipIndex === null) {
                invalidReference = true;
            } else {
                const root = findAncestorWithAnimationIndex(object, sourceIndex);
                return {
                    valid: true,
                    sourceIndex,
                    clipIndex,
                    root,
                    source: getIntegerValue(getSourceFields(current).animIdx) === sourceIndex
                        ? "sourceFields.animIdx"
                        : "sourceAnimationIndex"
                };
            }
        }
        const rootReference = resolveAnimationRootReference(current);
        if (rootReference !== null) {
            if (!canBindAnimationFrom(object, current, rootReference.sourceIndex)) {
                continue;
            }
            const clipIndex = getClipIndexForSource(rootReference.sourceIndex);
            if (clipIndex === null) {
                invalidReference = true;
            } else {
                const root = rootReference.root || findAncestorWithAnimationIndex(object, rootReference.sourceIndex);
                return {
                    valid: true,
                    sourceIndex: rootReference.sourceIndex,
                    clipIndex,
                    root,
                    source: "extras.animationRootNode"
                };
            }
        }
    }
    return {
        valid: false,
        message: invalidReference
            ? "Указанная анимация не найдена в списке клипов."
            : "Связанная анимация не найдена в списке клипов."
    };
}

function getAnimationBindingDiagnostics() {
    const result = {
        clipCount: state.clips.length,
        clipCountBySource: state.clipSourceIndices.size,
        animationRootCount: 0,
        inheritedPartCount: 0,
        declaredNegativeParts: 0,
        declaredNegativeNodes: 0,
        boundNegativeParts: 0,
        boundNegativePartIds: [],
        declaredFirstParts: 0,
        declaredFirstClipIndexes: [],
        declaredFirstViolationPartIds: [],
        skippedNoAnimations: false,
        valid: false
    };
    if (!state.modelRoot) {
        return result;
    }
    const negativePartIds = new Set();
    const firstPartIds = new Set();
    const firstClipIndexes = new Set();
    state.modelRoot.traverse(object => {
        if (isWireframeOverlay(object) || isWireframeExcludedObject(object)) {
            return;
        }
        const extras = getObjectExtras(object);
        if (getDirectAnimationIndex(object) !== null) {
            result.animationRootCount += 1;
            if (getIntegerValue(extras.inheritedFromBlock) === 1) {
                result.inheritedPartCount += 1;
            }
        }
        const partId = getPartId(object);
        if (partId === null) {
            return;
        }
        const declaredIndex = getIntegerValue(extras.sourceAnimationFieldIndex);
        if (declaredIndex === -1) {
            result.declaredNegativeNodes += 1;
            if (negativePartIds.has(partId)) {
                return;
            }
            negativePartIds.add(partId);
            result.declaredNegativeParts += 1;
            const bound = findAnimationBinding(object);
            const unbound = getDirectAnimationIndex(object) === null &&
                getSourceAnimationIndex(object) === null &&
                resolveAnimationRootReference(object) === null &&
                findAnimationAncestor(object) === null &&
                !bound.valid;
            if (!unbound) {
                result.boundNegativeParts += 1;
                result.boundNegativePartIds.push(partId);
            }
            return;
        }
        if (declaredIndex === 0) {
            if (firstPartIds.has(partId)) {
                return;
            }
            firstPartIds.add(partId);
            result.declaredFirstParts += 1;
            const binding = findAnimationBinding(object);
            if (!binding.valid || binding.clipIndex !== 0 || binding.sourceIndex !== 0) {
                result.declaredFirstViolationPartIds.push(partId);
                return;
            }
            firstClipIndexes.add(binding.clipIndex);
        }
    });
    result.declaredFirstClipIndexes = Array.from(firstClipIndexes).sort((a, b) => a - b);
    result.skippedNoAnimations = result.clipCount === 0;
    const commonValid = result.inheritedPartCount === 0 &&
        result.declaredNegativeParts > 0 &&
        result.boundNegativeParts === 0 &&
        result.declaredFirstViolationPartIds.length === 0;
    result.valid = commonValid && (result.skippedNoAnimations
        ? result.declaredFirstParts === 0 && result.declaredFirstClipIndexes.length === 0
        : result.declaredFirstParts > 0 &&
            result.declaredFirstClipIndexes.length === 1 &&
            result.declaredFirstClipIndexes[0] === 0);
    return result;
}

function pauseCurrentAnimation() {
    if (state.activeAction && isSelectedClipAnimating()) {
        state.activeAction.paused = true;
        state.animatingClipIndices.delete(state.activeClipIndex);
        refreshAnimationPlayingState();
        updateAnimationTimingControls();
    }
}

function getSelectionKey(object, binding) {
    const partId = getPartId(object);
    if (partId) {
        return `part:${partId}`;
    }
    if (binding && binding.root && binding.root.uuid) {
        return `root:${binding.root.uuid}`;
    }
    return object && object.uuid ? `object:${object.uuid}` : "object";
}

function getBlockSelectionKey(block) {
    return block ? `block:${block.moduleIndex}:${block.blockIndex}` : "block";
}

function publishSelectionDiagnostic(object, binding, autoOpenSucceeded) {
    const selectedObject = object ? getObjectName(object) : null;
    const selectedObjectId = object && object.userData && typeof object.userData.viewerId === "string"
        ? object.userData.viewerId
        : null;
    const animationIndex = binding && binding.valid ? binding.sourceIndex : null;
    state.selectionDiagnostic = {
        selectedObject,
        selectedObjectId,
        animationIndex,
        hierarchySource: state.hierarchy.source,
        autoOpenSucceeded: Boolean(autoOpenSucceeded),
        activeClipIndex: state.activeClipIndex,
        animationDirection: state.animationDirection,
        doorOpen: state.doorOpen
    };
    sendToHost({
        type: "selectionDiagnostic",
        selectedObject,
        selectedObjectId,
        animationIndex,
        hierarchySource: state.hierarchy.source,
        autoOpenSucceeded: Boolean(autoOpenSucceeded),
        activeClipIndex: state.activeClipIndex,
        animationDirection: state.animationDirection,
        doorOpen: state.doorOpen
    });
}

function refreshTreeSelectionState() {
    for (const [treeObject, button] of state.treeButtons) {
        button.classList.toggle("selected", treeObject === state.selectedObject);
        const hidden = state.hiddenObjects.has(treeObject);
        button.dataset.hidden = hidden ? "true" : "false";
        const tag = button.querySelector(".object-hidden-tag");
        if (tag) {
            tag.hidden = !hidden;
        }
    }
    for (const [key, group] of state.treeGroupsByKey) {
        group.toggle.dataset.selected = state.selectedBlock && state.selectedBlock.key === key ? "true" : "false";
        group.toggle.dataset.hidden = group.block && isBlockHidden(group.block) ? "true" : "false";
    }
}

function applySelectionTarget(object, block) {
    state.selectedObject = object || null;
    state.selectedBlock = block || null;
    state.selectedObjects = block ? block.objects.slice() : (object ? [object] : []);
    refreshTreeSelectionState();
    if (object) {
        expandAncestorGroups(object);
    }
    removeSelectionHelper();
    applySelectionOutlines(object || null, state.selectedObjects);
    if (state.selectedObjects.length === 0) {
        state.measurements = null;
        publishSelectionDiagnostic(null, null, false);
        return;
    }
    if (block) {
        const blockSummary = `Блок ${block.blockIndex + 1}, деталей: ${block.objects.length}`;
        refreshSelectionMeasurements();
        sendToHost({
            type: "selectionChanged",
            id: getBlockSelectionKey(block),
            name: blockSummary,
            objectType: "Block"
        });
        pauseCurrentAnimation();
        setStatus(getBlockSelectionStatus(block));
        publishSelectionDiagnostic(null, null, false);
        return;
    }
    const name = getObjectName(object);
    refreshSelectionMeasurements();
    sendToHost({ type: "selectionChanged", id: object.userData.viewerId, name, objectType: object.type || "Object" });

    const binding = findAnimationBinding(object);
    if (!binding.valid) {
        pauseCurrentAnimation();
        setStatus(state.clips.length === 0
            ? `Деталь «${name}» выбрана. В модели нет анимаций.`
            : binding.message);
        publishSelectionDiagnostic(object, binding, false);
        return;
    }
    setStatus(`Деталь «${name}» выбрана. Двойной щелчок плавно открывает или закрывает анимацию.`);
    publishSelectionDiagnostic(object, binding, false);
}

function selectObject(object) {
    applySelectionTarget(object, null);
}

function selectBlock(block) {
    applySelectionTarget(null, block || null);
}

function isEscapeKey(event) {
    return Boolean(event) && (event.key === "Escape" || event.key === "Esc" || event.code === "Escape");
}

function isEditableInputElement(element) {
    if (!element || element.nodeType !== 1) {
        return false;
    }
    const tagName = String(element.tagName || "").toLowerCase();
    if (tagName !== "input" && tagName !== "textarea") {
        return false;
    }
    const type = String(element.type || "text").toLowerCase();
    return !["checkbox", "radio", "button", "submit", "reset", "file", "color", "range"].includes(type);
}

function getActiveEditableInput() {
    const active = document.activeElement;
    return isEditableInputElement(active) ? active : null;
}

function clearSelectionByEscape() {
    const hadSelection = Boolean(state.selectedObject);
    const focusedInput = getActiveEditableInput();
    selectObject(null);
    const result = {
        hadSelection,
        cleared: hadSelection,
        inputFocused: Boolean(focusedInput),
        inputValueKept: null,
        inputFocusKept: null,
        outlineCount: getSelectionOutlineDiagnostics().count,
        outlineVisibleCount: getSelectionOutlineDiagnostics().visibleCount,
        emissiveMaterialCount: getSelectionOutlineDiagnostics().emissiveMaterialCount,
        statusText: elements.statusText.textContent
    };
    if (focusedInput) {
        result.inputValueKept = String(focusedInput.value);
        result.inputFocusKept = document.activeElement === focusedInput;
    }
    setStatus(hadSelection
        ? "Выделение снято клавишей Esc."
        : "Выделение не менялось: деталь не выбрана.");
    return result;
}

function isSelectionOpen(selectionKey) {
    if (state.activeClipIndex >= 0) {
        if (state.openClipIndices.has(state.activeClipIndex)) {
            return true;
        }
        return state.doorOpen && state.animationDirection === "opening" &&
            state.animatingClipIndices.has(state.activeClipIndex);
    }
    if (!state.doorOpen) {
        return false;
    }
    return state.openSelectionKey === null || state.openSelectionKey === selectionKey;
}

function toggleAnimatedObject(object) {
    if (!object) {
        setStatus("Объект не выбран.");
        return { toggled: false, opening: false, clipIndex: -1, sourceIndex: null, message: "Объект не выбран." };
    }
    selectObject(object);
    const binding = findAnimationBinding(object);
    if (!binding.valid) {
        return { toggled: false, opening: false, clipIndex: -1, sourceIndex: null, message: binding.message };
    }
    const selectionKey = getSelectionKey(object, binding);
    const activeClipSelected = state.activeAction !== null && state.activeClipIndex === binding.clipIndex;
    if (!activeClipSelected && !selectAnimation(binding.clipIndex)) {
        setStatus("Не удалось подготовить связанную анимацию.");
        publishSelectionDiagnostic(object, { valid: false }, false);
        return { toggled: false, opening: false, clipIndex: -1, sourceIndex: binding.sourceIndex, message: "Не удалось подготовить связанную анимацию." };
    }
    const opening = !isSelectionOpen(selectionKey);
    const succeeded = opening ? startTimedOpening() : startTimedClosing();
    if (succeeded) {
        state.openSelectionKey = opening ? selectionKey : null;
    }
    setStatus(succeeded
        ? opening
            ? "Анимация детали плавно открывается."
            : "Анимация детали плавно закрывается."
        : "Не удалось запустить связанную анимацию.");
    publishSelectionDiagnostic(object, binding, succeeded && opening);
    return {
        toggled: succeeded,
        opening,
        clipIndex: state.activeClipIndex,
        sourceIndex: binding.sourceIndex,
        message: succeeded ? (opening ? "opened" : "closed") : "Не удалось запустить связанную анимацию."
    };
}

function toVector3(value) {
    if (Array.isArray(value) && value.length >= 3 && value.every(entry => Number.isFinite(Number(entry)))) {
        return new state.THREE.Vector3(Number(value[0]), Number(value[1]), Number(value[2]));
    }
    if (value && typeof value === "object" && ["x", "y", "z"].every(axis => Number.isFinite(Number(value[axis])))) {
        return new state.THREE.Vector3(Number(value.x), Number(value.y), Number(value.z));
    }
    return null;
}

function isTiltedAxisVector(vector) {
    if (!vector) {
        return false;
    }
    const magnitudes = [Math.abs(vector.x), Math.abs(vector.y), Math.abs(vector.z)].sort((first, second) => first - second);
    return magnitudes[1] > 1.0e-6;
}

function toAxisVector(value) {
    const vector = toVector3(value);
    if (vector) {
        return vector;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toUpperCase();
        const axis = normalized.endsWith("X") ? new state.THREE.Vector3(1, 0, 0)
            : normalized.endsWith("Y") ? new state.THREE.Vector3(0, 1, 0)
            : normalized.endsWith("Z") ? new state.THREE.Vector3(0, 0, 1)
            : null;
        if (axis) {
            if (normalized.startsWith("-")) {
                axis.negate();
            }
            return axis;
        }
    }
    return null;
}

function addMarker(markerGroup, type, entry, objectId, index, seenMarkers) {
    if (!entry || typeof entry !== "object") {
        return null;
    }
    if (type === "fastener" && entry.geometry === true) {
        state.suppressedFastenerGeometry += 1;
        return null;
    }
    const id = typeof entry.id === "string" && entry.id ? entry.id : `${type}_${index}`;
    const markerKey = `${type}:${id}`;
    if (seenMarkers.has(markerKey)) {
        return null;
    }
    seenMarkers.add(markerKey);
    const worldPosition = toVector3(entry.position || entry.center);
    if (!worldPosition) {
        return null;
    }
    const THREE = state.THREE;
    const axisSource = entry.axisVector ? "axisVector" : (entry.axis ? "axis" : "default");
    const axis = toAxisVector(entry.axisVector) || toAxisVector(entry.axis) || new THREE.Vector3(0, 1, 0);
    if (axis.lengthSq() < 1e-12) {
        axis.set(0, 1, 0);
    }
    axis.normalize();
    let marker;
    if (type === "hole") {
        const diameter = Number(entry.diameter);
        const radius = Number.isFinite(diameter) && diameter > 0 ? diameter / 2 : 0.015;
        marker = new THREE.Mesh(
            new THREE.TorusGeometry(radius, Math.max(radius * 0.12, 0.00025), 8, 24),
            new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.95, depthWrite: false })
        );
    } else {
        marker = new THREE.Mesh(
            new THREE.CylinderGeometry(0.003, 0.003, 0.016, 12),
            new THREE.MeshBasicMaterial({ color: 0x4da3ff })
        );
    }
    marker.name = `${type === "hole" ? "Hole" : "Fastener"} ${id}`;
    marker.renderOrder = 10;
    marker.raycast = () => {};
    const partId = typeof entry.partId === "string" && entry.partId ? entry.partId : null;
    const partObject = getPartObject(partId);
    let localAxis = axis.clone();
    if (partObject) {
        const inverse = new THREE.Matrix4().copy(partObject.matrixWorld).invert();
        localAxis = axis.clone().transformDirection(inverse);
        marker.position.copy(worldPosition).applyMatrix4(inverse);
        partObject.add(marker);
        state.partMarkers.push(marker);
    } else {
        marker.position.copy(worldPosition);
        markerGroup.add(marker);
    }
    if (localAxis.lengthSq() < 1e-12) {
        localAxis.set(0, 1, 0);
    } else {
        localAxis.normalize();
    }
    const baseAxis = type === "hole" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    marker.quaternion.setFromUnitVectors(baseAxis, localAxis);
    const markerObjectId = partId || objectId;
    marker.userData = {
        markerType: type,
        markerId: id,
        objectId: markerObjectId,
        markerPartId: partId,
        markerSpace: partObject ? "partLocal" : "world",
        markerRestPosition: { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z },
        markerParentIsPart: Boolean(partObject),
        markerParentKind: partObject
            ? (getDirectAnimationIndex(partObject.parent) !== null ? "animationRoot" : "part")
            : "markerGroup",
        markerParentName: partObject ? (getObjectName(partObject) || partObject.name || "") : "",
        markerAxisSource: axisSource,
        markerAxis: { x: axis.x, y: axis.y, z: axis.z },
        markerHasAxisVector: Boolean(entry.axisVector),
        markerTiltedAxis: axisSource === "axisVector" && isTiltedAxisVector(axis)
    };
    state.markers.push(marker);
    return marker;
}

function collectMarkerData(gltf, root, packageMetadata) {
    const markerGroup = new state.THREE.Group();
    markerGroup.name = "ModelMarkers";
    const seenMarkers = new Set();
    const sources = [];
    if (packageMetadata && typeof packageMetadata === "object") {
        sources.push({ data: packageMetadata, objectId: "package" });
    }
    if (gltf.userData) {
        sources.push({ data: gltf.userData, objectId: "model" });
    }
    root.traverse(object => {
        if (object.userData && Object.keys(object.userData).length > 0) {
            sources.push({ data: object.userData, objectId: object.userData.viewerId || object.name || "object" });
        }
        const extras = object.userData && object.userData.extras;
        if (extras && typeof extras === "object") {
            sources.push({ data: extras, objectId: object.userData.viewerId || object.name || "object" });
        }
    });
    if (state.scene) {
        state.scene.updateMatrixWorld(true);
    }
    for (const source of sources) {
        const extras = source.data.extras && typeof source.data.extras === "object" ? source.data.extras : source.data;
        const holes = Array.isArray(extras.holes) ? extras.holes : [];
        const fasteners = Array.isArray(extras.fasteners) ? extras.fasteners : [];
        state.fastenerRecords += fasteners.length;
        state.holeRecords += holes.length;
        for (const entry of fasteners) {
            if (!entry || typeof entry !== "object") {
                continue;
            }
            if (entry.geometry === true) {
                state.fastenerGeometryRecords += 1;
            }
            if (entry.synthesized === true) {
                state.fastenerSynthesizedRecords += 1;
            }
            const vector = toAxisVector(entry.axisVector);
            if (vector) {
                state.fastenerAxisVectorRecords += 1;
                if (Math.abs(vector.length() - 1.0) > 1.0e-6) {
                    state.fastenerAxisVectorErrors += 1;
                }
                if (isTiltedAxisVector(vector)) {
                    state.fastenerTiltedAxisRecords += 1;
                }
            }
        }
        holes.forEach((entry, index) => addMarker(markerGroup, "hole", entry, source.objectId, index, seenMarkers));
        fasteners.forEach((entry, index) => addMarker(markerGroup, "fastener", entry, source.objectId, index, seenMarkers));
    }
    state.markerGroup = markerGroup;
    state.scene.add(markerGroup);
    const summary = {
        holes: 0,
        fasteners: 0,
        fastenerMarkers: 0,
        fastenerRecords: state.fastenerRecords,
        fastenerGeometry: state.fastenerGeometryRecords,
        fastenerSynthesized: state.fastenerSynthesizedRecords,
        fastenerWithoutGeometryRecords: state.fastenerRecords - state.fastenerGeometryRecords,
        fastenerSuppressed: state.suppressedFastenerGeometry,
        holeRecords: state.holeRecords,
        parentedHoles: 0,
        parentedFasteners: 0,
        worldHoles: 0,
        worldFasteners: 0
    };
    for (const marker of state.markers) {
        if (marker.userData.markerType === "hole") {
            summary.holes += 1;
        } else {
            summary.fasteners += 1;
        }
        if (marker.userData.markerParentIsPart) {
            if (marker.userData.markerType === "hole") {
                summary.parentedHoles += 1;
            } else {
                summary.parentedFasteners += 1;
            }
        } else if (marker.userData.markerType === "hole") {
            summary.worldHoles += 1;
        } else {
            summary.worldFasteners += 1;
        }
    }
    summary.fastenerMarkers = summary.fasteners;
    summary.fasteners = summary.fastenerRecords;
    if (state.scene) {
        state.scene.updateMatrixWorld(true);
    }
    return summary;
}

function getAnimationRootObjects() {
    const roots = [];
    if (!state.modelRoot) {
        return roots;
    }
    state.modelRoot.traverse(object => {
        if (isWireframeOverlay(object) || isWireframeExcludedObject(object)) {
            return;
        }
        if (getDirectAnimationIndex(object) !== null) {
            roots.push(object);
        }
    });
    return roots;
}

function applyAnimationOpenPose(root) {
    const extras = getObjectExtras(root);
    if (getIntegerValue(extras.type) === 1 && Array.isArray(extras.rotationQuaternion) && extras.rotationQuaternion.length === 4) {
        root.quaternion.set(extras.rotationQuaternion[0], extras.rotationQuaternion[1], extras.rotationQuaternion[2], extras.rotationQuaternion[3]);
        return true;
    }
    if (Array.isArray(extras.pivot) && Array.isArray(extras.axisDirection) && Number.isFinite(Number(extras.doorShift))) {
        root.position.set(
            Number(extras.pivot[0]) + Number(extras.axisDirection[0]) * Number(extras.doorShift),
            Number(extras.pivot[1]) + Number(extras.axisDirection[1]) * Number(extras.doorShift),
            Number(extras.pivot[2]) + Number(extras.axisDirection[2]) * Number(extras.doorShift)
        );
        return true;
    }
    return false;
}

function findAnimationAncestor(object) {
    for (let current = object ? object.parent : null; current; current = current.parent) {
        if (getDirectAnimationIndex(current) !== null) {
            return current;
        }
    }
    return null;
}

function probeMarkerMotion() {
    const THREE = state.THREE;
    const result = {
        animatedRootCount: 0,
        probedRootCount: 0,
        sampledMarkers: 0,
        movedMarkers: 0,
        staticMarkers: 0,
        staticHoleMarkers: 0,
        movedStaticMarkers: 0,
        maxAnimatedShift: 0,
        minAnimatedShift: null,
        skippedNoAnimations: false,
        valid: false
    };
    if (!THREE || !state.modelRoot || !state.scene) {
        return result;
    }
    result.animatedRootCount = getAnimationRootObjects().length;
    if (state.markers.length === 0) {
        result.skippedNoAnimations = state.clips.length === 0 && result.animatedRootCount === 0;
        result.valid = result.skippedNoAnimations;
        return result;
    }
    const markersByRoot = new Map();
    const staticMarkers = [];
    for (const marker of state.markers) {
        if (marker.userData.markerParentIsPart !== true) {
            continue;
        }
        const root = findAnimationAncestor(marker.parent);
        if (root === null) {
            staticMarkers.push(marker);
            continue;
        }
        if (!markersByRoot.has(root)) {
            markersByRoot.set(root, []);
        }
        markersByRoot.get(root).push(marker);
    }
    if (markersByRoot.size === 0) {
        result.skippedNoAnimations = state.clips.length === 0 && result.animatedRootCount === 0;
        result.valid = result.skippedNoAnimations;
        return result;
    }
    state.scene.updateMatrixWorld(true);
    const staticBefore = staticMarkers.map(marker => marker.getWorldPosition(new THREE.Vector3()));
    for (const [root, markers] of markersByRoot) {
        const savedPosition = root.position.clone();
        const savedQuaternion = root.quaternion.clone();
        root.updateMatrixWorld(true);
        const before = markers.map(marker => marker.getWorldPosition(new THREE.Vector3()));
        if (!applyAnimationOpenPose(root)) {
            root.position.copy(savedPosition);
            root.quaternion.copy(savedQuaternion);
            root.updateMatrixWorld(true);
            continue;
        }
        root.updateMatrixWorld(true);
        result.probedRootCount += 1;
        for (let index = 0; index < markers.length; index += 1) {
            const after = markers[index].getWorldPosition(new THREE.Vector3());
            const shift = after.distanceTo(before[index]);
            result.sampledMarkers += 1;
            if (shift > 1e-6) {
                result.movedMarkers += 1;
            }
            if (shift > result.maxAnimatedShift) {
                result.maxAnimatedShift = shift;
            }
            if (result.minAnimatedShift === null || shift < result.minAnimatedShift) {
                result.minAnimatedShift = shift;
            }
        }
        root.position.copy(savedPosition);
        root.quaternion.copy(savedQuaternion);
        root.updateMatrixWorld(true);
    }
    for (let index = 0; index < staticMarkers.length; index += 1) {
        const after = staticMarkers[index].getWorldPosition(new THREE.Vector3());
        if (after.distanceTo(staticBefore[index]) > 1.0e-9) {
            result.movedStaticMarkers += 1;
        }
    }
    result.staticMarkers = staticMarkers.length;
    result.staticHoleMarkers = staticMarkers.filter(marker => marker.userData.markerType === "hole").length;
    result.valid = result.probedRootCount > 0 &&
        result.sampledMarkers > 0 &&
        result.movedMarkers === result.sampledMarkers &&
        result.movedStaticMarkers === 0;
    return result;
}

function getMarkerDiagnostics() {
    const diagnostics = {
        holeCount: 0,
        fastenerCount: 0,
        fastenerMarkerCount: 0,
        fastenerRecordCount: 0,
        fastenerGeometryParts: 0,
        fastenerSynthesizedParts: 0,
        fastenerWithoutGeometryRecords: 0,
        fastenerGeometrySuppressedMarkers: 0,
        holeRecordCount: 0,
        axisVectorMarkers: 0,
        tiltedAxisMarkers: 0,
        axisVectorRecords: 0,
        tiltedAxisRecords: 0,
        axisVectorRecordErrors: 0,
        orientationChecked: 0,
        orientationMismatchCount: 0,
        maxOrientationError: 0,
        axisSourceCounts: {},
        parentedToPart: 0,
        parentedToAnimationRootPart: 0,
        parentedToPartNode: 0,
        worldSpace: 0,
        wrongParentCount: 0,
        restPositionMismatchCount: 0,
        maxRestPositionError: 0,
        missingPartIdMarkers: 0,
        strayMarkers: 0,
        strayMarkersChecked: 0,
        maxStrayMarkerDistance: 0,
        strayMarkerSamples: [],
        partObjectCount: state.partObjects.size,
        inheritedAnimationParts: 0,
        inheritedMeshParts: 0,
        animatedParts: 0,
        staticParts: 0,
        animationBinding: null,
        markersInModelRoot: 0,
        markerSummary: null,
        motionProbe: null,
        valid: false
    };
    if (!state.modelRoot || !state.THREE) {
        state.lastStrayMarkerCount = null;
        return diagnostics;
    }
    diagnostics.fastenerRecordCount = state.fastenerRecords;
    diagnostics.fastenerGeometryParts = state.fastenerGeometryRecords;
    diagnostics.fastenerSynthesizedParts = state.fastenerSynthesizedRecords;
    diagnostics.fastenerWithoutGeometryRecords = state.fastenerRecords - state.fastenerGeometryRecords;
    diagnostics.fastenerGeometrySuppressedMarkers = state.suppressedFastenerGeometry;
    diagnostics.holeRecordCount = state.holeRecords;
    diagnostics.axisVectorRecords = state.fastenerAxisVectorRecords;
    diagnostics.tiltedAxisRecords = state.fastenerTiltedAxisRecords;
    diagnostics.axisVectorRecordErrors = state.fastenerAxisVectorErrors;
    state.scene.updateMatrixWorld(true);
    state.modelRoot.traverse(object => {
        if (isWireframeOverlay(object) || isWireframeExcludedObject(object)) {
            return;
        }
        const extras = getObjectExtras(object);
        if (getIntegerValue(extras.inheritedFromBlock) === 1) {
            diagnostics.inheritedAnimationParts += 1;
            if (object.isMesh) {
                diagnostics.inheritedMeshParts += 1;
            }
        }
        if (getPartId(object) !== null) {
            if (getSourceAnimationIndex(object) !== null || getDirectAnimationIndex(object) !== null) {
                diagnostics.animatedParts += 1;
            } else {
                diagnostics.staticParts += 1;
            }
        }
    });
    for (const marker of state.markers) {
        const type = marker.userData.markerType;
        if (type === "hole") {
            diagnostics.holeCount += 1;
        } else {
            diagnostics.fastenerCount += 1;
        }
        const axisSource = typeof marker.userData.markerAxisSource === "string" ? marker.userData.markerAxisSource : "unknown";
        diagnostics.axisSourceCounts[axisSource] = (diagnostics.axisSourceCounts[axisSource] || 0) + 1;
        if (marker.userData.markerHasAxisVector === true) {
            diagnostics.axisVectorMarkers += 1;
        }
        if (marker.userData.markerTiltedAxis === true) {
            diagnostics.tiltedAxisMarkers += 1;
        }
        const storedAxis = marker.userData.markerAxis;
        if (storedAxis && Number.isFinite(storedAxis.x) && Number.isFinite(storedAxis.y) && Number.isFinite(storedAxis.z)) {
            const expected = new state.THREE.Vector3(storedAxis.x, storedAxis.y, storedAxis.z);
            if (marker.parent) {
                const inverse = new state.THREE.Matrix4().copy(marker.parent.matrixWorld).invert();
                expected.transformDirection(inverse);
            }
            if (expected.lengthSq() > 1e-12) {
                expected.normalize();
                const base = type === "hole" ? new state.THREE.Vector3(0, 0, 1) : new state.THREE.Vector3(0, 1, 0);
                const actual = base.applyQuaternion(marker.quaternion);
                const error = Math.max(
                    Math.abs(actual.x - expected.x),
                    Math.abs(actual.y - expected.y),
                    Math.abs(actual.z - expected.z)
                );
                if (error > diagnostics.maxOrientationError) {
                    diagnostics.maxOrientationError = error;
                }
                if (error > 1.0e-6) {
                    diagnostics.orientationMismatchCount += 1;
                }
                diagnostics.orientationChecked += 1;
            }
        }
        const rest = marker.userData.markerRestPosition;
        if (rest && Number.isFinite(rest.x) && Number.isFinite(rest.y) && Number.isFinite(rest.z)) {
            const world = marker.getWorldPosition(new state.THREE.Vector3());
            const error = Math.max(
                Math.abs(world.x - rest.x),
                Math.abs(world.y - rest.y),
                Math.abs(world.z - rest.z)
            );
            if (error > 1.0e-5) {
                diagnostics.restPositionMismatchCount += 1;
            }
            if (error > diagnostics.maxRestPositionError) {
                diagnostics.maxRestPositionError = error;
            }
        } else {
            diagnostics.restPositionMismatchCount += 1;
        }
        const partId = marker.userData.markerPartId || null;
        if (marker.userData.markerParentIsPart === true) {
            diagnostics.parentedToPart += 1;
            if (marker.userData.markerParentKind === "animationRoot") {
                diagnostics.parentedToAnimationRootPart += 1;
            } else {
                diagnostics.parentedToPartNode += 1;
            }
            const expected = getPartObject(partId);
            if (expected === null || marker.parent !== expected) {
                diagnostics.wrongParentCount += 1;
            }
        } else {
            diagnostics.worldSpace += 1;
            if (partId !== null && getPartObject(partId) !== null) {
                diagnostics.wrongParentCount += 1;
            }
        }
        if (partId === null) {
            diagnostics.missingPartIdMarkers += 1;
        }
        if (partId !== null) {
            const partObject = getPartObject(partId);
            if (partObject !== null) {
                const box = measurePartGeometry(partObject).worldBox;
                if (!box.isEmpty()) {
                    const distance = distanceToBox(marker.getWorldPosition(new state.THREE.Vector3()), box);
                    diagnostics.strayMarkersChecked += 1;
                    if (distance > diagnostics.maxStrayMarkerDistance) {
                        diagnostics.maxStrayMarkerDistance = distance;
                    }
                    if (distance > MARKER_STRAY_DISTANCE_LIMIT) {
                        diagnostics.strayMarkers += 1;
                        if (diagnostics.strayMarkerSamples.length < 8) {
                            diagnostics.strayMarkerSamples.push({
                                markerId: marker.userData.markerId || marker.name,
                                markerType: type,
                                markerPartId: partId,
                                distance,
                                distanceMm: distance * MILLIMETERS_PER_WORLD_UNIT
                            });
                        }
                    }
                }
            }
        }
        for (let current = marker; current; current = current.parent) {
            if (current === state.modelRoot) {
                diagnostics.markersInModelRoot += 1;
                break;
            }
        }
    }
    diagnostics.markerSummary = {
        holes: diagnostics.holeCount,
        fasteners: diagnostics.fastenerRecordCount,
        fastenerMarkers: diagnostics.fastenerCount,
        fastenerGeometry: diagnostics.fastenerGeometryParts,
        fastenerSynthesized: diagnostics.fastenerSynthesizedParts,
        fastenerWithoutGeometryRecords: diagnostics.fastenerWithoutGeometryRecords,
        parentedToPart: diagnostics.parentedToPart,
        worldSpace: diagnostics.worldSpace
    };
    diagnostics.fastenerMarkerCount = diagnostics.fastenerCount;
    diagnostics.motionProbe = probeMarkerMotion();
    diagnostics.animationBinding = getAnimationBindingDiagnostics();
    state.lastStrayMarkerCount = diagnostics.strayMarkers;
    diagnostics.valid = diagnostics.wrongParentCount === 0 &&
        diagnostics.restPositionMismatchCount === 0 &&
        diagnostics.missingPartIdMarkers === 0 &&
        diagnostics.orientationMismatchCount === 0 &&
        diagnostics.axisVectorRecordErrors === 0 &&
        diagnostics.strayMarkers === 0 &&
        (diagnostics.holeRecordCount + diagnostics.fastenerRecordCount) > 0 &&
        diagnostics.fastenerGeometrySuppressedMarkers === diagnostics.fastenerGeometryParts &&
        (diagnostics.holeCount + diagnostics.fastenerCount) <= (diagnostics.holeRecordCount + diagnostics.fastenerRecordCount) &&
        diagnostics.inheritedAnimationParts === 0 &&
        diagnostics.animationBinding !== null &&
        diagnostics.animationBinding.valid &&
        (diagnostics.holeCount + diagnostics.fastenerCount) === diagnostics.parentedToPart + diagnostics.worldSpace &&
        diagnostics.markerSummary.holes + diagnostics.markerSummary.fastenerMarkers === diagnostics.holeCount + diagnostics.fastenerCount;
    return diagnostics;
}

function frameFastenerGeometry() {
    const THREE = state.THREE;
    if (!state.modelRoot || !THREE || !state.camera || !state.controls) {
        return null;
    }
    state.scene.updateMatrixWorld(true);
    let best = null;
    for (const entry of state.partObjects.values()) {
        const object = entry ? entry.object : null;
        if (!object || getPartSourceType(object) !== "fastener") {
            continue;
        }
        const meshes = collectPartGeometry(object);
        if (meshes.length === 0) {
            continue;
        }
        const box = new THREE.Box3();
        for (const mesh of meshes) {
            box.expandByObject(mesh);
        }
        if (box.isEmpty()) {
            continue;
        }
        const size = box.getSize(new THREE.Vector3());
        const diagonal = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
        if (!Number.isFinite(diagonal) || (best && Math.abs(diagonal - FRAMED_FASTENER_TARGET_DIAGONAL) >= Math.abs(best.diagonal - FRAMED_FASTENER_TARGET_DIAGONAL))) {
            continue;
        }
        best = { object, box, diagonal };
    }
    if (!best) {
        return null;
    }
    const center = best.box.getCenter(new THREE.Vector3());
    const sphere = best.box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius * FRAMED_FASTENER_MARGIN, 0.015);
    const verticalFov = THREE.MathUtils.degToRad(state.camera.fov);
    const distance = radius / Math.sin(verticalFov * 0.5) * 1.15;
    const direction = new THREE.Vector3(1, 0.6, 1).normalize();
    state.camera.position.copy(center).add(direction.multiplyScalar(distance));
    state.controls.target.copy(center);
    state.controls.minDistance = Math.min(state.controls.minDistance, radius * 0.5);
    state.controls.update();
    state.camera.updateMatrixWorld(true);
    return { partId: getPartId(best.object), radius, distance };
}

function frameHardwareByName(fragment) {
    const THREE = state.THREE;
    if (!state.modelRoot || !THREE || !state.camera || !state.controls) {
        return null;
    }
    const needle = String(fragment === null || fragment === undefined ? "" : fragment).trim().toLowerCase();
    if (!needle) {
        return null;
    }
    state.scene.updateMatrixWorld(true);
    const group = new THREE.Box3();
    const names = [];
    const hardwareNames = [];
    const seenParts = new Set();
    let matched = 0;
    let hardwareParts = 0;
    state.modelRoot.traverse(object => {
        if (isWireframeOverlay(object) || isWireframeExcludedObject(object)) {
            return;
        }
        if (getPartSourceType(object) !== "fastener") {
            return;
        }
        const partId = getPartId(object);
        if (!partId || seenParts.has(partId)) {
            return;
        }
        const meshes = collectPartGeometry(object);
        if (meshes.length === 0) {
            return;
        }
        seenParts.add(partId);
        hardwareParts += 1;
        const name = String(getObjectName(object) || "");
        if (hardwareNames.length < 16) {
            hardwareNames.push(name);
        }
        if (!name.toLowerCase().includes(needle)) {
            return;
        }
        for (const mesh of meshes) {
            const bounds = getGeometryBounds(mesh.geometry);
            if (bounds) {
                group.union(bounds.clone().applyMatrix4(mesh.matrixWorld));
            }
        }
        matched += 1;
        if (names.length < 16) {
            names.push(name);
        }
    });
    if (matched === 0 || group.isEmpty()) {
        return { partCount: matched, hardwareParts, names, hardwareNames };
    }
    const modelBox = new THREE.Box3().setFromObject(state.modelRoot);
    if (modelBox.isEmpty()) {
        return null;
    }
    const center = group.getCenter(new THREE.Vector3());
    const sphere = group.getBoundingSphere(new THREE.Sphere());
    const modelCenter = modelBox.getCenter(new THREE.Vector3());
    const modelDiagonal = modelBox.getSize(new THREE.Vector3()).length();
    const verticalFov = THREE.MathUtils.degToRad(state.camera.fov);
    const fitDistance = sphere.radius / Math.sin(verticalFov * 0.5);
    const inward = new THREE.Vector3().subVectors(center, modelCenter);
    if (inward.lengthSq() < 1e-12) {
        inward.set(0, 0, 1);
    }
    inward.normalize();
    const side = new THREE.Vector3().crossVectors(inward, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-12) {
        side.set(1, 0, 0);
    }
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, inward).normalize();
    const direction = new THREE.Vector3()
        .addScaledVector(inward, 1.0)
        .addScaledVector(side, 0.5)
        .addScaledVector(up, 0.4)
        .normalize();
    const distance = Math.min(fitDistance * 1.05, Math.max(modelDiagonal * FRAMED_GROUP_INWARD_FRACTION, fitDistance * 0.85));
    state.camera.position.copy(center).addScaledVector(direction, distance);
    state.controls.target.copy(center);
    state.controls.minDistance = Math.min(state.controls.minDistance, sphere.radius * 0.5);
    state.controls.update();
    state.camera.updateMatrixWorld(true);
    return {
        partCount: matched,
        names,
        radius: sphere.radius,
        distance,
        center: vectorData(center),
        modelDiagonal
    };
}

function getCameraDistance() {
    return state.camera && state.controls
        ? state.camera.position.distanceTo(state.controls.target)
        : 0;
}

function getCameraClippingValues() {
    const modelRadius = Number.isFinite(state.modelRadius) && state.modelRadius > 0
        ? state.modelRadius
        : 1;
    const near = Math.max(modelRadius * CAMERA_NEAR_RADIUS_RATIO, CAMERA_NEAR_ABSOLUTE_MIN);
    const minimumDistance = Math.max(
        modelRadius * CAMERA_MIN_DISTANCE_RADIUS_RATIO,
        near * 2);
    const distance = getCameraDistance();
    const far = Math.max(
        distance + modelRadius * CAMERA_FAR_CLEARANCE_RADII,
        modelRadius * CAMERA_FAR_RADIUS_MINIMUM);
    return { near, far, distance, minimumDistance, modelRadius };
}

function updateCameraClipping() {
    if (!state.camera || !state.controls) {
        return null;
    }
    const clipping = getCameraClippingValues();
    if (state.controls.minDistance !== clipping.minimumDistance) {
        state.controls.minDistance = clipping.minimumDistance;
    }
    if (state.camera.near !== clipping.near || state.camera.far !== clipping.far) {
        state.camera.near = clipping.near;
        state.camera.far = clipping.far;
        state.camera.updateProjectionMatrix();
    }
    return clipping;
}

function isCameraClippingValid(clipping) {
    return Boolean(
        state.modelRoot &&
        clipping &&
        Number.isFinite(clipping.modelRadius) &&
        clipping.modelRadius > 0 &&
        Number.isFinite(clipping.minimumDistance) &&
        clipping.minimumDistance > 0 &&
        Number.isFinite(clipping.near) &&
        clipping.near > 0 &&
        clipping.near < clipping.minimumDistance &&
        Number.isFinite(clipping.far) &&
        clipping.far >= clipping.distance + clipping.modelRadius * CAMERA_FAR_CLEARANCE_RADII &&
        clipping.far >= clipping.modelRadius * CAMERA_FAR_RADIUS_MINIMUM &&
        clipping.far > clipping.near);
}

function fitCamera(root) {
    const THREE = state.THREE;
    root.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(root);
    const boundsValues = [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z];
    if (bounds.isEmpty() || boundsValues.some(value => !Number.isFinite(value))) {
        throw new Error("Границы загруженной модели недопустимы.");
    }

    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius;
    const largestDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(radius) || radius <= 0) {
        throw new Error("Радиус загруженной модели недопустим.");
    }
    const verticalFov = THREE.MathUtils.degToRad(state.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * state.camera.aspect);
    const distance = Math.max(
        radius / Math.sin(verticalFov * 0.5),
        radius / Math.sin(horizontalFov * 0.5)) * 1.12;
    const direction = new THREE.Vector3(1, 0.65, 1).normalize();
    const fitNear = Math.max(radius * CAMERA_NEAR_RADIUS_RATIO, CAMERA_NEAR_ABSOLUTE_MIN);
    state.modelSphereCenter = sphere.center.clone();
    state.modelRadius = radius;
    state.camera.position.copy(center).add(direction.multiplyScalar(distance));
    state.controls.target.copy(center);
    state.controls.minDistance = Math.max(radius * CAMERA_MIN_DISTANCE_RADIUS_RATIO, fitNear * 2);
    state.controls.maxDistance = Math.max(distance * 100, radius * CAMERA_FAR_RADIUS_MINIMUM);
    state.controls.update();
    updateCameraClipping();
    state.defaultCameraPosition = state.camera.position.clone();
    state.defaultCameraTarget = state.controls.target.clone();
    updateBeamLight();
    const groundSize = Math.max(size.x, size.z, largestDimension, 0.5) * 4;
    state.ground.scale.set(groundSize / 200, 1, groundSize / 200);
    state.ground.position.y = bounds.min.y - Math.max(largestDimension * 0.002, 0.001);
    state.scene.updateMatrixWorld(true);
    return { bounds, size, center, sphere, radius, distance };
}

function vectorData(vector) {
    return { x: vector.x, y: vector.y, z: vector.z };
}

function isObjectVisible(object) {
    for (let current = object; current; current = current.parent) {
        if (!current.visible) {
            return false;
        }
    }
    return true;
}

function waitForRenderFrame() {
    return new Promise(resolve => window.requestAnimationFrame(() => resolve()));
}

function getModelMeshes(root = state.modelRoot) {
    const meshes = [];
    if (!root) {
        return meshes;
    }
    root.traverse(object => {
        if (object.isMesh && !isWireframeOverlay(object) && !isWireframeExcludedObject(object)) {
            meshes.push(object);
        }
    });
    return meshes;
}

function colorToHexString(color) {
    if (!color || !color.isColor || !state.THREE) {
        return null;
    }
    return `#${color.getHex(state.THREE.SRGBColorSpace).toString(16).padStart(6, "0")}`;
}

function getBackgroundDiagnostics() {
    const input = elements.backgroundColor;
    const inputValue = input && typeof input.value === "string" ? input.value.toLowerCase() : null;
    const sceneColor = colorToHexString(state.scene && state.scene.background);
    const inputExists = Boolean(input);
    const inputType = input && typeof input.type === "string" ? input.type : null;
    const inputFormatValid = Boolean(inputValue && /^#[0-9a-f]{6}$/.test(inputValue));
    const matchesScene = Boolean(inputValue && sceneColor && inputValue === sceneColor.toLowerCase());
    return {
        inputExists,
        inputType,
        inputValue,
        sceneColor,
        matchesScene,
        wireframeLineColor: state.wireframeLineColor === null
            ? null
            : `#${state.wireframeLineColor.toString(16).padStart(6, "0")}`,
        valid: inputExists && inputType === "color" && inputFormatValid && matchesScene
    };
}

function getVisibilityDiagnostics() {
    let hiddenMeshCount = 0;
    let hiddenMarkerCount = 0;
    let hiddenObjectVisibleCount = 0;
    let pickTargetLeak = 0;
    for (const object of state.hiddenObjects) {
        hiddenMeshCount += collectPartGeometry(object).length;
        hiddenMarkerCount += collectPartMarkersOf(object).length;
        if (object.visible) {
            hiddenObjectVisibleCount += 1;
        }
    }
    for (const mesh of state.pickTargets) {
        let owner = null;
        for (const object of state.hiddenObjects) {
            if (isDescendantObject(mesh, object)) {
                owner = object;
                break;
            }
        }
        if (owner) {
            pickTargetLeak += 1;
        }
    }
    const treeDiagnostics = getTreeDiagnostics();
    return {
        hiddenObjectCount: state.hiddenObjects.size,
        hiddenMeshCount,
        hiddenMarkerCount,
        hiddenObjectVisibleCount,
        pickTargetCount: state.pickTargets.length,
        pickTargetLeak,
        blockCount: state.treeBlocks.size,
        selectedBlock: state.selectedBlock ? getBlockSelectionKey(state.selectedBlock) : null,
        selectedBlockPartCount: state.selectedBlock ? state.selectedBlock.objects.length : 0,
        treeHiddenMarkedRows: treeDiagnostics.hiddenMarkedRows,
        valid: hiddenObjectVisibleCount === 0 && pickTargetLeak === 0 &&
            treeDiagnostics.hiddenMarkedRows === state.hiddenObjects.size
    };
}

const REMOVED_VIEWPORT_LABELS = [
    "Вид модели",
    ">Модель не загружена<",
    "Локальный ArrayBuffer",
    "Свет идёт от наблюдателя и всегда направлен на модель",
    "Один щелчок по детали в окне просмотра или в дереве только выделяет её",
    "id=\"model-list\"",
    "id=\"model-count\"",
    "class=\"model-item\"",
    "class=\"display-mode-panel\"",
    "class=\"background-color-option\"",
    "id=\"zoom-fit\"",
    "title=\"Вписать\"",
    "id=\"selection-summary\"",
    "id=\"renderer-summary\"",
    "class=\"status-selection\"",
    "class=\"status-summary\"",
    "Только локальные файлы"
];

function countDocumentMatches(needle) {
    const text = String(needle || "");
    if (!text || !document.documentElement) {
        return 0;
    }
    const markup = document.documentElement.outerHTML;
    let count = 0;
    let index = markup.indexOf(text);
    while (index >= 0) {
        count += 1;
        index = markup.indexOf(text, index + text.length);
    }
    return count;
}

function getViewportToolbarDiagnostics() {
    const limits = getZoomLimits();
    const catalog = getDisplayModeButtonCatalog();
    const removedLabels = {};
    let removedMatches = 0;
    for (const label of REMOVED_VIEWPORT_LABELS) {
        const count = countDocumentMatches(label);
        removedLabels[label] = count;
        removedMatches += count;
    }
    const timing = getAnimationTimingDiagnostics();
    return {
        toolbarPresent: Boolean(elements.viewportToolbar),
        modeButtonCount: catalog.length,
        expectedModeCount: DISPLAY_MODES.length,
        modeOrder: catalog.map(entry => entry.id),
        modeOrderValid: catalog.length === DISPLAY_MODES.length &&
            catalog.every((entry, index) => entry.id === DISPLAY_MODES[index].id),
        modeLabelsValid: catalog.length === DISPLAY_MODES.length &&
            catalog.every((entry, index) => entry.label === DISPLAY_MODES[index].label &&
                entry.ariaLabel === DISPLAY_MODES[index].label),
        modeIconsValid: catalog.length > 0 && catalog.every(entry => entry.iconPresent),
        activeMode: state.displayMode,
        activeModeExpected: DISPLAY_MODE_DEFAULT,
        activeModeButtonCount: catalog.filter(entry => entry.pressed).length,
        activeModeButtons: catalog.filter(entry => entry.pressed).map(entry => entry.id),
        zoomButtonCount: elements.zoomIn && elements.zoomOut ? 2 : (elements.zoomIn || elements.zoomOut ? 1 : 0),
        zoomFitAbsent: document.getElementById("zoom-fit") === null,
        statusBarElementCount: elements.statusBar ? elements.statusBar.children.length : 0,
        statusBarIsSingleLine: elements.statusBar
            ? elements.statusBar.children.length === 1 && elements.statusBar.firstElementChild === elements.statusText
            : false,
        panelsTogglePresent: Boolean(elements.togglePanels),
        panelsHidden: state.panelsHidden,
        panelsTogglePressed: elements.togglePanels ? elements.togglePanels.getAttribute("aria-pressed") === "true" : false,
        backgroundSwatchPresent: Boolean(elements.backgroundSwatchFill),
        backgroundSwatchColor: elements.backgroundSwatchFill ? elements.backgroundSwatchFill.style.backgroundColor : null,
        timingBlockPresent: timing.timingBlockPresent,
        timingInputsInsideToolbar: timing.inputsInsideToolbar,
        timingInputsEnabled: timing.inputsEnabled,
        timingOpenLabel: timing.openInputLabel,
        timingCloseLabel: timing.closeInputLabel,
        timingOpenMinimum: timing.openInputMinimum,
        timingOpenMaximum: timing.openInputMaximum,
        timingCloseMinimum: timing.closeInputMinimum,
        timingCloseMaximum: timing.closeInputMaximum,
        timingValid: timing.valid,
        removedLabels: removedLabels,
        removedLabelMatches: removedMatches,
        currentDistance: limits.current,
        minimumDistance: limits.minimum,
        maximumDistance: limits.maximum,
        fitDistance: limits.fit,
        stepFactor: ZOOM_STEP_FACTOR,
        target: vectorData(state.controls.target),
        modelCenter: state.modelSphereCenter ? vectorData(state.modelSphereCenter) : null,
        viewportWidth: elements.viewport.clientWidth,
        viewportHeight: elements.viewport.clientHeight,
        treePanelDisplay: elements.objectTree && elements.objectTree.closest(".panel")
            ? window.getComputedStyle(elements.objectTree.closest(".panel")).display
            : null
    };
}

function countBoxHelpers(root) {
    let count = 0;
    if (!root) {
        return count;
    }
    root.traverse(object => {
        if (object.type === "BoxHelper" || object.name === "BoxHelper") {
            count += 1;
        }
    });
    return count;
}

function getWireframeOverlayDiagnostics() {
    const result = {
        expectedMeshCount: getModelMeshes().length,
        lineSegmentCount: state.wireframeLines.size,
        discoveredLineSegmentCount: 0,
        visibleLineSegmentCount: 0,
        attachedLineSegmentCount: 0,
        lineMaterialCount: 0,
        lineGeometryViolations: 0,
        lineMaterialViolations: 0,
        lineDepthTestViolations: 0,
        lineDepthWriteViolations: 0,
        linePolygonOffsetViolations: 0,
        lineWireframeViolations: 0,
        lineTransparentViolations: 0,
        lineOpaqueColorViolations: 0,
        duplicateLineSegmentCount: 0,
        valid: false
    };
    if (state.modelRoot) {
        state.modelRoot.traverse(object => {
            if (object.isLineSegments && isWireframeOverlay(object)) {
                result.discoveredLineSegmentCount += 1;
            }
        });
    }
    for (const [mesh, line] of state.wireframeLines) {
        if (line.visible && isObjectVisible(line)) {
            result.visibleLineSegmentCount += 1;
        }
        if (line.parent === mesh) {
            result.attachedLineSegmentCount += 1;
        }
        if (!line.geometry || line.geometry.type !== "EdgesGeometry") {
            result.lineGeometryViolations += 1;
        }
        const materials = Array.isArray(line.material) ? line.material : line.material ? [line.material] : [];
        result.lineMaterialCount += materials.length;
        if (materials.length !== 1 || !materials[0] || materials[0].isLineBasicMaterial !== true) {
            result.lineMaterialViolations += 1;
        }
        for (const material of materials) {
            if (!material || material.isLineBasicMaterial !== true) {
                continue;
            }
            if (material.depthTest !== true) {
                result.lineDepthTestViolations += 1;
            }
            if (material.depthWrite !== false) {
                result.lineDepthWriteViolations += 1;
            }
            if (material.polygonOffset !== false) {
                result.linePolygonOffsetViolations += 1;
            }
            if (material.wireframe === true) {
                result.lineWireframeViolations += 1;
            }
            if (material.transparent === true || material.opacity < 1) {
                result.lineTransparentViolations += 1;
            }
            if (material.colorWrite === false || material.fog === true) {
                result.lineOpaqueColorViolations += 1;
            }
        }
    }
    result.duplicateLineSegmentCount = Math.max(
        0,
        result.discoveredLineSegmentCount - result.lineSegmentCount);
    result.valid = result.expectedMeshCount > 0 &&
        result.lineSegmentCount === result.expectedMeshCount &&
        result.discoveredLineSegmentCount === result.lineSegmentCount &&
        result.attachedLineSegmentCount === result.lineSegmentCount &&
        result.lineMaterialCount === result.lineSegmentCount &&
        result.lineGeometryViolations === 0 &&
        result.lineMaterialViolations === 0 &&
        result.lineDepthTestViolations === 0 &&
        result.lineDepthWriteViolations === 0 &&
        result.linePolygonOffsetViolations === 0 &&
        result.lineWireframeViolations === 0 &&
        result.lineTransparentViolations === 0 &&
        result.lineOpaqueColorViolations === 0;
    return result;
}

function getSelectionOutlineDiagnostics(strayMarkers = null) {
    const markerSet = new Set(state.markers);
    const partMarkerSet = new Set(state.partMarkers);
    const selectionObjects = state.selectionOutlineObjects;
    const result = {
        color: colorToHexPadded(SELECTION_OUTLINE_COLOR),
        edgeThreshold: SELECTION_OUTLINE_EDGE_THRESHOLD,
        renderOrder: SELECTION_OUTLINE_RENDER_ORDER,
        hasSelection: selectionObjects.length > 0,
        objectCount: selectionObjects.length,
        selectedName: selectionObjects.length === 1 ? getObjectName(selectionObjects[0]) : null,
        expectedMeshCount: getSelectionMeshes(selectionObjects).length,
        count: 0,
        visibleCount: 0,
        attachedCount: 0,
        flaggedCount: 0,
        raycastStubbedCount: 0,
        geometryViolations: 0,
        materialViolations: 0,
        depthTestViolations: 0,
        depthWriteViolations: 0,
        wireframeOverlayViolations: 0,
        markerPollution: 0,
        missingMeshCount: 0,
        emissiveMaterialCount: 0,
        cachedGeometryCount: state.selectionOutlineGeometries.size,
        buildMs: Number(state.selectionOutlineBuildMs) || 0,
        strayMarkers: strayMarkers === null
            ? (Number.isInteger(state.lastStrayMarkerCount) ? state.lastStrayMarkerCount : getMarkerDiagnostics().strayMarkers)
            : strayMarkers,
        valid: false
    };
    if (state.scene) {
        state.scene.traverse(object => {
            if (!isSelectionOutline(object)) {
                return;
            }
            result.count += 1;
            if (object.userData.isSelectionOutline === true) {
                result.flaggedCount += 1;
            }
            if (object.visible && isObjectVisible(object)) {
                result.visibleCount += 1;
            }
            if (object.parent && object.parent.isMesh) {
                result.attachedCount += 1;
            }
            if (Object.prototype.hasOwnProperty.call(object, "raycast")) {
                result.raycastStubbedCount += 1;
            }
            if (!object.geometry || object.geometry.type !== "EdgesGeometry") {
                result.geometryViolations += 1;
            }
            const materials = getMeshMaterials(object.material);
            if (materials.length !== 1 || !materials[0] || materials[0].isLineBasicMaterial !== true) {
                result.materialViolations += 1;
            }
            for (const material of materials) {
                if (!material || material.isLineBasicMaterial !== true) {
                    continue;
                }
                if (material.depthTest !== false) {
                    result.depthTestViolations += 1;
                }
                if (material.depthWrite !== false) {
                    result.depthWriteViolations += 1;
                }
            }
            if (isWireframeOverlay(object)) {
                result.wireframeOverlayViolations += 1;
            }
            if (markerSet.has(object) || partMarkerSet.has(object) ||
                Boolean(object.userData && object.userData.markerType) || getPartId(object) !== null) {
                result.markerPollution += 1;
            }
        });
    }
    for (const entry of state.selectionMaterials.values()) {
        result.emissiveMaterialCount += getMeshMaterials(entry.clone).length;
    }
    result.missingMeshCount = Math.max(0, result.expectedMeshCount - result.count);
    result.valid = result.strayMarkers === 0 &&
        result.markerPollution === 0 &&
        result.geometryViolations === 0 &&
        result.materialViolations === 0 &&
        result.depthTestViolations === 0 &&
        result.depthWriteViolations === 0 &&
        result.wireframeOverlayViolations === 0 &&
        (result.hasSelection
            ? result.count > 0 &&
                result.count === result.expectedMeshCount &&
                result.visibleCount === result.count &&
                result.attachedCount === result.count &&
                result.flaggedCount === result.count &&
                result.raycastStubbedCount === result.count
            : result.count === 0 && result.visibleCount === 0 && state.selectionMaterials.size === 0);
    return result;
}

async function reportRenderDiagnostics(requestId, markerDiagnostics = null) {
    await waitForRenderFrame();
    resizeViewport();
    const cameraClipping = updateCameraClipping();
    state.scene.updateMatrixWorld(true);
    state.camera.updateMatrixWorld(true);
    state.renderer.render(state.scene, state.camera);
    state.renderedFrameCount += 1;

    const canvas = state.renderer.domElement;
    const gl = state.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.finish();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const backgroundHex = state.scene.background && state.scene.background.isColor
        ? state.scene.background.getHex(state.THREE.SRGBColorSpace)
        : DEFAULT_BACKGROUND_COLOR;
    const background = {
        r: (backgroundHex >> 16) & 255,
        g: (backgroundHex >> 8) & 255,
        b: backgroundHex & 255
    };
    const threshold = 8;
    let nonBackgroundPixelCount = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
        if (Math.abs(pixels[offset] - background.r) > threshold ||
            Math.abs(pixels[offset + 1] - background.g) > threshold ||
            Math.abs(pixels[offset + 2] - background.b) > threshold) {
            nonBackgroundPixelCount += 1;
        }
    }

    const root = state.modelRoot;
    const bounds = root ? new state.THREE.Box3().setFromObject(root) : null;
    const boundsSize = bounds && !bounds.isEmpty() ? bounds.getSize(new state.THREE.Vector3()) : null;
    const boundsCenter = bounds && !bounds.isEmpty() ? bounds.getCenter(new state.THREE.Vector3()) : null;
    const boundsValid = Boolean(bounds && boundsSize && boundsCenter &&
        [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z,
            boundsSize.x, boundsSize.y, boundsSize.z].every(value => Number.isFinite(value)) &&
        Math.max(boundsSize.x, boundsSize.y, boundsSize.z) > 0);
    let modelObjectCount = 0;
    let modelMeshCount = 0;
    let visibleObjectCount = 0;
    let visibleMeshCount = 0;
    let boxHelperCount = 0;
    const materialSet = new Set();
    const originalMaterialSet = new Set();
    const materialColors = new Set();
    let transparentMaterialCount = 0;
    let depthWriteViolationCount = 0;
    let flatShadingMaterialCount = 0;
    if (root) {
        root.traverse(object => {
            if (isWireframeOverlay(object) || isWireframeExcludedObject(object)) {
                return;
            }
            modelObjectCount += 1;
            const visible = isObjectVisible(object);
            if (object.type === "BoxHelper" || object.name === "BoxHelper") {
                boxHelperCount += 1;
            }
            if (visible) {
                visibleObjectCount += 1;
            }
            if (object.isMesh) {
                modelMeshCount += 1;
                const meshMaterials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
                for (const material of meshMaterials) {
                    if (material && material.userData && material.userData[ORIGINAL_MATERIAL_PROPERTIES_KEY]) {
                        originalMaterialSet.add(material);
                    }
                }
            }
            if (visible && object.isMesh) {
                visibleMeshCount += 1;
                const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
                for (const material of materials) {
                    materialSet.add(material);
                     if (material.transparent || material.opacity < 1) {
                         transparentMaterialCount += 1;
                     }
                     if (material.depthWrite !== true || material.transparent === true || material.opacity !== 1) {
                         depthWriteViolationCount += 1;
                     }
                     if (material.flatShading === true) {
                         flatShadingMaterialCount += 1;
                     }
                     if (material.color && materialColors.size < 32) {
                        materialColors.add(`#${material.color.getHexString(state.THREE.SRGBColorSpace)}`);
                    }
                }
            }
        });
    }

    const backgroundDiagnostics = getBackgroundDiagnostics();
    const wireframeOverlayDiagnostics = getWireframeOverlayDiagnostics();
    const currentDisplayModeDiagnostics = getDisplayModeDiagnostics(state.displayMode);
    const shadowDiagnostics = getShadowDiagnostics();
    const baseLightDiagnostics = getBaseLightDiagnostics();
    const glowDiagnostics = getGlowDiagnostics();
    const treeDiagnostics = getTreeDiagnostics();
    const markers = markerDiagnostics || getMarkerDiagnostics();
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const cameraDirection = state.camera.getWorldDirection(new state.THREE.Vector3());
    const totalPixelCount = width * height;
    const nonBackgroundPercentage = totalPixelCount > 0 ? nonBackgroundPixelCount * 100 / totalPixelCount : 0;
    const canvasAspect = height > 0 ? width / height : 0;
    const layoutSane = width > 0 && height > 0 && canvasAspect >= 0.2 && canvasAspect <= 5;
    const contextLost = gl.isContextLost();
    const modelAttached = Boolean(root && root.parent === state.scene);
    const animationTiming = getAnimationTimingDiagnostics();
    const selectionHelperCount = state.selectionHelper ? 1 : 0;
    const displayModeValid = state.displayMode === "facets" && modelMeshCount > 0 &&
        currentDisplayModeDiagnostics.valid && originalMaterialSet.size > 0 &&
        selectionHelperCount === 0 && boxHelperCount === 0 &&
        depthWriteViolationCount === 0 && flatShadingMaterialCount === 0;
    const timingControlsValid = animationTiming.valid && animationTiming.timingBlockPresent &&
        animationTiming.inputsInsideToolbar &&
        animationTiming.openInputMinimum === ANIMATION_SECONDS_MIN &&
        animationTiming.openInputMaximum === ANIMATION_SECONDS_MAX &&
        animationTiming.closeInputMinimum === ANIMATION_SECONDS_MIN &&
        animationTiming.closeInputMaximum === ANIMATION_SECONDS_MAX;
    const cameraClippingValid = isCameraClippingValid(cameraClipping);
    const shadowsDisabled = shadowDiagnostics.valid;
    const markersValid = markers.valid && markers.wrongParentCount === 0;
    const baseLightingValid = baseLightDiagnostics.valid;
    const lightRig = getBeamRigDiagnostics();
    const lightRigValid = lightRig.valid;
    const glowValid = glowDiagnostics.valid;
    const selectionOutline = getSelectionOutlineDiagnostics(markers.strayMarkers);
    const selectionOutlineValid = selectionOutline.valid;
    const selectionValid = selectionOutlineValid;
    const sanityPassed = contextAvailable(state.renderer) && !contextLost && modelAttached && layoutSane &&
        visibleMeshCount > 0 && boundsValid && nonBackgroundPercentage >= 1 && displayModeValid &&
        timingControlsValid && cameraClippingValid && shadowsDisabled &&
        baseLightingValid && lightRigValid && glowValid && treeDiagnostics.valid && markersValid &&
        selectionValid;
    const diagnostics = {
        type: "viewerDiagnostics",
        requestId,
        sanityPassed,
        valid: sanityPassed && selectionValid,
        selectionValid,
        selectionOutlineCount: selectionOutline.count,
        selectionOutlineVisibleCount: selectionOutline.visibleCount,
        selectionOutlineVisible: selectionOutline.visibleCount > 0,
        selectionOutline,
        modelAttached,
        contextLost,
        layoutSane,
        canvasAspect,
        visibleMeshCount,
        nonBackgroundPixelCount,
        nonBackgroundPercentage,
        displayModeValid,
        backgroundColorInputValid: backgroundDiagnostics.valid,
        background: backgroundDiagnostics,
        timingControlsValid,
        shadowMapEnabled: shadowDiagnostics.shadowMapEnabled,
        shadowsDisabled,
        shadows: shadowDiagnostics,
        displayModeCatalog: getDisplayModeCatalog(),
        pickStack: getPickStackDiagnostics(),
        visibility: getVisibilityDiagnostics(),
        baseLightingValid,
        lightRigValid,
        lightPanelRemoved: baseLightDiagnostics.lightPanelRemoved,
        baseLights: baseLightDiagnostics,
        lightRig,
        inspectorPanelRemoved: baseLightDiagnostics.lightPanelRemoved,
        inspectorPanelArtifacts: baseLightDiagnostics.lightPanelArtifacts,
        glowValid,
        glow: glowDiagnostics,
        treeGroupCount: treeDiagnostics.groupCount,
        treeCollapsedGroups: treeDiagnostics.collapsedGroups,
        treeExpandedGroups: treeDiagnostics.expandedGroups,
        treeControlsValid: treeDiagnostics.controlsValid,
        treeValid: treeDiagnostics.valid,
        tree: treeDiagnostics,
        markersValid,
        markers,
        fastenerMarkers: markers.fastenerMarkerCount,
        strayMarkers: markers.strayMarkers,
        animationBindingValid: markers.animationBinding ? markers.animationBinding.valid : false,
        animationBinding: markers.animationBinding,
        cameraClippingValid,
        cameraClipping: {
            near: state.camera.near,
            far: state.camera.far,
            minimumDistance: state.controls.minDistance,
            minDistance: state.controls.minDistance,
            maximumDistance: state.controls.maxDistance,
            currentDistance: getCameraDistance(),
            modelRadius: state.modelRadius,
            nearSafeAtMinimumDistance: state.camera.near > 0 && state.camera.near < state.controls.minDistance,
            farCoversModel: state.camera.far >= getCameraDistance() + state.modelRadius * CAMERA_FAR_CLEARANCE_RADII,
            radiusFarFloorSatisfied: state.camera.far >= state.modelRadius * CAMERA_FAR_RADIUS_MINIMUM,
            nearRadiusRatio: CAMERA_NEAR_RADIUS_RATIO,
            nearAbsoluteMinimum: CAMERA_NEAR_ABSOLUTE_MIN,
            minimumDistanceRadiusRatio: CAMERA_MIN_DISTANCE_RADIUS_RATIO,
            farClearanceRadii: CAMERA_FAR_CLEARANCE_RADII,
            farRadiusMinimum: CAMERA_FAR_RADIUS_MINIMUM
        },
        displayMode: {
            mode: state.displayMode,
            defaultColorMode: state.displayMode === "facets",
            modelMeshCount,
            appliedMeshCount: modelMeshCount,
            originalMaterialPropertiesStored: originalMaterialSet.size,
            normalMaterialCount: currentDisplayModeDiagnostics.normalMaterialCount,
            visibleMaterialCount: currentDisplayModeDiagnostics.visibleMaterialCount,
            hiddenModelMeshCount: currentDisplayModeDiagnostics.hiddenModelMeshCount,
            lineSegmentCount: wireframeOverlayDiagnostics.lineSegmentCount,
            visibleLineSegmentCount: wireframeOverlayDiagnostics.visibleLineSegmentCount,
            wireframeOverlay: wireframeOverlayDiagnostics,
            depthWriteViolationCount,
            flatShadingMaterialCount,
            selectionHelperCount,
            selectionOutlineCount: selectionOutline.count,
            selectionOutlineVisibleCount: selectionOutline.visibleCount,
            boxHelperCount,
            markerHelpersExcluded: Boolean(state.markerGroup && state.markerGroup !== state.modelRoot),
            parentedMarkerCount: markers.parentedToPart,
            worldMarkerCount: markers.worldSpace
        },
        animationTiming,
        partMeasurements: state.measurements,
        pickTargetCount: state.pickTargets.length,
        viewport: {
            clientWidth: elements.viewport.clientWidth,
            clientHeight: elements.viewport.clientHeight,
            canvasClientWidth: canvas.clientWidth,
            canvasClientHeight: canvas.clientHeight,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height
        },
        scene: {
            childCount: state.scene.children.length,
            modelChildCount: root ? root.children.length : 0,
            modelObjectCount,
            visibleObjectCount,
            visibleMeshCount,
            materialCount: materialSet.size,
            transparentMaterialCount,
            materialColors: Array.from(materialColors),
            renderedFrameCount: state.renderedFrameCount
        },
        hierarchy: {
            defined: state.hierarchy.defined,
            source: state.hierarchy.source,
            moduleCount: state.hierarchy.moduleCount,
            blockCount: state.hierarchy.blockCount
        },
        modelBounds: boundsValid ? {
            minimum: vectorData(bounds.min),
            maximum: vectorData(bounds.max),
            size: vectorData(boundsSize),
            center: vectorData(boundsCenter)
        } : null,
        camera: {
            position: vectorData(state.camera.position),
            target: vectorData(state.controls.target),
            direction: vectorData(cameraDirection),
            near: state.camera.near,
            far: state.camera.far,
            minimumDistance: state.controls.minDistance,
            minDistance: state.controls.minDistance,
            maximumDistance: state.controls.maxDistance,
            currentDistance: getCameraDistance(),
            modelRadius: state.modelRadius,
            fov: state.camera.fov,
            aspect: state.camera.aspect
        },
        ground: {
            visible: state.ground.visible,
            position: vectorData(state.ground.position),
            scale: vectorData(state.ground.scale)
        },
        webgl: {
            available: contextAvailable(state.renderer),
            version: gl.getParameter(gl.VERSION),
            shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
            vendor: gl.getParameter(gl.VENDOR),
            renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            error: gl.getError()
        },
        pixels: {
            background,
            threshold,
            width,
            height,
            totalPixelCount,
            nonBackgroundPixelCount,
            nonBackgroundPercentage
        },
        renderer: {
            webgl2: state.renderer.capabilities.isWebGL2,
            logarithmicDepthBuffer: state.renderer.capabilities.logarithmicDepthBuffer === true,
            calls: state.renderer.info.render.calls,
            triangles: state.renderer.info.render.triangles,
            points: state.renderer.info.render.points,
            lines: state.renderer.info.render.lines
        }
    };
    sendToHost(diagnostics);
    return diagnostics;
}

function contextAvailable(renderer) {
    try {
        return Boolean(renderer && renderer.getContext());
    } catch {
        return false;
    }
}

function classifyClip(clip) {
    const lowerName = String(clip.name || "").toLowerCase();
    const trackNames = clip.tracks.map(track => track.name.toLowerCase());
    const hasRotation = trackNames.some(name => name.includes("quaternion") || name.includes("rotation"));
    const hasTranslation = trackNames.some(name => name.includes("position") || name.includes("translation"));
    if (hasRotation || lowerName.includes("rotation") || lowerName.includes("type_1")) {
        return "rotation";
    }
    if (hasTranslation || lowerName.includes("sliding") || lowerName.includes("type_2")) {
        return "sliding";
    }
    return "other";
}

function getAnimationCounts() {
    const counts = { rotation: 0, sliding: 0, other: 0 };
    for (const clip of state.clips) {
        counts[classifyClip(clip)] += 1;
    }
    return counts;
}

function getAnimationKindLabel(kind) {
    if (kind === "rotation") {
        return "вращательная";
    }
    if (kind === "sliding") {
        return "скользящая";
    }
    return "другая";
}

function getAnimationName(clip, index) {
    return clip.name || `Анимация ${index + 1}`;
}



function updateAnimationTimingControls() {}

function clampAnimationSeconds(value, fallback = ANIMATION_SECONDS_DEFAULT) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return clampAnimationSeconds(fallback, ANIMATION_SECONDS_DEFAULT);
    }
    return Math.min(ANIMATION_SECONDS_MAX, Math.max(ANIMATION_SECONDS_MIN, numeric));
}

function formatAnimationSeconds(value) {
    return value.toFixed(2);
}





function getAnimationOpenPoseTime(action) {
    return getClipPoseTime(action ? action.getClip() : null);
}

function getClipPoseTime(clip) {
    if (!clip) {
        return 0;
    }
    const duration = Number(clip.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
        return 0;
    }
    const extras = getObjectExtras(clip);
    const sourceDuration = Number(extras.durationSeconds);
    if (extras.timeline === "closed-open-closed" && Number.isFinite(sourceDuration) && sourceDuration > 0) {
        return Math.min(duration, sourceDuration);
    }
    return duration / 2;
}

function setAnimationTimingDefaults() {
    state.openSeconds = ANIMATION_SECONDS_DEFAULT;
    state.closeSeconds = ANIMATION_SECONDS_DEFAULT;
}

function updateAnimationTimingSettings() {
    if (!state.activeAction) {
        return;
    }
    if (state.animationDirection === "opening" && state.activeAction.time < state.openPoseTime) {
        state.activeAction.setEffectiveTimeScale((state.openPoseTime - state.activeAction.time) / state.openSeconds);
    } else if (state.animationDirection === "closing" && state.activeAction.time > 0) {
        state.activeAction.setEffectiveTimeScale(-state.activeAction.time / state.closeSeconds);
    }
}

function isSelectedClipAnimating() {
    return state.activeClipIndex >= 0 && state.animatingClipIndices.has(state.activeClipIndex);
}

function refreshAnimationPlayingState() {
    state.animationPlaying = state.animatingClipIndices.size > 0;
    return state.animationPlaying;
}

function getClipAction(clipIndex, create = false) {
    if (!state.mixer || !Number.isInteger(clipIndex) || clipIndex < 0 || clipIndex >= state.clips.length) {
        return null;
    }
    const existing = state.mixer.existingAction(state.clips[clipIndex]);
    return existing || (create ? state.mixer.clipAction(state.clips[clipIndex]) : null);
}

function getClipTime(clipIndex) {
    const action = getClipAction(clipIndex);
    const time = action ? Number(action.time) : 0;
    return Number.isFinite(time) ? time : 0;
}

function getClipOpenPoseTime(clipIndex) {
    if (state.clipOpenPoseTimes.has(clipIndex)) {
        return state.clipOpenPoseTimes.get(clipIndex);
    }
    const openPoseTime = getClipPoseTime(state.clips[clipIndex]);
    state.clipOpenPoseTimes.set(clipIndex, openPoseTime);
    return openPoseTime;
}

function markClipAnimating(clipIndex) {
    state.openClipIndices.delete(clipIndex);
    state.animatingClipIndices.add(clipIndex);
    refreshAnimationPlayingState();
}

function markClipOpen(clipIndex) {
    state.animatingClipIndices.delete(clipIndex);
    state.openClipIndices.add(clipIndex);
    refreshAnimationPlayingState();
}

function markClipClosed(clipIndex) {
    state.animatingClipIndices.delete(clipIndex);
    state.openClipIndices.delete(clipIndex);
    refreshAnimationPlayingState();
}

function closeAllOpenedAnimations() {
    for (const clipIndex of Array.from(state.openClipIndices)) {
        completeClipClosing(clipIndex);
    }
    return state.openClipIndices.size === 0;
}

function completeClipOpening(clipIndex) {
    const action = getClipAction(clipIndex, true);
    const openPoseTime = getClipOpenPoseTime(clipIndex);
    if (!action || openPoseTime <= 0) {
        markClipClosed(clipIndex);
        return false;
    }
    action.time = openPoseTime;
    action.paused = true;
    action.setEffectiveTimeScale(openPoseTime / state.openSeconds);
    state.mixer.update(0);
    markClipOpen(clipIndex);
    return true;
}

function completeClipClosing(clipIndex) {
    const action = getClipAction(clipIndex, true);
    if (!action) {
        markClipClosed(clipIndex);
        return false;
    }
    action.time = 0;
    action.paused = true;
    action.setEffectiveTimeScale(-state.closeSeconds);
    state.mixer.update(0);
    markClipClosed(clipIndex);
    return true;
}

function updateUnselectedAnimations() {
    if (state.animatingClipIndices.size === 0) {
        return false;
    }
    let completed = false;
    for (const clipIndex of Array.from(state.animatingClipIndices)) {
        if (state.activeClipIndex === clipIndex) {
            continue;
        }
        const action = getClipAction(clipIndex);
        if (!action) {
            markClipClosed(clipIndex);
            completed = true;
            continue;
        }
        if (action.getEffectiveTimeScale() >= 0) {
            if (action.time >= getClipOpenPoseTime(clipIndex)) {
                completed = completeClipOpening(clipIndex) || completed;
            }
        } else if (action.time <= ANIMATION_SECONDS_EPSILON) {
            completed = completeClipClosing(clipIndex) || completed;
        }
    }
    return completed;
}

function completeAnimationOpening() {
    if (!state.activeAction || !state.mixer || state.openPoseTime <= 0) {
        return false;
    }
    const action = state.activeAction;
    action.time = state.openPoseTime;
    action.paused = true;
    action.setEffectiveTimeScale(state.openPoseTime / state.openSeconds);
    state.mixer.update(0);
    markClipOpen(state.activeClipIndex);
    state.animationDirection = "open";
    state.doorOpen = true;
    updateAnimationTimingControls();
    return true;
}

function completeAnimationClosing() {
    if (!state.activeAction || !state.mixer) {
        return false;
    }
    const action = state.activeAction;
    action.time = 0;
    action.paused = true;
    action.setEffectiveTimeScale(-state.closeSeconds);
    state.mixer.update(0);
    markClipClosed(state.activeClipIndex);
    state.animationDirection = "closed";
    state.doorOpen = false;
    updateAnimationTimingControls();
    return true;
}

function updateTimedAnimation() {
    if (!state.activeAction) {
        return false;
    }
    if (state.animationDirection === "opening" && state.activeAction.time >= state.openPoseTime) {
        return completeAnimationOpening();
    }
    if (state.animationDirection === "closing" && state.activeAction.time <= 0) {
        return completeAnimationClosing();
    }
    return false;
}

function startTimedOpening() {
    if (!state.activeAction) {
        return false;
    }
    updateAnimationTimingSettings();
    if (state.openPoseTime <= 0) {
        return false;
    }
    const action = state.activeAction;
    action.reset();
    action.setLoop(state.THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.time = 0;
    action.paused = false;
    action.setEffectiveTimeScale(state.openPoseTime / state.openSeconds);
    action.play();
    state.mixer.update(0);
    markClipAnimating(state.activeClipIndex);
    state.animationDirection = "opening";
    state.doorOpen = true;
    updateAnimationTimingControls();
    return true;
}

function startTimedClosing() {
    if (!state.activeAction) {
        return false;
    }
    updateAnimationTimingSettings();
    const action = state.activeAction;
    const currentTime = Number(action.time);
    if (!Number.isFinite(currentTime) || currentTime <= ANIMATION_SECONDS_EPSILON) {
        return completeAnimationClosing();
    }
    action.paused = false;
    action.setEffectiveTimeScale(-currentTime / state.closeSeconds);
    action.play();
    markClipAnimating(state.activeClipIndex);
    state.animationDirection = "closing";
    state.doorOpen = false;
    updateAnimationTimingControls();
    return true;
}

function prepareSelectedAnimation() {
    if (!state.mixer || state.clips.length === 0) {
        state.activeAction = null;
        state.activeClipIndex = -1;
        state.activeAnimationIndex = null;
        state.openPoseTime = 0;
        state.animationDirection = "closed";
        updateAnimationTimingControls();
        return false;
    }
    const index = state.requestedClipIndex;
    if (!Number.isInteger(index) || index < 0 || index >= state.clips.length) {
        state.activeAction = null;
        state.activeClipIndex = -1;
        state.activeAnimationIndex = null;
        state.openPoseTime = 0;
        state.animationDirection = "closed";
        updateAnimationTimingControls();
        return false;
    }
    const action = state.mixer.clipAction(state.clips[index]);
    action.enabled = true;
    action.setLoop(state.THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset();
    action.play();
    state.activeAction = action;
    state.activeClipIndex = index;
    state.activeAnimationIndex = state.clipSourceIndices.has(index) ? state.clipSourceIndices.get(index) : null;
    state.openPoseTime = getAnimationOpenPoseTime(action);
    if (state.timingClipIndex !== index) {
        setAnimationTimingDefaults();
        state.timingClipIndex = index;
    }
    if (state.openClipIndices.has(index) && state.openPoseTime > 0) {
        action.time = state.openPoseTime;
        action.paused = true;
        action.setEffectiveTimeScale(state.openPoseTime / state.openSeconds);
        state.animationDirection = "open";
        state.doorOpen = true;
    } else {
        action.time = 0;
        action.paused = true;
        action.setEffectiveTimeScale(-state.closeSeconds);
        state.animationDirection = "closed";
        state.doorOpen = false;
    }
    state.mixer.update(0);
    updateAnimationTimingControls();
    return true;
}

function playSelectedAnimation() {
    if (!state.activeAction) {
        return false;
    }
    if ((state.animationDirection === "opening" && state.activeAction.time < state.openPoseTime) ||
        (state.animationDirection === "closing" && state.activeAction.time > 0)) {
        state.activeAction.paused = false;
        state.activeAction.play();
        markClipAnimating(state.activeClipIndex);
        updateAnimationTimingControls();
        return true;
    }
    return startTimedOpening();
}

function selectAnimation(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.clips.length) {
        return false;
    }
    state.requestedClipIndex = index;
    return prepareSelectedAnimation();
}

function toggleAnimation() {
    if (!state.activeAction) {
        return false;
    }
    if (isSelectedClipAnimating()) {
        state.activeAction.paused = true;
        state.animatingClipIndices.delete(state.activeClipIndex);
        refreshAnimationPlayingState();
        updateAnimationTimingControls();
        return true;
    }
    return playSelectedAnimation();
}

function resetSelectedAnimation() {
    if (!state.activeAction) {
        return false;
    }
    const action = state.activeAction;
    action.reset();
    action.play();
    action.time = 0;
    action.paused = true;
    action.setEffectiveTimeScale(-state.closeSeconds);
    state.mixer.update(0);
    markClipClosed(state.activeClipIndex);
    state.animationDirection = "closed";
    state.doorOpen = false;
    updateAnimationTimingControls();
    return true;
}

function toggleDoor() {
    return state.doorOpen ? startTimedClosing() : startTimedOpening();
}

function resetAnimationSelection() {
    state.requestedClipIndex = state.clips.length > 0 ? 0 : -1;
    state.timingClipIndex = -1;
    if (state.clips.length > 0) {
        return prepareSelectedAnimation();
    }
    state.activeAction = null;
    state.activeClipIndex = -1;
    state.activeAnimationIndex = null;
    state.openPoseTime = 0;
    state.animationDirection = "closed";
    state.doorOpen = false;
    updateAnimationTimingControls();
    return false;
}

function getAnimationTimingDiagnostics() {
    const action = state.activeAction;
    return {
        openSeconds: state.openSeconds,
        closeSeconds: state.closeSeconds,
        defaultOpenSeconds: ANIMATION_SECONDS_DEFAULT,
        defaultCloseSeconds: ANIMATION_SECONDS_DEFAULT,
        fixedDefaultApplied: state.openSeconds === ANIMATION_SECONDS_DEFAULT &&
            state.closeSeconds === ANIMATION_SECONDS_DEFAULT,
        openPoseTime: state.openPoseTime,
        direction: state.animationDirection,
        doorOpen: state.doorOpen,
        selectedClipAnimating: isSelectedClipAnimating(),
        openClipCount: state.openClipIndices.size,
        animatingClipCount: state.animatingClipIndices.size,
        openClipIndexes: Array.from(state.openClipIndices).sort((first, second) => first - second),
        animatingClipIndexes: Array.from(state.animatingClipIndices).sort((first, second) => first - second),
        actionTime: action && Number.isFinite(Number(action.time)) ? Number(action.time) : null,
        effectiveTimeScale: action && Number.isFinite(Number(action.getEffectiveTimeScale())) ? Number(action.getEffectiveTimeScale()) : null,
        openInput: null,
        closeInput: null,
        minimumSeconds: ANIMATION_SECONDS_MIN,
        maximumSeconds: ANIMATION_SECONDS_MAX,
        timingBlockPresent: true,
        inputsInsideToolbar: true,
        inputsEnabled: true,
        openInputMinimum: ANIMATION_SECONDS_MIN,
        openInputMaximum: ANIMATION_SECONDS_MAX,
        closeInputMinimum: ANIMATION_SECONDS_MIN,
        closeInputMaximum: ANIMATION_SECONDS_MAX,
        openInputLabel: null,
        closeInputLabel: null,
        activeClipIndex: state.activeClipIndex,
        requestedClipIndex: state.requestedClipIndex,
        valid: state.openSeconds >= ANIMATION_SECONDS_MIN && state.openSeconds <= ANIMATION_SECONDS_MAX &&
            state.closeSeconds >= ANIMATION_SECONDS_MIN && state.closeSeconds <= ANIMATION_SECONDS_MAX
    };
}

function getAnimationDiagnostics() {
    const selectedIndex = state.requestedClipIndex;
    return {
        count: state.clips.length,
        playing: state.animationPlaying,
        doorOpen: state.doorOpen,
        openClipCount: state.openClipIndices.size,
        animatingClipCount: state.animatingClipIndices.size,
        openClipIndexes: Array.from(state.openClipIndices).sort((first, second) => first - second),
        animatingClipIndexes: Array.from(state.animatingClipIndices).sort((first, second) => first - second),
        timing: getAnimationTimingDiagnostics(),
        selectedIndex: Number.isInteger(selectedIndex) ? selectedIndex : -1,
        activeClipIndex: state.activeClipIndex,
        activeAnimationIndex: state.activeAnimationIndex,
        hierarchy: {
            defined: state.hierarchy.defined,
            source: state.hierarchy.source,
            moduleCount: state.hierarchy.moduleCount,
            blockCount: state.hierarchy.blockCount
        },
        selection: { ...state.selectionDiagnostic },
        counts: getAnimationCounts(),
        clips: state.clips.map((clip, index) => ({
            index,
            name: getAnimationName(clip, index),
            kind: classifyClip(clip),
            duration: clip.duration,
            tracks: clip.tracks.length,
            animationIndex: state.clipSourceIndices.has(index) ? state.clipSourceIndices.get(index) : null
        }))
    };
}

function getDisplayModeDiagnostics(mode) {
    const definition = getDisplayMode(mode);
    const result = {
        mode,
        label: definition ? definition.label : null,
        meshCount: 0,
        materialCount: 0,
        visibleMaterialCount: 0,
        hiddenMaterialCount: 0,
        normalMaterialCount: 0,
        transparentMaterialCount: 0,
        alphaHashMaterialCount: 0,
        flatShadingMaterialCount: 0,
        hiddenModelMeshCount: 0,
        modelMaterialVisibleViolations: 0,
        depthWriteViolations: 0,
        depthTestViolations: 0,
        transparencyViolations: 0,
        alphaHashViolations: 0,
        doubleSideViolations: 0,
        wireframeViolations: 0,
        sideViolations: 0,
        polygonOffsetViolations: 0,
        flatShadingViolations: 0,
        lineSegmentCount: 0,
        visibleLineSegmentCount: 0,
        lineMaterialDepthTestViolations: 0,
        lineMaterialDepthWriteViolations: 0,
        lineMaterialPolygonOffsetViolations: 0,
        lineMaterialWireframeViolations: 0,
        lineMaterialTransparentViolations: 0,
        edgeLineColor: state.wireframeLineColor === null
            ? null
            : `#${state.wireframeLineColor.toString(16).padStart(6, "0")}`,
        expectsFlatShading: false,
        expectsVisibleMeshes: false,
        expectsVisibleEdges: false,
        expectsFacetsEdgeColor: false,
        boxHelperCount: 0,
        selectionHelperCount: state.selectionHelper ? 1 : 0,
        selectionOutlineCount: 0,
        selectionOutlineVisibleCount: 0,
        selectionOutlineValid: false,
        markerHelpersExcluded: !state.markerGroup || state.markerGroup !== state.modelRoot,
        edgeThreshold: WIREFRAME_EDGE_THRESHOLD,
        background: getBackgroundDiagnostics(),
        wireframeOverlay: getWireframeOverlayDiagnostics(),
        valid: false
    };
    if (!definition || !state.modelRoot) {
        return result;
    }
    result.expectsFlatShading = definition.flatShading;
    result.expectsVisibleMeshes = definition.meshes === "visible";
    result.expectsVisibleEdges = definition.edges;
    result.expectsFacetsEdgeColor = definition.edgeColor === "facets";
    const modelMeshes = getModelMeshes();
    result.meshCount = modelMeshes.length;
    const materials = new Set();
    for (const mesh of modelMeshes) {
        const meshMaterials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        let hidden = meshMaterials.length > 0;
        for (const material of meshMaterials) {
            if (!material) {
                hidden = false;
                continue;
            }
            materials.add(material);
            if (material.visible !== false) {
                hidden = false;
            }
        }
        if (hidden) {
            result.hiddenModelMeshCount += 1;
        }
    }
    for (const material of materials) {
        result.materialCount += 1;
        const expectsVisibleMaterial = definition.meshes === "visible";
        if (material.visible === true) {
            result.visibleMaterialCount += 1;
        }
        if (material.visible === false) {
            result.hiddenMaterialCount += 1;
        }
        if (material.wireframe === true) {
            result.wireframeViolations += 1;
        }
        const originalProperties = material.userData && material.userData[ORIGINAL_MATERIAL_PROPERTIES_KEY];
        const originalSide = originalProperties && originalProperties.side !== undefined
            ? originalProperties.side
            : DISPLAY_MODE_SINGLE_SIDE_DEFAULT;
        const expectedSide = originalSide;
        if (material.side !== expectedSide) {
            result.sideViolations += 1;
        }
        if (material.side === state.THREE.DoubleSide && originalSide !== state.THREE.DoubleSide) {
            result.doubleSideViolations += 1;
        }
        if (material.polygonOffset === true) {
            result.polygonOffsetViolations += 1;
        }
        if (material.flatShading === true) {
            result.flatShadingMaterialCount += 1;
        }
        if (material.flatShading !== definition.flatShading) {
            result.flatShadingViolations += 1;
        }
        if (material.alphaHash === true) {
            result.alphaHashMaterialCount += 1;
        }
        if (material.depthTest !== true) {
            result.depthTestViolations += 1;
        }
        if (material.visible !== expectsVisibleMaterial) {
            result.modelMaterialVisibleViolations += 1;
        }
        if (material.transparent !== definition.transparent) {
            result.transparencyViolations += 1;
        }
        if (material.alphaHash !== DISPLAY_MODE_TRANSPARENT_ALPHA_HASH) {
            result.alphaHashViolations += 1;
        }
        if (definition.transparent) {
            if (Math.abs(material.opacity - DISPLAY_MODE_TRANSPARENT_OPACITY) > 0.000001) {
                result.transparencyViolations += 1;
            }
            result.transparentMaterialCount += 1;
        } else if (material.opacity !== 1) {
            result.transparencyViolations += 1;
        }
        if (material.depthWrite !== true) {
            result.depthWriteViolations += 1;
        }
        if (material.visible === true && material.wireframe === false &&
            material.transparent === false && material.alphaHash === false &&
            material.opacity === 1 && material.depthWrite === true && !definition.transparent) {
            result.normalMaterialCount += 1;
        }
    }
    result.lineSegmentCount = result.wireframeOverlay.lineSegmentCount;
    result.visibleLineSegmentCount = result.wireframeOverlay.visibleLineSegmentCount;
    result.lineMaterialDepthTestViolations = result.wireframeOverlay.lineDepthTestViolations;
    result.lineMaterialDepthWriteViolations = result.wireframeOverlay.lineDepthWriteViolations;
    result.lineMaterialPolygonOffsetViolations = result.wireframeOverlay.linePolygonOffsetViolations;
    result.lineMaterialWireframeViolations = result.wireframeOverlay.lineWireframeViolations;
    result.lineMaterialTransparentViolations = result.wireframeOverlay.lineTransparentViolations;
    result.boxHelperCount = countBoxHelpers(state.modelRoot) +
        (state.selectionHelper && (state.selectionHelper.type === "BoxHelper" || state.selectionHelper.name === "BoxHelper") ? 1 : 0);
    const selectionOutline = getSelectionOutlineDiagnostics();
    result.selectionOutlineCount = selectionOutline.count;
    result.selectionOutlineVisibleCount = selectionOutline.visibleCount;
    result.selectionOutlineValid = selectionOutline.valid;
    const baseValid = result.meshCount > 0 && result.materialCount > 0 &&
        result.modelMaterialVisibleViolations === 0 && result.depthWriteViolations === 0 &&
        result.depthTestViolations === 0 &&
        result.transparencyViolations === 0 && result.alphaHashViolations === 0 &&
        result.wireframeViolations === 0 &&
        result.sideViolations === 0 && result.polygonOffsetViolations === 0 &&
        result.flatShadingViolations === 0 && result.boxHelperCount === 0 &&
        result.selectionHelperCount === 0 && result.markerHelpersExcluded && result.background.valid &&
        result.selectionOutlineValid &&
        result.selectionOutlineVisibleCount === result.selectionOutlineCount;
    const edgesValid = result.wireframeOverlay.valid && result.lineSegmentCount > 0 &&
        result.lineMaterialDepthTestViolations === 0 &&
        result.lineMaterialDepthWriteViolations === 0 &&
        result.lineMaterialPolygonOffsetViolations === 0 &&
        result.lineMaterialWireframeViolations === 0 &&
        result.lineMaterialTransparentViolations === 0;
    const edgesMatchMode = definition.edges
        ? result.visibleLineSegmentCount === result.lineSegmentCount
        : result.visibleLineSegmentCount === 0;
    const meshesMatchMode = definition.meshes === "hidden"
        ? result.hiddenModelMeshCount === result.meshCount
        : result.hiddenModelMeshCount === 0;
    const facetsValid = !result.expectsFacetsEdgeColor ||
        result.edgeLineColor === `#${(getBackgroundLuminance() > 0.48
            ? FACETS_EDGE_LINE_COLOR
            : FACETS_EDGE_LINE_COLOR_ON_DARK).toString(16).padStart(6, "0")}`;
    const expectsNormalMaterials = !definition.transparent && !definition.flatShading && definition.meshes === "visible";
    result.valid = baseValid && edgesMatchMode && meshesMatchMode && facetsValid &&
        result.alphaHashMaterialCount === 0 &&
        (!definition.transparent || (result.transparentMaterialCount === result.materialCount && result.doubleSideViolations === 0)) &&
        (!expectsNormalMaterials || result.normalMaterialCount > 0) &&
        (!definition.flatShading || result.flatShadingMaterialCount === result.materialCount) &&
        (!definition.edges || edgesValid);
    return result;
}

function testDisplayModes() {
    const results = {};
    for (const mode of DISPLAY_MODE_IDS) {
        applyDisplayMode(mode);
        results[mode] = getDisplayModeDiagnostics(mode);
    }
    applyDisplayMode(DISPLAY_MODE_DEFAULT);
    return results;
}

function getDisplayModeCatalog() {
    return DISPLAY_MODES.map(mode => ({
        id: mode.id,
        label: mode.label,
        meshes: mode.meshes,
        edges: mode.edges,
        flatShading: mode.flatShading,
        transparent: mode.transparent
    }));
}

function testDisplayModeCatalog() {
    const savedMode = state.displayMode;
    const results = testDisplayModes();
    applyDisplayMode(savedMode);
    return DISPLAY_MODES.map(mode => {
        const diagnostic = results[mode.id];
        return {
            id: mode.id,
            label: mode.label,
            valid: Boolean(diagnostic && diagnostic.valid),
            meshCount: diagnostic ? diagnostic.meshCount : 0,
            materialCount: diagnostic ? diagnostic.materialCount : 0,
            normalMaterialCount: diagnostic ? diagnostic.normalMaterialCount : 0,
            flatShadingMaterialCount: diagnostic ? diagnostic.flatShadingMaterialCount : 0,
            transparentMaterialCount: diagnostic ? diagnostic.transparentMaterialCount : 0,
            hiddenModelMeshCount: diagnostic ? diagnostic.hiddenModelMeshCount : 0,
            lineSegmentCount: diagnostic ? diagnostic.lineSegmentCount : 0,
            visibleLineSegmentCount: diagnostic ? diagnostic.visibleLineSegmentCount : 0,
            edgeLineColor: diagnostic ? diagnostic.edgeLineColor : null
        };
    });
}

function getTransparentProbeBackgroundRgb() {
    const backgroundHex = state.scene && state.scene.background && state.scene.background.isColor
        ? state.scene.background.getHex(state.THREE.SRGBColorSpace)
        : DEFAULT_BACKGROUND_COLOR;
    return {
        r: (backgroundHex >> 16) & 255,
        g: (backgroundHex >> 8) & 255,
        b: backgroundHex & 255
    };
}

function isTransparentProbeBackgroundPixel(pixels, offset, background) {
    return Math.abs(pixels[offset] - background.r) <= TRANSPARENT_PROBE_BACKGROUND_TOLERANCE &&
        Math.abs(pixels[offset + 1] - background.g) <= TRANSPARENT_PROBE_BACKGROUND_TOLERANCE &&
        Math.abs(pixels[offset + 2] - background.b) <= TRANSPARENT_PROBE_BACKGROUND_TOLERANCE;
}

function countTransparentProbeChangedPixels(reference, highlighted) {
    let count = 0;
    for (let offset = 0; offset < reference.pixels.length; offset += 4) {
        const delta = Math.max(
            Math.abs(reference.pixels[offset] - highlighted.pixels[offset]),
            Math.abs(reference.pixels[offset + 1] - highlighted.pixels[offset + 1]),
            Math.abs(reference.pixels[offset + 2] - highlighted.pixels[offset + 2]));
        if (delta > TRANSPARENT_PROBE_CHANGE_DELTA) {
            count += 1;
        }
    }
    return count;
}

function assignTransparentProbeIsolatedMaterials(mesh) {
    const saved = { mesh, material: mesh.material, renderOrder: mesh.renderOrder };
    if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(material =>
            material && typeof material.clone === "function" ? material.clone() : material);
    } else if (mesh.material && typeof mesh.material.clone === "function") {
        mesh.material = mesh.material.clone();
    }
    for (const material of getMeshMaterials(mesh.material)) {
        if (material && typeof material.clone === "function") {
            material.userData = {};
        }
    }
    return saved;
}

function applyTransparentProbeOnTopOverride(materials, active) {
    for (const material of getMeshMaterials(materials)) {
        if (!material) {
            continue;
        }
        if (active) {
            material.depthTest = false;
            material.depthWrite = false;
            material.transparent = false;
            material.opacity = 1;
            material.needsUpdate = true;
        }
    }
}

function restoreTransparentProbeIsolatedMaterials(saved) {
    if (!saved) {
        return;
    }
    for (const material of getMeshMaterials(saved.material)) {
        if (material && typeof material.dispose === "function") {
            material.dispose();
        }
    }
    saved.mesh.renderOrder = saved.renderOrder;
    saved.mesh.material = saved.material;
}

const transparentProbeSavedMaterials = new Map();

function applyTransparentProbeHighlight(meshes) {
    restoreTransparentProbeHighlight();
    for (const mesh of meshes) {
        for (const material of getMeshMaterials(mesh.material)) {
            if (!material || transparentProbeSavedMaterials.has(material)) {
                continue;
            }
            transparentProbeSavedMaterials.set(material, {
                color: material.color && typeof material.color.clone === "function" ? material.color.clone() : null,
                emissive: material.emissive && typeof material.emissive.clone === "function" ? material.emissive.clone() : null,
                emissiveIntensity: material.emissiveIntensity,
                map: material.map ?? null,
                metalness: material.metalness,
                roughness: material.roughness
            });
            if (material.color) {
                material.color.setRGB(0, 0, 0);
            }
            if (material.emissive) {
                material.emissive.setHex(TRANSPARENT_PROBE_HIGHLIGHT_COLOR, state.THREE.SRGBColorSpace);
            }
            material.emissiveIntensity = TRANSPARENT_PROBE_HIGHLIGHT_INTENSITY;
            material.map = null;
            material.metalness = 0;
            material.roughness = 1;
            material.needsUpdate = true;
        }
    }
}

function restoreTransparentProbeHighlight() {
    for (const [material, saved] of transparentProbeSavedMaterials) {
        if (saved.color && material.color && typeof material.color.copy === "function") {
            material.color.copy(saved.color);
        }
        if (saved.emissive && material.emissive && typeof material.emissive.copy === "function") {
            material.emissive.copy(saved.emissive);
        }
        material.emissiveIntensity = saved.emissiveIntensity;
        material.map = saved.map;
        material.metalness = saved.metalness;
        material.roughness = saved.roughness;
        material.needsUpdate = true;
    }
    transparentProbeSavedMaterials.clear();
}

function placeTransparentProbeView(index, total, stepDeg) {
    const THREE = state.THREE;
    if (!THREE || !state.camera || !state.controls) {
        return null;
    }
    const center = getBeamObserverViewCenter();
    const distance = getBeamObserverViewDistance();
    const step = stepDeg === undefined ? TRANSPARENT_PROBE_STEP_DEG : stepDeg;
    const azimuth = (Math.PI * 2 * step * index) / 360;
    const elevation = (TRANSPARENT_PROBE_VIEW_ELEVATION_DEG * Math.PI) / 180;
    const horizontal = Math.cos(elevation) * distance;
    state.controls.target.copy(center);
    state.camera.position.set(
        center.x + Math.sin(azimuth) * horizontal,
        center.y + Math.sin(elevation) * distance,
        center.z + Math.cos(azimuth) * horizontal);
    state.controls.update();
    state.controls.update();
    updateCameraClipping();
    state.camera.updateMatrixWorld(true);
    updateBeamLight();
    return {
        index,
        stepDeg: step,
        azimuthDeg: Math.round((azimuth * 180) / Math.PI * 1000) / 1000,
        elevationDeg: TRANSPARENT_PROBE_VIEW_ELEVATION_DEG,
        distance: Math.round(distance * 1000) / 1000
    };
}

function getTransparentProbeSurfaceScheme() {
    const samples = [];
    const materials = new Set();
    for (const mesh of getModelMeshes()) {
        for (const material of getMeshMaterials(mesh.material)) {
            if (material) {
                materials.add(material);
            }
        }
    }
    let index = 0;
    for (const material of materials) {
        if (index >= 3) {
            break;
        }
        samples.push({
            type: material.type,
            transparent: material.transparent === true,
            alphaHash: material.alphaHash === true,
            opacity: Number(material.opacity),
            depthWrite: material.depthWrite === true,
            depthTest: material.depthTest === true,
            side: material.side,
            blending: material.blending,
            visible: material.visible === true
        });
        index += 1;
    }
    return {
        materialCount: materials.size,
        samples,
        note: "Смешивание по альфе с постоянной записью в буфер глубины: ближайшая поверхность всегда выигрывает, поэтому деталь не может исчезнуть из-за порядка отрисовки. Порядок отрисовки задаётся точным сортированием от дальних к ближним."
    };
}

function measureTransparentProbeView(index, total, stepDeg) {
    const view = placeTransparentProbeView(index, total, stepDeg);
    applyDisplayMode(DISPLAY_MODE_DEFAULT);
    const reference = captureFramePixels();
    const background = getTransparentProbeBackgroundRgb();
    const silhouette = new Uint8Array(reference.total);
    let silhouettePixels = 0;
    for (let offset = 0, position = 0; offset < reference.pixels.length; offset += 4, position += 1) {
        if (!isTransparentProbeBackgroundPixel(reference.pixels, offset, background)) {
            silhouette[position] = 1;
            silhouettePixels += 1;
        }
    }
    applyDisplayMode(DISPLAY_MODE_TRANSPARENT);
    const frame = captureFramePixels();
    let coveredPixels = 0;
    let holePixels = 0;
    let spillPixels = 0;
    for (let offset = 0, position = 0; offset < frame.pixels.length; offset += 4, position += 1) {
        const drawn = !isTransparentProbeBackgroundPixel(frame.pixels, offset, background);
        if (silhouette[position] === 1) {
            if (drawn) {
                coveredPixels += 1;
            } else {
                holePixels += 1;
            }
        } else if (drawn) {
            spillPixels += 1;
        }
    }
    return {
        view,
        totalPixelCount: frame.total,
        silhouettePixels,
        coveredPixels,
        holePixels,
        spillPixels,
        coveredPercent: silhouettePixels > 0 ? Math.round((coveredPixels * 100000) / silhouettePixels) / 1000 : 0,
        holePercent: silhouettePixels > 0 ? Math.round((holePixels * 100000) / silhouettePixels) / 1000 : 0,
        frame
    };
}

function measureTransparentProbeSeries(total, stepDeg) {
    const views = [];
    for (let index = 0; index < total; index += 1) {
        views.push(measureTransparentProbeView(index, total, stepDeg));
    }
    const pairs = [];
    for (let index = 0; index < views.length - 1; index += 1) {
        pairs.push(compareTransparentProbeFrames(views[index], views[index + 1]));
    }
    return { views, pairs };
}

function summarizeTransparentProbeSeries(series) {
    const coveredCounts = series.views.map(view => view.coveredPixels);
    const holeCounts = series.views.map(view => view.holePixels);
    const holePercents = series.views.map(view => view.holePercent);
    const coveredPercents = series.views.map(view => view.coveredPercent);
    const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    const minimumCovered = Math.min(...coveredCounts);
    const maximumCovered = Math.max(...coveredCounts);
    const meanCovered = mean(coveredCounts);
    const minimumHole = Math.min(...holeCounts);
    const maximumHole = Math.max(...holeCounts);
    const meanHole = mean(holeCounts);
    const minimumHolePercent = Math.min(...holePercents);
    const maximumHolePercent = Math.max(...holePercents);
    const meanHolePercent = mean(holePercents);
    const minimumCoveredPercent = Math.min(...coveredPercents);
    const maximumCoveredPercent = Math.max(...coveredPercents);
    return {
        frameCount: series.views.length,
        minimumCoveredPixels: minimumCovered,
        maximumCoveredPixels: maximumCovered,
        meanCoveredPixels: Math.round(meanCovered),
        coveredSpreadPixels: maximumCovered - minimumCovered,
        coveredSpreadPercent: meanCovered > 0 ? Math.round(((maximumCovered - minimumCovered) * 100000) / meanCovered) / 1000 : 0,
        minimumCoveredPercent,
        maximumCoveredPercent,
        minimumHolePixels: minimumHole,
        maximumHolePixels: maximumHole,
        meanHolePixels: Math.round(meanHole),
        holeSpreadPixels: maximumHole - minimumHole,
        holeSpreadPercent: meanHole > 0 ? Math.round(((maximumHole - minimumHole) * 100000) / meanHole) / 1000 : 0,
        minimumHolePercent,
        maximumHolePercent,
        meanHolePercent: Math.round(meanHolePercent * 1000) / 1000,
        holePercentSwing: Math.round((maximumHolePercent - minimumHolePercent) * 1000) / 1000,
        maximumPairChangedPercent: series.pairs.length > 0 ? Math.max(...series.pairs.map(pair => pair.changedPercent)) : 0,
        maximumPairDisappearedPixels: series.pairs.length > 0 ? Math.max(...series.pairs.map(pair => pair.disappearedPixels)) : 0,
        maximumPairCoverageDeltaPixels: series.pairs.length > 0
            ? Math.max(...series.pairs.map(pair => Math.abs(pair.coverageDeltaPixels)))
            : 0
    };
}

function compareTransparentProbeFrames(first, second) {
    const background = getTransparentProbeBackgroundRgb();
    let appearedPixels = 0;
    let disappearedPixels = 0;
    let changedPixels = 0;
    for (let offset = 0; offset < first.frame.pixels.length; offset += 4) {
        const before = !isTransparentProbeBackgroundPixel(first.frame.pixels, offset, background);
        const after = !isTransparentProbeBackgroundPixel(second.frame.pixels, offset, background);
        if (before && !after) {
            disappearedPixels += 1;
        } else if (!before && after) {
            appearedPixels += 1;
        }
        const delta = Math.max(
            Math.abs(first.frame.pixels[offset] - second.frame.pixels[offset]),
            Math.abs(first.frame.pixels[offset + 1] - second.frame.pixels[offset + 1]),
            Math.abs(first.frame.pixels[offset + 2] - second.frame.pixels[offset + 2]));
        if (delta > TRANSPARENT_PROBE_PIXEL_DELTA) {
            changedPixels += 1;
        }
    }
    return {
        fromView: first.view.index,
        toView: second.view.index,
        appearedPixels,
        disappearedPixels,
        changedPixels,
        changedPercent: first.totalPixelCount > 0 ? Math.round((changedPixels * 100000) / first.totalPixelCount) / 1000 : 0,
        coverageDeltaPixels: second.coveredPixels - first.coveredPixels
    };
}

function collectTransparentProbeParts() {
    const meshes = getModelMeshes();
    const ranked = meshes.map((mesh, index) => ({
        mesh,
        index,
        triangles: countGeometryTriangles(mesh.geometry),
        name: getObjectName(mesh, index)
    }));
    const selected = [];
    const seen = new Set();
    const add = entry => {
        if (!entry || seen.has(entry.index)) {
            return;
        }
        seen.add(entry.index);
        selected.push(entry);
    };
    const spreadCount = Math.min(TRANSPARENT_PROBE_SPREAD_PART_COUNT, ranked.length);
    for (let step = 0; step < spreadCount; step += 1) {
        add(ranked[Math.min(ranked.length - 1, Math.floor((step * ranked.length) / spreadCount))]);
    }
    const smallest = [...ranked].sort((first, second) => first.triangles - second.triangles);
    for (const entry of smallest) {
        if (selected.length >= TRANSPARENT_PROBE_PART_COUNT) {
            break;
        }
        add(entry);
    }
    return selected.slice(0, TRANSPARENT_PROBE_PART_COUNT).map((entry, position) => ({
        index: entry.index,
        position,
        name: entry.name,
        triangles: entry.triangles,
        mesh: entry.mesh,
        views: [],
        framedViews: []
    }));
}

function placeTransparentProbePartView(mesh, viewIndex, total, stepDeg) {
    const THREE = state.THREE;
    if (!THREE || !state.camera || !state.controls || !mesh || !mesh.geometry) {
        return null;
    }
    const bounds = getGeometryBounds(mesh.geometry);
    if (!bounds) {
        return null;
    }
    state.scene.updateMatrixWorld(true);
    const world = bounds.clone().applyMatrix4(mesh.matrixWorld);
    const sphere = world.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, state.modelRadius * 0.0005);
    const step = stepDeg === undefined ? TRANSPARENT_PROBE_STEP_DEG : stepDeg;
    const azimuth = (Math.PI * 2 * step * viewIndex) / 360;
    const elevation = (TRANSPARENT_PROBE_VIEW_ELEVATION_DEG * Math.PI) / 180;
    const verticalFov = (state.camera.fov * Math.PI) / 180;
    const distance = (radius / Math.sin(verticalFov * 0.5)) * TRANSPARENT_PROBE_PART_FRAME_MARGIN;
    const horizontal = Math.cos(elevation) * distance;
    state.controls.target.copy(sphere.center);
    state.camera.position.set(
        sphere.center.x + Math.sin(azimuth) * horizontal,
        sphere.center.y + Math.sin(elevation) * distance,
        sphere.center.z + Math.cos(azimuth) * horizontal);
    state.controls.update();
    state.controls.update();
    updateCameraClipping();
    state.camera.updateMatrixWorld(true);
    updateBeamLight();
    return {
        viewIndex,
        stepDeg: step,
        azimuthDeg: Math.round((azimuth * 180) / Math.PI * 1000) / 1000,
        partRadius: Math.round(radius * 1000000) / 1000000,
        requestedDistance: Math.round(distance * 1000000) / 1000000,
        actualDistance: Math.round(state.camera.position.distanceTo(state.controls.target) * 1000000) / 1000000
    };
}

function setTransparentProbeMeshVisibility(meshes, keepMesh) {    for (const mesh of meshes) {
        if (mesh === keepMesh) {
            continue;
        }
        mesh.visible = false;
    }
}

function restoreTransparentProbeMeshVisibility(savedVisibility) {
    for (const [mesh, visible] of savedVisibility) {
        mesh.visible = visible;
    }
}

async function measureTransparentProbe() {
    if (!state.modelRoot || !state.renderer || !state.THREE) {
        return { valid: false, reason: "Модель не загружена" };
    }
    const savedCameraPosition = state.camera.position.clone();
    const savedCameraTarget = state.controls.target.clone();
    const savedMode = state.displayMode;
    const savedSelection = state.selectedObject;
    const savedMarkerVisible = state.markerGroup ? state.markerGroup.visible : null;
    selectObject(null);
    clearAllGlow();
    if (state.markerGroup) {
        state.markerGroup.visible = false;
    }
    const started = performance.now();
    try {
        const series = measureTransparentProbeSeries(TRANSPARENT_PROBE_FRAMES, TRANSPARENT_PROBE_STEP_DEG);
        const microSeries = measureTransparentProbeSeries(TRANSPARENT_PROBE_MICRO_FRAMES, TRANSPARENT_PROBE_MICRO_STEP_DEG);
        const meshes = getModelMeshes();
        const savedVisibility = meshes.map(mesh => [mesh, mesh.visible]);
        const parts = collectTransparentProbeParts();
        const partViewIndices = [];
        for (let step = 0; step < TRANSPARENT_PROBE_PART_VIEWS; step += 1) {
            partViewIndices.push((step * TRANSPARENT_PROBE_FRAMES) / TRANSPARENT_PROBE_PART_VIEWS);
        }
        const measurePartPixels = (part, placeView, mode, isolate) => {
            applyDisplayMode(mode);
            if (isolate) {
                setTransparentProbeMeshVisibility(meshes, part.mesh);
            }
            const savedMaterials = assignTransparentProbeIsolatedMaterials(part.mesh);
            placeView();
            const reference = captureFramePixels();
            applyTransparentProbeHighlight([part.mesh]);
            const highlighted = captureFramePixels();
            const visiblePixels = countTransparentProbeChangedPixels(reference, highlighted);
            part.mesh.renderOrder = 9999;
            applyTransparentProbeOnTopOverride(part.mesh.material, true);
            const onTop = captureFramePixels();
            applyTransparentProbeOnTopOverride(part.mesh.material, false);
            part.mesh.renderOrder = savedMaterials.renderOrder;
            const footprintPixels = countTransparentProbeChangedPixels(reference, onTop);
            restoreTransparentProbeHighlight();
            restoreTransparentProbeIsolatedMaterials(savedMaterials);
            if (isolate) {
                restoreTransparentProbeMeshVisibility(savedVisibility);
            }
            return { visiblePixels, footprintPixels };
        };
        for (const part of parts) {
            for (const viewIndex of partViewIndices) {
                const framedPlace = () => placeTransparentProbePartView(
                    part.mesh, viewIndex, TRANSPARENT_PROBE_FRAMES, TRANSPARENT_PROBE_STEP_DEG);
                const framedView = framedPlace();
                const framedFull = measurePartPixels(part, framedPlace, "facets", true);
                const framedOpaque = measurePartPixels(part, framedPlace, "facets", false);
                const framedTransparent = measurePartPixels(part, framedPlace, "transparent", false);
                part.framedViews.push({
                    view: framedView,
                    fullPixels: framedFull.visiblePixels,
                    opaquePixels: framedOpaque.visiblePixels,
                    transparentPixels: framedTransparent.visiblePixels,
                    footprintPixels: framedTransparent.footprintPixels,
                    depthRejected: framedTransparent.footprintPixels > 0 && framedTransparent.visiblePixels === 0,
                    lost: framedOpaque.visiblePixels > 0 && framedTransparent.visiblePixels === 0
                });
                const overviewPlace = () => placeTransparentProbeView(
                    viewIndex, TRANSPARENT_PROBE_FRAMES, TRANSPARENT_PROBE_STEP_DEG);
                const full = measurePartPixels(part, overviewPlace, "facets", true);
                const opaque = measurePartPixels(part, overviewPlace, "facets", false);
                const transparent = measurePartPixels(part, overviewPlace, "transparent", false);
                const occludedPixels = Math.max(0, full.visiblePixels - opaque.visiblePixels);
                const revealedPixels = Math.min(
                    Math.max(0, transparent.visiblePixels - opaque.visiblePixels),
                    occludedPixels);
                part.views.push({
                    viewIndex,
                    fullPixels: full.visiblePixels,
                    opaquePixels: opaque.visiblePixels,
                    transparentPixels: transparent.visiblePixels,
                    footprintPixels: transparent.footprintPixels,
                    occludedPixels,
                    revealedPixels,
                    depthRejected: transparent.footprintPixels > 0 && transparent.visiblePixels === 0,
                    lost: opaque.visiblePixels > 0 && transparent.visiblePixels === 0
                });
            }
        }
        restoreTransparentProbeMeshVisibility(savedVisibility);
        let lostPartViewCount = 0;
        let lostPartCount = 0;
        let lostFramedViewCount = 0;
        let lostFramedPartCount = 0;
        let depthRejectedFramedViewCount = 0;
        let depthRejectedViewCount = 0;
        let subPixelPartCount = 0;
        let framedFullPixelTotal = 0;
        let framedOpaquePixelTotal = 0;
        let framedTransparentPixelTotal = 0;
        let fullPixelTotal = 0;
        let opaquePixelTotal = 0;
        let transparentPixelTotal = 0;
        let occludedPixelTotal = 0;
        let revealedPixelTotal = 0;
        for (const part of parts) {
            let partLost = 0;
            let partFramedLost = 0;
            let partMaxFull = 0;
            let partFramedMaxFull = 0;
            for (const view of part.framedViews) {
                framedFullPixelTotal += view.fullPixels;
                framedOpaquePixelTotal += view.opaquePixels;
                framedTransparentPixelTotal += view.transparentPixels;
                partFramedMaxFull = Math.max(partFramedMaxFull, view.fullPixels);
                if (view.lost) {
                    partFramedLost += 1;
                }
                if (view.depthRejected) {
                    depthRejectedFramedViewCount += 1;
                }
            }
            for (const view of part.views) {
                fullPixelTotal += view.fullPixels;
                opaquePixelTotal += view.opaquePixels;
                transparentPixelTotal += view.transparentPixels;
                occludedPixelTotal += view.occludedPixels;
                revealedPixelTotal += view.revealedPixels;
                partMaxFull = Math.max(partMaxFull, view.fullPixels);
                if (view.lost) {
                    partLost += 1;
                }
                if (view.depthRejected) {
                    depthRejectedViewCount += 1;
                }
            }
            part.lostViewCount = partLost;
            part.lostFramedViewCount = partFramedLost;
            part.maximumOverviewPixels = partMaxFull;
            part.maximumFramedPixels = partFramedMaxFull;
            part.subPixelAtOverviewDistance = partMaxFull <= 5;
            if (partMaxFull <= 5) {
                subPixelPartCount += 1;
            }
            if (partLost > 0) {
                lostPartCount += 1;
                lostPartViewCount += partLost;
            }
            if (partFramedLost > 0) {
                lostFramedPartCount += 1;
                lostFramedViewCount += partFramedLost;
            }
        }
        applyDisplayMode(DISPLAY_MODE_TRANSPARENT);
        const transparentDiagnostics = getDisplayModeDiagnostics("transparent");
        const transparencyScheme = getTransparentProbeSurfaceScheme();
        applyDisplayMode(savedMode);
        const gl = state.renderer.getContext();
        return {
            valid: true,
            durationMs: Math.round(performance.now() - started),
            drawingBufferWidth: gl.drawingBufferWidth,
            drawingBufferHeight: gl.drawingBufferHeight,
            samples: gl.getParameter(gl.SAMPLES),
            isWebGL2: state.renderer.capabilities.isWebGL2 === true,
            antialiasRequested: true,
            viewElevationDeg: TRANSPARENT_PROBE_VIEW_ELEVATION_DEG,
            background: getTransparentProbeBackgroundRgb(),
            highlightColor: colorToHexPadded(TRANSPARENT_PROBE_HIGHLIGHT_COLOR),
            transparencyScheme,
            transparentMaterialDiagnostics: transparentDiagnostics,
            rotation: {
                frameCount: series.views.length,
                stepDeg: TRANSPARENT_PROBE_STEP_DEG,
                views: series.views.map(view => ({
                    view: view.view,
                    totalPixelCount: view.totalPixelCount,
                    silhouettePixels: view.silhouettePixels,
                    coveredPixels: view.coveredPixels,
                    holePixels: view.holePixels,
                    spillPixels: view.spillPixels,
                    coveredPercent: view.coveredPercent,
                    holePercent: view.holePercent
                })),
                pairs: series.pairs,
                stability: summarizeTransparentProbeSeries(series)
            },
            microRotation: {
                frameCount: microSeries.views.length,
                stepDeg: TRANSPARENT_PROBE_MICRO_STEP_DEG,
                views: microSeries.views.map(view => ({
                    view: view.view,
                    totalPixelCount: view.totalPixelCount,
                    silhouettePixels: view.silhouettePixels,
                    coveredPixels: view.coveredPixels,
                    holePixels: view.holePixels,
                    spillPixels: view.spillPixels,
                    coveredPercent: view.coveredPercent,
                    holePercent: view.holePercent
                })),
                pairs: microSeries.pairs,
                stability: summarizeTransparentProbeSeries(microSeries)
            },
            parts: parts.map(part => ({
                index: part.index,
                position: part.position,
                name: part.name,
                triangles: part.triangles,
                lostViewCount: part.lostViewCount,
                lostFramedViewCount: part.lostFramedViewCount,
                maximumOverviewPixels: part.maximumOverviewPixels,
                maximumFramedPixels: part.maximumFramedPixels,
                subPixelAtOverviewDistance: part.subPixelAtOverviewDistance,
                views: part.views,
                framedViews: part.framedViews
            })),
            partSummary: {
                partCount: parts.length,
                viewCount: partViewIndices.length,
                measurementCount: parts.length * partViewIndices.length,
                lostPartCount,
                lostPartViewCount,
                lostFramedPartCount,
                lostFramedViewCount,
                depthRejectedFramedViewCount,
                depthRejectedViewCount,
                changeDelta: TRANSPARENT_PROBE_CHANGE_DELTA,
                subPixelPartCount,
                framedFullPixelTotal,
                framedOpaquePixelTotal,
                framedTransparentPixelTotal,
                framedTransparentToOpaqueRatio: framedOpaquePixelTotal > 0
                    ? Math.round((framedTransparentPixelTotal * 100000) / framedOpaquePixelTotal) / 100000
                    : 0,
                fullPixelTotal,
                opaquePixelTotal,
                transparentPixelTotal,
                occludedPixelTotal,
                revealedPixelTotal,
                transparentToOpaquePixelRatio: opaquePixelTotal > 0
                    ? Math.round((transparentPixelTotal * 100000) / opaquePixelTotal) / 100000
                    : 0,
                internalPixelShare: occludedPixelTotal > 0
                    ? Math.round((revealedPixelTotal * 100000) / occludedPixelTotal) / 1000
                    : 0,
                internalPixelShareOfVisible: transparentPixelTotal > 0
                    ? Math.round((revealedPixelTotal * 100000) / transparentPixelTotal) / 1000
                    : 0
            }
        };
    } finally {
        restoreTransparentProbeHighlight();
        if (state.markerGroup && savedMarkerVisible !== null) {
            state.markerGroup.visible = savedMarkerVisible;
        }
        state.camera.position.copy(savedCameraPosition);
        state.controls.target.copy(savedCameraTarget);
        state.controls.update();
        updateCameraClipping();
        state.camera.updateMatrixWorld(true);
        updateBeamLight();
        applyDisplayMode(savedMode);
        selectObject(savedSelection);
    }
}

function getPartSourceType(object) {
    const part = getPackagePart(object);
    const packageFields = part && part.sourceFields ? part.sourceFields : {};
    const fields = getSourceFields(object);
    const value = fields.type ?? getObjectExtras(object).type ?? packageFields.type;
    return typeof value === "string" && value ? value : null;
}

function hasAnimatedAncestor(object) {
    for (let current = object ? object.parent : null; current; current = current.parent) {
        if (getDirectAnimationIndex(current) !== null ||
            getSourceAnimationIndex(current) !== null ||
            resolveAnimationRootReference(current) !== null) {
            return true;
        }
    }
    return false;
}

function findSelectionTestCandidates() {
    const animatedPart = { object: null };
    const panelWithFirstAnimation = { object: null };
    const fallback = { object: null };
    const hardware = { object: null, animatedAncestor: false, sourceType: null };
    function rememberHardware(object, animatedAncestor, sourceType) {
        const current = hardware.object;
        const currentScore = current === null ? -1 : (hardware.sourceType === "fastener" ? 2 : 0) + (hardware.animatedAncestor ? 1 : 0);
        const candidateScore = (sourceType === "fastener" ? 2 : 0) + (animatedAncestor ? 1 : 0);
        if (current === null || candidateScore > currentScore) {
            hardware.object = object;
            hardware.animatedAncestor = animatedAncestor;
            hardware.sourceType = sourceType;
        }
    }

    state.modelRoot.traverse(object => {
        if (isWireframeOverlay(object) || isWireframeExcludedObject(object)) {
            return;
        }
        const partId = getPartId(object);
        const ownFieldIndex = getOwnAnimationFieldIndex(object);
        const ownDeclaration = getOwnAnimationDeclaration(object);
        const binding = findAnimationBinding(object);
        if (ownDeclaration !== null && binding.valid) {
            if (fallback.object === null) {
                fallback.object = object;
            }
            if (partId !== null && animatedPart.object === null) {
                animatedPart.object = object;
            }
            if (partId !== null && ownFieldIndex === 0 && panelWithFirstAnimation.object === null) {
                panelWithFirstAnimation.object = object;
            }
        }
        if (ownDeclaration === null && ownFieldIndex !== null && ownFieldIndex < 0 &&
            partId !== null && !binding.valid) {
            rememberHardware(object, hasAnimatedAncestor(object), getPartSourceType(object));
        }
    });
    return {
        animated: animatedPart.object || fallback.object,
        panelWithFirstAnimation: panelWithFirstAnimation.object || animatedPart.object || fallback.object,
        hardware: hardware.object,
        hardwareHasAnimatedAncestor: hardware.animatedAncestor,
        hardwareSourceType: hardware.sourceType
    };
}

function findAlternateClipIndex(currentClipIndex) {
    for (let index = 0; index < state.clips.length; index += 1) {
        if (index !== currentClipIndex && getClipIndexForSource(index) !== null) {
            return index;
        }
    }
    return null;
}

function projectWorldToClient(point) {
    const bounds = state.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
        return null;
    }
    const projected = point.clone().project(state.camera);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) {
        return null;
    }
    if (projected.z < -1 || projected.z > 1) {
        return null;
    }
    const clientX = bounds.left + (projected.x * 0.5 + 0.5) * bounds.width;
    const clientY = bounds.top + (-projected.y * 0.5 + 0.5) * bounds.height;
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
        return null;
    }
    return { x: clientX, y: clientY };
}

function getPartSamplePoints(object) {
    const points = [];
    const measured = measurePartGeometry(object);
    if (measured.meshes.length === 0) {
        return points;
    }
    const box = measured.worldBox;
    const center = box.getCenter(new state.THREE.Vector3());
    points.push(center.clone());
    for (const axis of ["x", "y", "z"]) {
        const other = axis === "x" ? ["y", "z"] : axis === "y" ? ["x", "z"] : ["x", "y"];
        for (const side of [box.min[axis], box.max[axis]]) {
            for (const first of [box.min[other[0]], center[other[0]], box.max[other[0]]]) {
                for (const second of [box.min[other[1]], center[other[1]], box.max[other[1]]]) {
                    const point = new state.THREE.Vector3();
                    point[axis] = side;
                    point[other[0]] = first;
                    point[other[1]] = second;
                    points.push(point);
                }
            }
        }
    }
    for (const mesh of measured.meshes.slice(0, 4)) {
        const position = mesh.geometry.attributes ? mesh.geometry.attributes.position : null;
        if (!position) {
            continue;
        }
        const stride = Math.max(1, Math.floor(position.count / 8));
        for (let index = 0; index < position.count; index += stride) {
            points.push(new state.THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld));
        }
        for (let index = 0; index + 2 < position.count; index += 3) {
            points.push(new state.THREE.Vector3()
                .fromBufferAttribute(position, index)
                .add(new state.THREE.Vector3().fromBufferAttribute(position, index + 1))
                .add(new state.THREE.Vector3().fromBufferAttribute(position, index + 2))
                .multiplyScalar(1 / 3)
                .applyMatrix4(mesh.matrixWorld));
        }
    }
    return points;
}

function isHelperSelection(object) {
    if (!object) {
        return false;
    }
    const userData = object.userData && typeof object.userData === "object" ? object.userData : {};
    return isWireframeOverlay(object) || isWireframeExcludedObject(object) ||
        Boolean(userData.markerType) || userData.viewerHelper === true;
}

function findStackClickPointForObject(object) {
    const point = findLayeredClickPointForObject(object, 1);
    return point ? { x: point.x, y: point.y, index: point.index, count: point.count } : null;
}

function findLayeredClickPointForObject(object, minimumIndex) {
    if (!object || !state.renderer || !state.modelRoot) {
        return null;
    }
    const expectedKey = getSelectionKey(object, null);
    const bounds = state.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
        return null;
    }
    const fractions = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75];
    let best = null;
    for (const vertical of fractions) {
        for (const horizontal of fractions) {
            const client = {
                x: bounds.left + bounds.width * horizontal,
                y: bounds.top + bounds.height * vertical
            };
            const stack = buildPickStack(client.x, client.y);
            if (!stack || stack.objects.length < 2) {
                continue;
            }
            const index = stack.objects.findIndex(entry =>
                entry === object ||
                isDescendantObject(object, entry) ||
                getSelectionKey(entry, null) === expectedKey);
            if (index < minimumIndex) {
                continue;
            }
            if (!best || stack.objects.length > best.count) {
                best = { x: client.x, y: client.y, index, count: stack.objects.length };
            }
            if (best.count >= 4) {
                return best;
            }
        }
    }
    return best;
}

async function findClickablePointForObject(object) {
    const direct = await findViewportClickPointForObject(object);
    if (direct) {
        return { x: direct.x, y: direct.y, mode: "direct", index: 0, count: 1, maxClicks: 2 };
    }
    const throughStack = findStackClickPointForObject(object);
    if (throughStack) {
        return {
            x: throughStack.x,
            y: throughStack.y,
            mode: "pick-stack",
            index: throughStack.index,
            count: throughStack.count,
            maxClicks: throughStack.count
        };
    }
    return null;
}

async function findVerifiedClickPointForObject(object) {
    const direct = await findClickablePointForObject(object);
    if (!direct) {
        return null;
    }
    resetPickStack();
    const picked = pickViewportObject(toViewportClickEvent(direct));
    if (picked && getSelectionKey(picked, null) === getSelectionKey(object, null)) {
        return direct;
    }
    const throughStack = findStackClickPointForObject(object);
    if (!throughStack) {
        return null;
    }
    return {
        x: throughStack.x,
        y: throughStack.y,
        mode: "pick-stack",
        index: throughStack.index,
        count: throughStack.count,
        maxClicks: throughStack.count
    };
}

async function selectObjectByViewportClicks(object, point, maxClicks) {
    const expectedKey = getSelectionKey(object, null);
    for (let attempt = 0; attempt < maxClicks; attempt += 1) {
        state.lastViewportClick = { x: point.x, y: point.y, time: 0 };
        dispatchViewportClick(point.x, point.y);
        await waitForRenderFrame();
        if (getSelectionKey(state.selectedObject, null) === expectedKey) {
            return attempt + 1;
        }
    }
    return -1;
}

async function testViewportPick(object) {
    const expectedKey = getSelectionKey(object, null);
    const points = getPartSamplePoints(object);
    let tested = 0;
    let hits = 0;
    let firstOther = null;
    let selected = null;
    let clicks = 0;
    let stackIndex = -1;
    let stackCount = 0;
    for (const point of points) {
        const client = projectWorldToClient(point);
        if (!client) {
            continue;
        }
        tested += 1;
        const picked = pickViewportObject({ clientX: client.x, clientY: client.y });
        if (picked) {
            hits += 1;
        }
        if (picked && getSelectionKey(picked, null) !== expectedKey && !firstOther) {
            firstOther = getObjectName(picked);
        }
        const stack = buildPickStack(client.x, client.y);
        if (!stack || stack.objects.length === 0) {
            continue;
        }
        const index = stack.objects.findIndex(entry => getSelectionKey(entry, null) === expectedKey);
        if (index < 0) {
            continue;
        }
        const used = await selectObjectByViewportClicks(object, client, stack.objects.length);
        if (used > 0) {
            selected = state.selectedObject;
            clicks = used;
            stackIndex = index;
            stackCount = stack.objects.length;
            break;
        }
    }
    return {
        sampled: points.length,
        tested,
        hits,
        selected,
        expectedKey,
        firstOther,
        clicks,
        stackIndex,
        stackCount,
        success: selected !== null
    };
}

function distanceToBox(point, box) {
    const dx = Math.max(box.min.x - point.x, 0, point.x - box.max.x);
    const dy = Math.max(box.min.y - point.y, 0, point.y - box.max.y);
    const dz = Math.max(box.min.z - point.z, 0, point.z - box.max.z);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getDeclaredPartBox(object) {
    const fields = getSourceFields(object);
    const minimum = toVector3(fields.gmin);
    const maximum = toVector3(fields.gmax);
    if (!minimum || !maximum) {
        return null;
    }
    const box = new state.THREE.Box3();
    const corners = [
        new state.THREE.Vector3(minimum.x * 0.001, minimum.y * 0.001, minimum.z * 0.001),
        new state.THREE.Vector3(maximum.x * 0.001, maximum.y * 0.001, maximum.z * 0.001)
    ];
    object.updateWorldMatrix(true, false);
    for (const corner of corners) {
        box.expandByPoint(corner.applyMatrix4(object.matrixWorld));
    }
    return box.isEmpty() ? null : box;
}

function testMarkerClicks() {
    const result = {
        tested: 0,
        samplesTested: 0,
        skippedWithoutGeometry: 0,
        reachableThroughMarker: 0,
        reachableThroughMesh: 0,
        reachableThroughDeclaredBounds: 0,
        samePart: 0,
        otherPart: 0,
        helperHits: 0,
        missCount: 0,
        samples: [],
        success: false
    };
    state.scene.updateMatrixWorld(true);
    for (const marker of state.markers) {
        if (result.tested >= 120) {
            break;
        }
        const markerPartId = marker.userData ? marker.userData.markerPartId : null;
        if (!markerPartId) {
            continue;
        }
        const parentObject = getPartObject(markerPartId);
        const parentMeshes = parentObject ? collectPartGeometry(parentObject) : [];
        const markerPosition = marker.getWorldPosition(new state.THREE.Vector3());
        const declaredBox = parentObject ? getDeclaredPartBox(parentObject) : null;
        const withinDeclaredBounds = declaredBox ? distanceToBox(markerPosition, declaredBox) <= 1.0e-6 : false;
        if (parentMeshes.length === 0) {
            result.skippedWithoutGeometry += 1;
            if (withinDeclaredBounds) {
                result.reachableThroughDeclaredBounds += 1;
                result.reachableThroughMarker += 1;
            }
            if (result.samples.length < 6) {
                result.samples.push({
                    markerId: marker.name,
                    markerPartId,
                    parentIsMarkerParent: parentObject === marker.parent,
                    parentMeshCount: 0,
                    parentBoxDistance: null,
                    parentMeshReachable: false,
                    withinParentDeclaredBounds: withinDeclaredBounds,
                    picked: null,
                    pickedPartId: null
                });
            }
            continue;
        }
        const client = projectWorldToClient(markerPosition);
        if (!client) {
            continue;
        }
        result.tested += 1;
        result.samplesTested += 1;
        const parentBounds = parentObject ? measurePartGeometry(parentObject).worldBox : null;
        const parentBoxDistance = parentBounds && !parentBounds.isEmpty()
            ? Math.max(0, distanceToBox(markerPosition, parentBounds))
            : null;
        let meshReachable = false;
        if (setPointerFromClient(client.x, client.y)) {
            state.raycaster.setFromCamera(state.pointer, state.camera);
            meshReachable = state.raycaster.intersectObjects(parentMeshes, false).length > 0;
        }
        if (meshReachable) {
            result.reachableThroughMesh += 1;
            result.reachableThroughMarker += 1;
        } else if (withinDeclaredBounds) {
            result.reachableThroughDeclaredBounds += 1;
            result.reachableThroughMarker += 1;
        }
        const picked = pickViewportObject({ clientX: client.x, clientY: client.y });
        if (!picked) {
            result.missCount += 1;
        } else if (isHelperSelection(picked)) {
            result.helperHits += 1;
        } else if (getPartId(picked) === markerPartId) {
            result.samePart += 1;
        } else {
            result.otherPart += 1;
        }
        if (result.samples.length < 6) {
            result.samples.push({
                markerId: marker.name,
                markerPartId,
                parentIsMarkerParent: parentObject === marker.parent,
                parentMeshCount: parentMeshes.length,
                parentBoxDistance,
                parentMeshReachable: meshReachable,
                withinParentDeclaredBounds: withinDeclaredBounds,
                picked: picked ? getObjectName(picked) : null,
                pickedPartId: picked ? getPartId(picked) : null
            });
        }
    }
    result.success = result.helperHits === 0 &&
        (result.reachableThroughMarker > 0 || result.tested === 0);
    return result;
}

function captureGlowSnapshot(object) {
    const meshes = collectPartGeometry(object);
    const materials = [];
    for (const mesh of meshes) {
        for (const material of getMeshMaterials(mesh.material)) {
            materials.push({
                uuid: material.uuid,
                type: material.type,
                emissive: material.emissive && typeof material.emissive.getHex === "function"
                    ? material.emissive.getHex(state.THREE.SRGBColorSpace)
                    : null,
                intensity: Number.isFinite(material.emissiveIntensity) ? material.emissiveIntensity : null
            });
        }
    }
    return {
        meshCount: meshes.length,
        materialCount: materials.length,
        materials,
        materialRefs: meshes.map(mesh => `${mesh.uuid}:${getMeshMaterials(mesh.material).map(material => material.uuid).join("|")}`).join(";")
    };
}

function snapshotsMatch(first, second) {
    if (first.materialCount !== second.materialCount || first.materialRefs !== second.materialRefs) {
        return false;
    }
    return first.materials.every((item, index) => {
        const other = second.materials[index];
        return Boolean(other) && item.uuid === other.uuid && item.emissive === other.emissive && item.intensity === other.intensity;
    });
}

function snapshotsMatchEmissiveValues(first, second) {
    if (first.materialCount !== second.materialCount) {
        return false;
    }
    return first.materials.every((item, index) => {
        const other = second.materials[index];
        return Boolean(other) && item.emissive === other.emissive && item.intensity === other.intensity;
    });
}

function testGlowToggle(object, otherObject) {
    selectObject(object);
    const before = captureGlowSnapshot(object);
    const otherBefore = otherObject ? captureGlowSnapshot(otherObject) : null;
    setGlowParameters({ kelvin: GLOW_KELVIN_DEFAULT, intensity: GLOW_INTENSITY_DEFAULT, saturation: GLOW_SATURATION_DEFAULT, size: GLOW_SIZE_DEFAULT });
    setGlowEnabled(object, true);
    const enabled = captureGlowSnapshot(object);
    const otherEnabled = otherObject ? captureGlowSnapshot(otherObject) : null;
    const cloneApplied = enabled.materialRefs !== before.materialRefs;
    const changedMaterials = enabled.materials.filter((item, index) => {
        const original = before.materials[index];
        return !original || original.uuid !== item.uuid || original.emissive !== item.emissive || original.intensity !== item.intensity;
    }).length;
    const isolated = otherObject && otherBefore ? snapshotsMatch(otherBefore, otherEnabled) : true;
    const emissiveHex = enabled.materials.length > 0 ? enabled.materials[0].emissive : null;
    const profile = getGlowProfile(object, false);
    const colorMatchesKelvin = profile !== null && emissiveHex === getGlowColorHex(profile.kelvin, profile.saturation);
    let persistsAfterDeselect = false;
    let otherOwnState = true;
    let targetRestoresProfile = false;
    if (otherObject) {
        selectObject(otherObject);
        persistsAfterDeselect = snapshotsMatch(enabled, captureGlowSnapshot(object));
        const otherProfile = getGlowProfile(otherObject, true);
        otherOwnState = otherProfile.enabled === false;
        selectObject(object);
        const restoredProfile = getGlowProfile(object, false);
        targetRestoresProfile = Boolean(restoredProfile) && restoredProfile.enabled === true &&
            Math.round(restoredProfile.kelvin) === GLOW_KELVIN_DEFAULT &&
            Math.abs(restoredProfile.intensity - GLOW_INTENSITY_DEFAULT) <= 0.01 &&
            Math.abs(restoredProfile.saturation - GLOW_SATURATION_DEFAULT) <= 0.01;
    }
    setGlowEnabled(object, false);
    const restored = captureGlowSnapshot(object);
    const glowMaterialUuids = new Set(enabled.materials.map(item => item.uuid));
    const restoredUsesGlowMaterial = restored.materials.some(item => glowMaterialUuids.has(item.uuid));
    const restoredEmissive = snapshotsMatchEmissiveValues(before, restored);
    const restoredOriginals = restoredEmissive && !restoredUsesGlowMaterial;
    const noGlowMaterials = !Array.from(state.glowMaterials.keys()).some(mesh => isDescendantObject(mesh, object));
    deleteGlowProfile(object);
    return {
        cloneApplied,
        changedMaterials,
        isolated,
        emissiveHex,
        intensity: enabled.materials.length > 0 ? enabled.materials[0].intensity : null,
        colorMatchesKelvin,
        otherOwnState,
        restoredEmissive,
        restoredUsesGlowMaterial,
        restoredOriginals,
        noGlowMaterials,
        persistsAfterDeselect,
        targetRestoresProfile,
        success: cloneApplied && changedMaterials > 0 && isolated && restoredOriginals && noGlowMaterials &&
            colorMatchesKelvin && (persistsAfterDeselect && otherOwnState && targetRestoresProfile || !otherObject)
    };
}

function findDistinctPartObject(target) {
    for (const entry of state.partObjects.values()) {
        const object = entry ? entry.object : null;
        if (!object || object === target) {
            continue;
        }
        if (collectPartGeometry(object).length === 0) {
            continue;
        }
        return object;
    }
    return null;
}

function findAnimationTestPair() {
    const byClip = new Map();
    if (!state.modelRoot) {
        return null;
    }
    state.modelRoot.traverse(object => {
        if (isWireframeOverlay(object) || isWireframeExcludedObject(object)) {
            return;
        }
        const binding = findAnimationBinding(object);
        if (!binding.valid || byClip.has(binding.clipIndex)) {
            return;
        }
        if (getClipOpenPoseTime(binding.clipIndex) <= 0) {
            return;
        }
        byClip.set(binding.clipIndex, object);
    });
    const clipIndexes = Array.from(byClip.keys()).sort((first, second) => first - second);
    if (clipIndexes.length < 2) {
        return null;
    }
    return {
        clipA: clipIndexes[0],
        objectA: byClip.get(clipIndexes[0]),
        clipB: clipIndexes[1],
        objectB: byClip.get(clipIndexes[1])
    };
}

function setAnimationSecondsForTest(value) {
    const seconds = clampAnimationSeconds(value, ANIMATION_SECONDS_MIN);
    state.openSeconds = seconds;
    state.closeSeconds = seconds;
    updateAnimationTimingSettings();
    return seconds;
}

function frameOpenAnimatedParts() {
    const THREE = state.THREE;
    if (!state.modelRoot || !THREE || !state.camera || !state.controls) {
        return false;
    }
    state.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let found = false;
    for (const entry of state.partObjects.values()) {
        const object = entry ? entry.object : null;
        if (!object) {
            continue;
        }
        const binding = findAnimationBinding(object);
        if (!binding.valid || !state.openClipIndices.has(binding.clipIndex)) {
            continue;
        }
        for (const mesh of collectPartGeometry(object)) {
            box.expandByObject(mesh);
            found = true;
        }
    }
    if (!found || box.isEmpty()) {
        return false;
    }
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.05);
    const verticalFov = THREE.MathUtils.degToRad(state.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * state.camera.aspect);
    const distance = Math.max(
        radius / Math.sin(verticalFov * 0.5),
        radius / Math.sin(horizontalFov * 0.5)) * 1.95;
    const direction = new THREE.Vector3(1, 0.55, 1).normalize();
    state.camera.position.copy(center).add(direction.multiplyScalar(distance));
    state.controls.target.copy(center);
    state.controls.minDistance = Math.min(state.controls.minDistance, radius * 0.5);
    state.controls.update();
    updateCameraClipping();
    return true;
}

function getSelectionOutlineViewPoints(object) {
    const THREE = state.THREE;
    if (!object || !state.modelRoot || !THREE) {
        return null;
    }
    state.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let found = false;
    for (const mesh of collectPartGeometry(object)) {
        const bounds = getGeometryBounds(mesh.geometry);
        if (bounds) {
            box.union(bounds.clone().applyMatrix4(mesh.matrixWorld));
            found = true;
        }
    }
    if (!found || box.isEmpty()) {
        return null;
    }
    const center = box.getCenter(new THREE.Vector3());
    const modelBox = new THREE.Box3().setFromObject(state.modelRoot);
    const outward = modelBox.isEmpty()
        ? new THREE.Vector3(1, 0.55, 1)
        : new THREE.Vector3().subVectors(center, modelBox.getCenter(new THREE.Vector3()));
    if (outward.lengthSq() < 1e-10) {
        outward.set(1, 0.55, 1);
    }
    outward.normalize();
    const scale = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.05) /
        Math.sin(THREE.MathUtils.degToRad(state.camera.fov) * 0.5);
    const plans = [];
    for (const multiplier of [1.5, 2.4, 4, 6.5]) {
        plans.push({ direction: outward, distance: scale * multiplier });
        plans.push({ direction: new THREE.Vector3(1, 0.55, 1), distance: scale * multiplier });
        plans.push({ direction: new THREE.Vector3(-1, 0.5, 1), distance: scale * multiplier });
        plans.push({ direction: new THREE.Vector3(1, 0.4, -1), distance: scale * multiplier });
        plans.push({ direction: new THREE.Vector3(0.15, 1, 0.35), distance: scale * multiplier });
    }
    return { box, center, plans };
}

function placeSelectionOutlineCamera(viewPoint) {
    if (!viewPoint) {
        return false;
    }
    state.camera.position.copy(viewPoint.center).addScaledVector(viewPoint.plans.direction, viewPoint.plans.distance);
    state.controls.target.copy(viewPoint.center);
    state.controls.minDistance = Math.min(state.controls.minDistance, viewPoint.box.getBoundingSphere(new state.THREE.Sphere()).radius * 0.5);
    state.controls.update();
    updateCameraClipping();
    state.camera.updateMatrixWorld(true);
    return true;
}

function findSelectionOutlineTarget() {
    const candidates = findSelectionTestCandidates();
    const preferred = candidates.panelWithFirstAnimation || candidates.animated || candidates.hardware;
    if (preferred && collectPartGeometry(preferred).length > 0) {
        return preferred;
    }
    let best = null;
    let bestDiagonal = 0;
    for (const entry of state.partObjects.values()) {
        const object = entry ? entry.object : null;
        if (!object) {
            continue;
        }
        const measured = measurePartGeometry(object);
        if (measured.meshes.length === 0 || measured.worldBox.isEmpty()) {
            continue;
        }
        const size = measured.worldBox.getSize(new state.THREE.Vector3());
        const diagonal = size.length();
        if (diagonal > bestDiagonal) {
            bestDiagonal = diagonal;
            best = object;
        }
    }
    return best;
}

function toViewportClickEvent(client) {
    return client ? { clientX: client.x, clientY: client.y } : null;
}

function probeViewportClickPoints(object) {
    const expectedKey = getSelectionKey(object, null);
    const points = getPartSamplePoints(object);
    const probe = {
        client: null,
        sampled: points.length,
        projected: 0,
        hits: 0,
        matched: 0,
        samples: []
    };
    for (const point of points) {
        const client = projectWorldToClient(point);
        if (!client) {
            continue;
        }
        probe.projected += 1;
        const picked = pickViewportObject(toViewportClickEvent(client));
        if (picked) {
            probe.hits += 1;
        }
        if (picked && getSelectionKey(picked, null) === expectedKey) {
            probe.matched += 1;
            probe.client = client;
            return probe;
        }
        if (probe.samples.length < 6) {
            probe.samples.push(picked ? getObjectName(picked) : "нет объекта");
        }
    }
    return probe;
}

function findEmptyViewportPoint() {
    const bounds = state.renderer.domElement.getBoundingClientRect();
    const fractions = [0.02, 0.04, 0.96, 0.98, 0.5, 0.08, 0.92];
    for (const vertical of fractions) {
        for (const horizontal of fractions) {
            const client = {
                x: bounds.left + bounds.width * horizontal,
                y: bounds.top + bounds.height * vertical
            };
            if (pickViewportObject(toViewportClickEvent(client)) === null) {
                return client;
            }
        }
    }
    return null;
}

function dispatchViewportClick(clientX, clientY) {
    const canvas = state.renderer.domElement;
    if (!canvas) {
        return false;
    }
    const shared = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX,
        clientY,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        view: window
    };
    const controlsEnabled = state.controls ? state.controls.enabled : false;
    if (state.controls) {
        state.controls.enabled = false;
    }
    try {
        canvas.dispatchEvent(new PointerEvent("pointerdown", shared));
        canvas.dispatchEvent(new PointerEvent("pointerup", { ...shared, buttons: 0 }));
    } finally {
        if (state.controls) {
            state.controls.enabled = controlsEnabled;
        }
    }
    return true;
}

function dispatchViewportDoubleClick(clientX, clientY) {
    const canvas = state.renderer.domElement;
    if (!canvas) {
        return false;
    }
    const shared = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX,
        clientY,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        view: window
    };
    const controlsEnabled = state.controls ? state.controls.enabled : false;
    if (state.controls) {
        state.controls.enabled = false;
    }
    try {
        for (let index = 0; index < 2; index += 1) {
            canvas.dispatchEvent(new PointerEvent("pointerdown", shared));
            canvas.dispatchEvent(new PointerEvent("pointerup", { ...shared, buttons: 0 }));
        }
        canvas.dispatchEvent(new MouseEvent("dblclick", { ...shared, detail: 2 }));
    } finally {
        if (state.controls) {
            state.controls.enabled = controlsEnabled;
        }
    }
    return true;
}

function dispatchEscapeKey(target) {
    const event = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
        composed: true
    });
    if (target && typeof target.dispatchEvent === "function") {
        target.dispatchEvent(event);
    } else {
        window.dispatchEvent(event);
    }
    return event;
}

function dispatchZoomKey(key, code, target) {
    const event = new KeyboardEvent("keydown", {
        key,
        code: code || "",
        keyCode: 0,
        which: 0,
        bubbles: true,
        cancelable: true,
        composed: true
    });
    if (target && typeof target.dispatchEvent === "function") {
        target.dispatchEvent(event);
    } else {
        window.dispatchEvent(event);
    }
    return event;
}

function measureSelectionOutlinePixels() {
    const gl = state.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    if (!width || !height) {
        return { pixelCount: 0, colorPixelCount: 0, width, height, frameTimeMs: 0, region: null };
    }
    const total = width * height;
    const withOutline = new Uint8Array(total * 4);
    const withoutOutline = new Uint8Array(total * 4);
    const colorRed = (SELECTION_OUTLINE_COLOR >> 16) & 255;
    const colorGreen = (SELECTION_OUTLINE_COLOR >> 8) & 255;
    const colorBlue = SELECTION_OUTLINE_COLOR & 255;
    const started = performance.now();
    state.scene.updateMatrixWorld(true);
    state.camera.updateMatrixWorld(true);
    state.renderer.render(state.scene, state.camera);
    gl.finish();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, withOutline);
    setSelectionOutlineVisibility(false);
    state.renderer.render(state.scene, state.camera);
    gl.finish();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, withoutOutline);
    setSelectionOutlineVisibility(true);
    state.renderer.render(state.scene, state.camera);
    gl.finish();
    const frameTimeMs = performance.now() - started;
    let pixelCount = 0;
    let colorPixelCount = 0;
    let minimumX = width;
    let minimumY = height;
    let maximumX = -1;
    let maximumY = -1;
    for (let offset = 0; offset < withOutline.length; offset += 4) {
        const delta = Math.max(
            Math.abs(withOutline[offset] - withoutOutline[offset]),
            Math.abs(withOutline[offset + 1] - withoutOutline[offset + 1]),
            Math.abs(withOutline[offset + 2] - withoutOutline[offset + 2]));
        if (delta > SELECTION_OUTLINE_PIXEL_CHANNEL_DELTA) {
            pixelCount += 1;
            const index = offset / 4;
            const x = index % width;
            const y = Math.floor(index / width);
            if (x < minimumX) {
                minimumX = x;
            }
            if (x > maximumX) {
                maximumX = x;
            }
            if (y < minimumY) {
                minimumY = y;
            }
            if (y > maximumY) {
                maximumY = y;
            }
        }
        if (Math.abs(withOutline[offset] - colorRed) <= 40 &&
            Math.abs(withOutline[offset + 1] - colorGreen) <= 40 &&
            Math.abs(withOutline[offset + 2] - colorBlue) <= 40) {
            colorPixelCount += 1;
        }
    }
    return {
        pixelCount,
        colorPixelCount,
        width,
        height,
        totalPixelCount: total,
        frameTimeMs,
        region: maximumX < 0 ? null : {
            left: minimumX,
            top: height - 1 - maximumY,
            right: maximumX,
            bottom: height - 1 - minimumY,
            width: maximumX - minimumX + 1,
            height: maximumY - minimumY + 1
        }
    };
}

function measureModelDarkPixels(frame = captureFramePixels()) {
    const backgroundHex = state.scene.background && state.scene.background.isColor
        ? state.scene.background.getHex(state.THREE.SRGBColorSpace)
        : DEFAULT_BACKGROUND_COLOR;
    const background = {
        r: (backgroundHex >> 16) & 255,
        g: (backgroundHex >> 8) & 255,
        b: backgroundHex & 255
    };
    let modelPixelCount = 0;
    let darkPixelCount = 0;
    for (let offset = 0; offset < frame.pixels.length; offset += 4) {
        const red = frame.pixels[offset];
        const green = frame.pixels[offset + 1];
        const blue = frame.pixels[offset + 2];
        if (Math.abs(red - background.r) <= 8 ||
            Math.abs(green - background.g) <= 8 ||
            Math.abs(blue - background.b) <= 8) {
            continue;
        }
        modelPixelCount += 1;
        if (red * 0.2126 + green * 0.7152 + blue * 0.0722 < BEAM_DARK_LUMINANCE_LIMIT) {
            darkPixelCount += 1;
        }
    }
    const totalPixelCount = Math.max(frame.total, 1);
    const darkPixelPercent = darkPixelCount * 100 / totalPixelCount;
    return {
        width: frame.width,
        height: frame.height,
        totalPixelCount: frame.total,
        modelPixelCount,
        darkPixelCount,
        darkPixelPercent: Math.round(darkPixelPercent * 10000) / 10000,
        darkLuminanceLimit: BEAM_DARK_LUMINANCE_LIMIT,
        darkPixelPercentValid: modelPixelCount > 0 && darkPixelPercent <= BEAM_DARK_PIXEL_PERCENT_MAX
    };
}

function captureSelectionStateForLightProbe() {
    const saved = {
        selectedObject: state.selectedObject,
        glow: []
    };
    for (const [object, profile] of state.glowProfiles) {
        if (profile && profile.enabled) {
            saved.glow.push({
                object,
                kelvin: profile.kelvin,
                intensity: profile.intensity,
                saturation: profile.saturation,
                size: profile.size
            });
        }
    }
    return saved;
}

function restoreSelectionStateAfterLightProbe(saved) {
    clearAllGlow();
    for (const item of saved.glow) {
        const profile = getGlowProfile(item.object, true);
        profile.kelvin = item.kelvin;
        profile.intensity = item.intensity;
        profile.saturation = item.saturation;
        profile.size = item.size;
        profile.enabled = true;
        applyGlowToObject(item.object);
    }
    selectObject(saved.selectedObject);
}

async function measureObserverLightViews() {
    const savedCameraPosition = state.camera.position.clone();
    const savedCameraTarget = state.controls.target.clone();
    const savedSelection = captureSelectionStateForLightProbe();
    selectObject(null);
    clearAllGlow();
    const views = [];
    for (const plan of BEAM_OBSERVER_VIEW_PLANS) {
        placeBeamObserverView(plan.id);
        await waitForRenderFrame();
        const observer = getBeamObserverDiagnostics();
        setBeamEnabled(true);
        await waitForRenderFrame();
        const frameLightOn = captureFramePixels();
        const darkLightOn = measureModelDarkPixels(frameLightOn);
        setBeamEnabled(false);
        await waitForRenderFrame();
        const frameLightOff = captureFramePixels();
        const darkLightOff = measureModelDarkPixels(frameLightOff);
        const lightOffComparison = compareFramePixels(frameLightOff, frameLightOn);
        views.push({
            id: plan.id,
            label: plan.label,
            cameraPosition: vectorData(state.camera.position),
            lightPosition: observer ? vectorData(observer.position) : null,
            lightPositionDeviation: observer ? observer.positionDeviation : null,
            lightTargetDeviation: observer ? observer.targetDeviation : null,
            observerAngleDeg: observer ? observer.angleDeg : null,
            observerAngleValid: Boolean(observer) && observer.angleDeg !== null && observer.angleDeg <= BEAM_OBSERVER_ANGLE_MAX,
            gizmoObjectCount: countLightManipulatorObjects(),
            modelPixelCount: darkLightOn.modelPixelCount,
            darkPixelCount: darkLightOn.darkPixelCount,
            darkPixelPercent: darkLightOn.darkPixelPercent,
            darkPixelPercentValid: darkLightOn.darkPixelPercentValid,
            darkPixelPercentWithoutLight: darkLightOff.darkPixelPercent,
            darkPixelPercentWithLightBetter: darkLightOn.darkPixelPercent <= darkLightOff.darkPixelPercent,
            lightChangedPixelCount: lightOffComparison.changedPixelCount,
            lightChangedPixelPercent: Math.round(lightOffComparison.changedPixelPercent * 10000) / 10000,
            lightChangesImage: lightOffComparison.changedPixelCount > 0
        });
    }
    setBeamEnabled(true);
    state.camera.position.copy(savedCameraPosition);
    state.controls.target.copy(savedCameraTarget);
    state.controls.update();
    updateCameraClipping();
    updateBeamLight();
    restoreSelectionStateAfterLightProbe(savedSelection);
    await waitForRenderFrame();
    return views;
}

async function testSelectionOutlineHighlight() {
    const result = {
        success: false,
        selectedName: null,
        selectedKey: null,
        clickSource: "renderer.domElement",
        clickX: null,
        clickY: null,
        viewPlans: 0,
        viewPlanIndex: -1,
        sampleCount: 0,
        projectedCount: 0,
        pickHitCount: 0,
        pickSamples: [],
        cameraPosition: null,
        cameraTarget: null,
        cameraDistance: 0,
        targetCenter: null,
        modelRadius: 0,
        clickInsideCanvas: false,
        clickOutsideTree: false,
        treeClickUsed: false,
        selectionFromViewport: false,
        singleClickOnlySelection: false,
        outlineColor: colorToHexPadded(SELECTION_OUTLINE_COLOR),
        outlineCount: 0,
        outlineMeshCount: 0,
        outlineVisibleCount: 0,
        outlineVisible: false,
        outlineEmissiveMaterialCount: 0,
        outlineBuildMs: 0,
        outlineCachedGeometryCount: 0,
        emptyPointFound: false,
        emptyX: null,
        emptyY: null,
        deselectedOutlineCount: null,
        deselectedOutlineVisibleCount: null,
        deselectedOutlineEmissiveMaterialCount: null,
        modes: {},
        strayMarkers: 0,
        markerPollution: 0,
        raycastStubbed: 0,
        wireframeOverlayValid: false,
        wireframeLineSegmentCount: 0,
        wireframeDiscoveredLineSegmentCount: 0,
        selectionHelperCount: null,
        boxHelperCount: 0,
        message: "Проверка подсветки выделения не выполнена."
    };
    if (!state.modelRoot || !state.renderer) {
        result.message = "Модель не загружена.";
        return result;
    }
    const target = findSelectionOutlineTarget();
    if (!target) {
        result.message = "В модели не найдены детали для проверки подсветки выделения.";
        return result;
    }
    const expectedKey = getSelectionKey(target, null);
    const viewPoint = getSelectionOutlineViewPoints(target);
    let clickPoint = null;
    let lastProbe = null;
    let planIndex = -1;
    if (viewPoint) {
        for (const [index, plan] of viewPoint.plans.entries()) {
            placeSelectionOutlineCamera({ box: viewPoint.box, center: viewPoint.center, plans: plan });
            await waitForRenderFrame();
            lastProbe = probeViewportClickPoints(target);
            if (lastProbe.client) {
                clickPoint = lastProbe.client;
                planIndex = index;
                break;
            }
        }
    }
    result.viewPlans = viewPoint ? viewPoint.plans.length : 0;
    result.viewPlanIndex = planIndex;
    result.sampleCount = lastProbe ? lastProbe.sampled : 0;
    result.projectedCount = lastProbe ? lastProbe.projected : 0;
    result.pickHitCount = lastProbe ? lastProbe.hits : 0;
    result.pickSamples = lastProbe ? lastProbe.samples : [];
    result.cameraPosition = vectorData(state.camera.position);
    result.cameraTarget = vectorData(state.controls.target);
    result.cameraDistance = getCameraDistance();
    result.targetCenter = viewPoint ? vectorData(viewPoint.center) : null;
    result.modelRadius = state.modelRadius;
    if (!clickPoint) {
        result.message = "Не удалось найти видимую точку детали для одиночного щелчка в окне просмотра.";
        return result;
    }
    const canvasBounds = state.renderer.domElement.getBoundingClientRect();
    const treeBounds = elements.objectTree ? elements.objectTree.getBoundingClientRect() : null;
    result.clickX = Math.round(clickPoint.x * 100) / 100;
    result.clickY = Math.round(clickPoint.y * 100) / 100;
    result.clickInsideCanvas = clickPoint.x >= canvasBounds.left && clickPoint.x <= canvasBounds.right &&
        clickPoint.y >= canvasBounds.top && clickPoint.y <= canvasBounds.bottom;
    result.clickOutsideTree = Boolean(treeBounds) && !(clickPoint.x >= treeBounds.left && clickPoint.x <= treeBounds.right &&
        clickPoint.y >= treeBounds.top && clickPoint.y <= treeBounds.bottom);
    const directionBefore = state.animationDirection;
    const doorOpenBefore = state.doorOpen;
    selectObject(null);
    dispatchViewportClick(clickPoint.x, clickPoint.y);
    await waitForRenderFrame();
    const outlineAfterClick = getSelectionOutlineDiagnostics();
    result.selectionFromViewport = getSelectionKey(state.selectedObject, null) === expectedKey;
    result.selectedKey = expectedKey;
    result.selectedName = state.selectedObject ? getObjectName(state.selectedObject) : null;
    result.outlineCount = outlineAfterClick.count;
    result.outlineMeshCount = state.selectionOutlines.size;
    result.outlineVisibleCount = outlineAfterClick.visibleCount;
    result.outlineVisible = outlineAfterClick.visibleCount > 0;
    result.outlineEmissiveMaterialCount = outlineAfterClick.emissiveMaterialCount;
    result.outlineBuildMs = Math.round(outlineAfterClick.buildMs * 1000) / 1000;
    result.outlineCachedGeometryCount = outlineAfterClick.cachedGeometryCount;
    result.raycastStubbed = outlineAfterClick.raycastStubbedCount;
    result.markerPollution = outlineAfterClick.markerPollution;
    result.singleClickOnlySelection = state.animationDirection === directionBefore && state.doorOpen === doorOpenBefore;
    for (const mode of DISPLAY_MODE_IDS) {
        applyDisplayMode(mode);
        await waitForRenderFrame();
        const measured = measureSelectionOutlinePixels();
        const modeOutline = getSelectionOutlineDiagnostics();
        result.modes[mode] = {
            mode,
            outlineCount: modeOutline.count,
            outlineVisibleCount: modeOutline.visibleCount,
            outlineVisible: modeOutline.visibleCount > 0,
            outlineEmissiveMaterialCount: modeOutline.emissiveMaterialCount,
            pixelCount: measured.pixelCount,
            colorPixelCount: measured.colorPixelCount,
            width: measured.width,
            height: measured.height,
            frameTimeMs: Math.round(measured.frameTimeMs * 1000) / 1000,
            region: measured.region,
            displayModeValid: getDisplayModeDiagnostics(mode).valid,
            wireframeOverlayValid: !getDisplayMode(mode).edges || getWireframeOverlayDiagnostics().valid
        };
    }
    applyDisplayMode(DISPLAY_MODE_DEFAULT);
    const wireframeDiagnostics = getWireframeOverlayDiagnostics();
    const markerDiagnostics = getMarkerDiagnostics();
    result.wireframeOverlayValid = wireframeDiagnostics.valid;
    result.wireframeLineSegmentCount = wireframeDiagnostics.lineSegmentCount;
    result.wireframeDiscoveredLineSegmentCount = wireframeDiagnostics.discoveredLineSegmentCount;
    result.strayMarkers = markerDiagnostics.strayMarkers;
    result.selectionHelperCount = state.selectionHelper ? 1 : 0;
    result.boxHelperCount = countBoxHelpers(state.modelRoot);
    const emptyPoint = findEmptyViewportPoint();
    result.emptyPointFound = Boolean(emptyPoint);
    if (emptyPoint) {
        result.emptyX = Math.round(emptyPoint.x * 100) / 100;
        result.emptyY = Math.round(emptyPoint.y * 100) / 100;
        dispatchViewportClick(emptyPoint.x, emptyPoint.y);
        await waitForRenderFrame();
        const cleared = getSelectionOutlineDiagnostics();
        result.deselectedOutlineCount = cleared.count;
        result.deselectedOutlineVisibleCount = cleared.visibleCount;
        result.deselectedOutlineEmissiveMaterialCount = cleared.emissiveMaterialCount;
    }
    dispatchViewportClick(clickPoint.x, clickPoint.y);
    await waitForRenderFrame();
    const restored = getSelectionOutlineDiagnostics();
    const allModesVisible = DISPLAY_MODE_IDS.every(mode =>
        result.modes[mode] && result.modes[mode].pixelCount > 0 && result.modes[mode].outlineVisible);
    result.success = result.selectionFromViewport && result.clickInsideCanvas && result.clickOutsideTree &&
        !result.treeClickUsed && result.singleClickOnlySelection && result.outlineCount > 0 &&
        result.outlineVisible && result.raycastStubbed === result.outlineCount && result.markerPollution === 0 &&
        allModesVisible && result.deselectedOutlineCount === 0 && result.deselectedOutlineVisibleCount === 0 &&
        result.deselectedOutlineEmissiveMaterialCount === 0 && result.strayMarkers === 0 &&
        result.wireframeOverlayValid && result.selectionHelperCount === 0 && result.boxHelperCount === 0 &&
        restored.count === result.outlineCount;
    result.message = result.success
        ? `Деталь «${result.selectedName}» выбрана одиночным щелчком в окне, контуры видны во всех ${DISPLAY_MODE_IDS.length} режимах, выделение снято щелчком по пустому месту.`
        : "Подсветка выделения в окне просмотра не подтверждена измерениями.";
    return result;
}

async function findViewportClickPointForObject(object) {
    if (!object) {
        return null;
    }
    const viewPoints = getSelectionOutlineViewPoints(object);
    if (!viewPoints) {
        return null;
    }
    for (const plan of viewPoints.plans) {
        placeSelectionOutlineCamera({ box: viewPoints.box, center: viewPoints.center, plans: plan });
        await waitForRenderFrame();
        const probe = probeViewportClickPoints(object);
        if (probe.client) {
            return probe.client;
        }
    }
    return null;
}

function collectServiceObjectClickChecks() {
    const outlines = [];
    for (const line of state.selectionOutlines.values()) {
        outlines.push(line);
    }
    const markers = state.markers.concat(state.partMarkers);
    const helperObjects = outlines.concat(markers);
    return {
        helperCount: helperObjects.length,
        raycastIntercepted: helperObjects.filter(object =>
            typeof object.raycast === "function" && object.raycast.length > 0).length,
        inPickTargets: helperObjects.filter(object => state.pickTargets.includes(object)).length,
        excludedFromServiceChecks: helperObjects.filter(isWireframeExcludedObject).length
    };
}

async function testClickSemantics() {
    const result = {
        valid: false,
        clickPointFound: false,
        clickPointMode: null,
        clickPointIndex: -1,
        clickPointStackCount: 0,
        clickedName: null,
        singleClickCount: 0,
        singleClickSelected: false,
        singleSelectAutoOpenSucceeded: true,
        singleSelectAnimationPlaying: true,
        singleSelectDoorOpen: true,
        singleSelectKeptDirection: false,
        singleSelectKeptDoorOpen: false,
        singleSelectKeptClip: false,
        singleSelectClipIndex: -1,
        clipIndexBeforeSingleClick: -1,
        singleClickOutlineCount: 0,
        doubleClickDispatched: false,
        doubleToggleOpenSucceeded: false,
        doubleToggleOpenDirection: null,
        doubleClickReachedOpenPose: false,
        doubleToggleCloseSucceeded: false,
        doubleToggleCloseDirection: null,
        doubleClickReachedClosedPose: false,
        closeClickPointMode: null,
        helperClickCount: 0,
        helperRaycastIntercepted: 0,
        helperInPickTargets: 0,
        helperExcludedFromServiceChecks: 0,
        skippedNoAnimations: false,
        message: "Семантика щелчков не проверена."
    };
    const helper = collectServiceObjectClickChecks();
    result.helperClickCount = helper.helperCount;
    result.helperRaycastIntercepted = helper.raycastIntercepted;
    result.helperInPickTargets = helper.inPickTargets;
    result.helperExcludedFromServiceChecks = helper.excludedFromServiceChecks;
    if (!state.modelRoot || !state.renderer) {
        result.message = "Модель не загружена.";
        return result;
    }
    const candidates = findSelectionTestCandidates();
    const target = candidates.animated || candidates.panelWithFirstAnimation || findSelectionOutlineTarget();
    const binding = findAnimationBinding(target);
    if (!target) {
        result.message = "В модели не найдена деталь для проверки щелчков.";
        return result;
    }
    if (!binding.valid) {
        if (state.clips.length > 0) {
            result.message = "В модели не найдена деталь с привязанной анимацией для проверки щелчков.";
            return result;
        }
        return await testStaticClickSemantics(result, target);
    }
    closeAllOpenedAnimations();
    state.doorOpen = false;
    const clickPoint = await findClickablePointForObject(target);
    if (!clickPoint) {
        result.message = "Не удалось найти точку окна просмотра, из которой выбирается деталь.";
        return result;
    }
    result.clickPointFound = true;
    result.clickPointMode = clickPoint.mode;
    result.clickPointIndex = clickPoint.index;
    result.clickPointStackCount = clickPoint.count;
    const clipIndexBeforeSingleClick = state.activeClipIndex;
    const directionBeforeSingleClick = state.animationDirection;
    const doorOpenBeforeSingleClick = state.doorOpen;
    selectObject(null);
    const singleClicks = await selectObjectByViewportClicks(target, clickPoint, clickPoint.maxClicks);
    result.clickedName = state.selectedObject ? getObjectName(state.selectedObject) : null;
    result.singleClickCount = singleClicks;
    result.singleClickSelected = singleClicks > 0 &&
        getSelectionKey(state.selectedObject, null) === getSelectionKey(target, null);
    result.singleSelectClipIndex = state.activeClipIndex;
    result.clipIndexBeforeSingleClick = clipIndexBeforeSingleClick;
    result.singleSelectKeptClip = state.activeClipIndex === clipIndexBeforeSingleClick;
    result.singleClickOutlineCount = getSelectionOutlineDiagnostics().count;
    result.singleSelectAutoOpenSucceeded = state.selectionDiagnostic.autoOpenSucceeded === true;
    result.singleSelectAnimationPlaying = state.animationPlaying === true;
    result.singleSelectDoorOpen = state.doorOpen === true;
    result.singleSelectKeptDirection = state.animationDirection === directionBeforeSingleClick;
    result.singleSelectKeptDoorOpen = state.doorOpen === doorOpenBeforeSingleClick;
    state.lastViewportClick = { x: clickPoint.x, y: clickPoint.y, time: performance.now() };
    dispatchViewportDoubleClick(clickPoint.x, clickPoint.y);
    await waitForRenderFrame();
    result.doubleClickDispatched = true;
    result.doubleToggleOpenDirection = state.animationDirection;
    result.doubleToggleOpenSucceeded = state.animationDirection === "opening" ||
        state.openClipIndices.has(binding.clipIndex);
    result.doubleClickReachedOpenPose = await waitForClipPose(binding.clipIndex, true, 240);
    if (result.doubleClickReachedOpenPose) {
        const closePoint = (await findClickablePointForObject(target)) || clickPoint;
        result.closeClickPointMode = closePoint.mode;
        await selectObjectByViewportClicks(target, closePoint, closePoint.maxClicks);
        state.lastViewportClick = { x: closePoint.x, y: closePoint.y, time: performance.now() };
        dispatchViewportDoubleClick(closePoint.x, closePoint.y);
        await waitForRenderFrame();
        result.doubleToggleCloseDirection = state.animationDirection;
        result.doubleToggleCloseSucceeded = state.animationDirection === "closing" &&
            !state.openClipIndices.has(binding.clipIndex);
        result.doubleClickReachedClosedPose = await waitForClipPose(binding.clipIndex, false, 240);
    }
    const restoreAnimation = toggleAnimatedObject(target);
    if (restoreAnimation.toggled) {
        await waitForClipPose(binding.clipIndex, false, 240);
    }
    closeAllOpenedAnimations();
    selectObject(null);
    result.valid = result.clickPointFound && result.singleClickSelected &&
        !result.singleSelectAutoOpenSucceeded && !result.singleSelectAnimationPlaying &&
        !result.singleSelectDoorOpen && result.singleSelectKeptDirection &&
        result.singleSelectKeptDoorOpen && result.singleSelectKeptClip &&
        result.singleClickOutlineCount > 0 &&
        result.doubleClickDispatched && result.doubleToggleOpenSucceeded && result.doubleClickReachedOpenPose &&
        result.doubleToggleCloseSucceeded && result.doubleClickReachedClosedPose &&
        result.helperRaycastIntercepted === 0 && result.helperInPickTargets === 0;
    result.message = result.valid
        ? `Одиночный щелчок (${result.singleClickCount}) выбрал деталь «${result.clickedName}» без запуска анимации, двойной щелчок открыл и закрыл клип ${binding.clipIndex}, служебные объекты (${result.helperClickCount}) не ловят щелчки.`
        : "Семантика щелчков не подтверждена: одиночный щелчок должен только выделять деталь, двойной — открывать и закрывать анимацию.";
    return result;
}

async function testStaticClickSemantics(result, target) {
    result.skippedNoAnimations = true;
    closeAllOpenedAnimations();
    state.doorOpen = false;
    const clickPoint = await findVerifiedClickPointForObject(target);
    if (!clickPoint) {
        result.message = "Не удалось найти точку окна просмотра, из которой выбирается деталь.";
        return result;
    }
    result.clickPointFound = true;
    result.clickPointMode = clickPoint.mode;
    result.clickPointIndex = clickPoint.index;
    result.clickPointStackCount = clickPoint.count;
    const directionBeforeSingleClick = state.animationDirection;
    const doorOpenBeforeSingleClick = state.doorOpen;
    const clipIndexBeforeSingleClick = state.activeClipIndex;
    selectObject(null);
    const singleClicks = await selectObjectByViewportClicks(target, clickPoint, clickPoint.maxClicks);
    result.clickedName = state.selectedObject ? getObjectName(state.selectedObject) : null;
    result.singleClickCount = singleClicks;
    result.singleClickSelected = singleClicks > 0 &&
        getSelectionKey(state.selectedObject, null) === getSelectionKey(target, null);
    result.singleSelectClipIndex = state.activeClipIndex;
    result.clipIndexBeforeSingleClick = clipIndexBeforeSingleClick;
    result.singleSelectKeptClip = state.activeClipIndex === clipIndexBeforeSingleClick;
    result.singleClickOutlineCount = getSelectionOutlineDiagnostics().count;
    result.singleSelectAutoOpenSucceeded = state.selectionDiagnostic.autoOpenSucceeded === true;
    result.singleSelectAnimationPlaying = state.animationPlaying === true;
    result.singleSelectDoorOpen = state.doorOpen === true;
    result.singleSelectKeptDirection = state.animationDirection === directionBeforeSingleClick;
    result.singleSelectKeptDoorOpen = state.doorOpen === doorOpenBeforeSingleClick;
    state.lastViewportClick = { x: clickPoint.x, y: clickPoint.y, time: performance.now() };
    dispatchViewportDoubleClick(clickPoint.x, clickPoint.y);
    await waitForRenderFrame();
    result.doubleClickDispatched = true;
    result.doubleToggleOpenDirection = state.animationDirection;
    result.doubleToggleOpenSucceeded = false;
    result.doubleToggleCloseDirection = state.animationDirection;
    selectObject(null);
    result.valid = result.clickPointFound && result.singleClickSelected &&
        !result.singleSelectAutoOpenSucceeded && !result.singleSelectAnimationPlaying &&
        !result.singleSelectDoorOpen && result.singleSelectKeptDirection &&
        result.singleSelectKeptDoorOpen && result.singleSelectKeptClip &&
        result.singleClickOutlineCount > 0 &&
        result.doubleClickDispatched && !result.doubleToggleOpenSucceeded &&
        result.singleSelectClipIndex === clipIndexBeforeSingleClick &&
        state.clips.length === 0 && state.openClipIndices.size === 0 && state.animatingClipIndices.size === 0 &&
        result.helperRaycastIntercepted === 0 && result.helperInPickTargets === 0;
    result.message = result.valid
        ? `Пропущено по части сценария: в модели 0 клипов. Одиночный щелчок (${result.singleClickCount}) выбрал деталь «${result.clickedName}», двойной щелчок не запустил анимацию и не оставил открытых клипов, служебные объекты (${result.helperClickCount}) не ловят щелчки.`
        : "Семантика щелчков не подтверждена на модели без анимаций: одиночный щелчок должен только выделять деталь, двойной — не запускать несуществующую анимацию.";
    return result;
}

async function testEscapeClearsSelection() {
    const result = {
        valid: false,
        selectionCreated: false,
        outlineCountBeforeEscape: 0,
        outlineVisibleCountBeforeEscape: 0,
        emissiveMaterialCountBeforeEscape: 0,
        statusBeforeEscape: null,
        outlineCountAfterEscape: 0,
        outlineVisibleCountAfterEscape: 0,
        emissiveMaterialCountAfterEscape: 0,
        selectedObjectAfterEscape: false,
        statusAfterEscape: null,
        statusClearedAfterEscape: false,
        animationPreserved: true,
        numberInputId: "animation-open-seconds",
        numberInputValueBeforeEscape: null,
        numberInputValueAfterEscape: null,
        numberInputFocusKept: false,
        numberInputDisabled: false,
        numberInputChanged: false,
        defaultPrevented: false,
        inputFocusScenario: true,
        message: "Снятие выделения клавишей Escape не проверено."
    };
    if (!state.modelRoot) {
        result.message = "Модель не загружена.";
        return result;
    }
    const target = findSelectionOutlineTarget();
    if (!target) {
        result.message = "В модели не найдены детали для проверки Escape.";
        return result;
    }
    const previousOpenSeconds = state.openSeconds;
    const previousCloseSeconds = state.closeSeconds;
    selectObject(target);
    await waitForRenderFrame();
    const before = getSelectionOutlineDiagnostics();
    result.selectionCreated = Boolean(state.selectedObject);
    result.outlineCountBeforeEscape = before.count;
    result.outlineVisibleCountBeforeEscape = before.visibleCount;
    result.emissiveMaterialCountBeforeEscape = before.emissiveMaterialCount;
    result.statusBeforeEscape = elements.statusText.textContent;
    const openClipsBefore = state.openClipIndices.size;
    const input = elements.animationOpenSeconds;
    let expectedInputValue = null;
    if (input) {
        result.numberInputDisabled = input.disabled === true;
        if (result.numberInputDisabled) {
            input.disabled = false;
        }
        input.value = "2.50";
        updateAnimationTimingSettings();
        expectedInputValue = input.value;
        input.focus();
        result.numberInputValueBeforeEscape = expectedInputValue;
    }
    const event = dispatchEscapeKey(document.activeElement || window);
    result.defaultPrevented = event.defaultPrevented;
    await waitForRenderFrame();
    const after = getSelectionOutlineDiagnostics();
    result.outlineCountAfterEscape = after.count;
    result.outlineVisibleCountAfterEscape = after.visibleCount;
    result.emissiveMaterialCountAfterEscape = after.emissiveMaterialCount;
    result.selectedObjectAfterEscape = Boolean(state.selectedObject);
    result.statusAfterEscape = elements.statusText.textContent;
    result.statusClearedAfterEscape = result.statusAfterEscape === "Выделение снято клавишей Esc.";
    if (input) {
        result.numberInputValueAfterEscape = input.value;
        result.numberInputFocusKept = document.activeElement === input;
        result.numberInputChanged = input.value !== expectedInputValue;
        input.blur();
        if (result.numberInputDisabled) {
            input.disabled = true;
            updateAnimationTimingControls();
        }
    }
    result.animationPreserved = state.openClipIndices.size === openClipsBefore;
    setAnimationSecondsForTest(previousOpenSeconds);
    state.closeSeconds = previousCloseSeconds;
    elements.animationCloseSeconds.value = formatAnimationSeconds(previousCloseSeconds);
    updateAnimationTimingSettings();
    selectObject(null);
    result.valid = result.selectionCreated && result.outlineCountBeforeEscape > 0 &&
        result.outlineCountAfterEscape === 0 && result.outlineVisibleCountAfterEscape === 0 &&
        result.emissiveMaterialCountAfterEscape === 0 && !result.selectedObjectAfterEscape &&
        result.statusClearedAfterEscape && state.measurements === null &&
        result.animationPreserved && !result.numberInputChanged && !result.defaultPrevented;
    result.message = result.valid
        ? "Escape снял выделение: контуры и emissive выделения исчезли, строка статуса сообщила о снятии выделения, значение числового поля времени анимации не изменилось."
        : "Escape не снял выделение или изменил ввод в числовом поле.";
    return result;
}

function getPressedDisplayModeIds() {
    return elements.displayModeButtons
        .filter(button => button.getAttribute("aria-pressed") === "true")
        .map(button => button.dataset.displayMode || "");
}

async function testViewportToolbar() {
    const result = {
        valid: false,
        toolbarPresent: false,
        modeButtonCount: 0,
        expectedModeCount: DISPLAY_MODES.length,
        modeOrder: [],
        modeOrderValid: false,
        modeLabelsValid: false,
        modeIconsValid: false,
        modeSwitchWorks: false,
        activeMode: null,
        activeModeButtonCount: 0,
        activeModeValid: false,
        removedLabelMatches: -1,
        removedLabels: {},
        zoomButtonCount: 0,
        zoomFitAbsent: false,
        statusBarElementCount: 0,
        statusBarIsSingleLine: false,
        distanceBefore: 0,
        distanceAfterZoomIn: 0,
        distanceAfterZoomOut: 0,
        distanceAfterMinClamp: 0,
        distanceAfterMaxClamp: 0,
        distanceAfterReset: 0,
        minimumDistance: 0,
        maximumDistance: 0,
        zoomStepRatio: 0,
        zoomInReduced: false,
        zoomOutRestored: false,
        clampedAtMinimum: false,
        clampedAtMaximum: false,
        resetRestored: false,
        targetKept: false,
        targetMatchesModelCenter: false,
        keyDistanceStart: 0,
        keyDistanceZoomIn: 0,
        keyDistanceZoomOut: 0,
        keyZoomInReduced: false,
        keyZoomOutIncreased: false,
        keyInputId: "animation-open-seconds",
        keyInputDistanceBefore: 0,
        keyInputDistanceAfter: 0,
        keyBlockedInInput: false,
        keyInputTemporarilyEnabled: false,
        timingBlockPresent: false,
        timingInputsInsideToolbar: false,
        timingInputsEnabled: false,
        timingInputsExpected: false,
        timingOpenLabel: null,
        timingCloseLabel: null,
        timingOpenMinimum: 0,
        timingOpenMaximum: 0,
        timingCloseMinimum: 0,
        timingCloseMaximum: 0,
        timingValid: false,
        panelsTogglePressed: false,
        panelsTreeDisplay: null,
        viewportWidthShown: 0,
        viewportWidthHidden: 0,
        viewportGrew: false,
        panelsRestored: false,
        message: "Панель инструментов не проверена."
    };
    if (!state.modelRoot || !state.camera || !state.controls) {
        result.message = "Модель не загружена.";
        return result;
    }
    const zoomIn = elements.zoomIn;
    const zoomOut = elements.zoomOut;
    const panelsToggle = elements.togglePanels;
    if (!zoomIn || !zoomOut || !panelsToggle) {
        result.message = "Панель инструментов без обеих кнопок масштаба или переключателя панелей.";
        return result;
    }
    result.zoomButtonCount = 2;
    result.zoomFitAbsent = document.getElementById("zoom-fit") === null;
    result.statusBarElementCount = elements.statusBar ? elements.statusBar.children.length : 0;
    result.statusBarIsSingleLine = elements.statusBar
        ? elements.statusBar.children.length === 1 && elements.statusBar.firstElementChild === elements.statusText
        : false;
    const diagnostics = getViewportToolbarDiagnostics();
    result.toolbarPresent = diagnostics.toolbarPresent;
    result.modeButtonCount = diagnostics.modeButtonCount;
    result.modeOrder = diagnostics.modeOrder;
    result.modeOrderValid = diagnostics.modeOrderValid;
    result.modeLabelsValid = diagnostics.modeLabelsValid;
    result.modeIconsValid = diagnostics.modeIconsValid;
    result.removedLabelMatches = diagnostics.removedLabelMatches;
    result.removedLabels = diagnostics.removedLabels;
    result.timingBlockPresent = diagnostics.timingBlockPresent;
    result.timingInputsInsideToolbar = diagnostics.timingInputsInsideToolbar;
    result.timingInputsEnabled = diagnostics.timingInputsEnabled;
    result.timingInputsExpected = state.clips.length > 0;
    result.timingOpenLabel = diagnostics.timingOpenLabel;
    result.timingCloseLabel = diagnostics.timingCloseLabel;
    result.timingOpenMinimum = diagnostics.timingOpenMinimum;
    result.timingOpenMaximum = diagnostics.timingOpenMaximum;
    result.timingCloseMinimum = diagnostics.timingCloseMinimum;
    result.timingCloseMaximum = diagnostics.timingCloseMaximum;
    result.timingValid = diagnostics.timingValid;
    let modeSwitchWorks = elements.displayModeButtons.length === DISPLAY_MODES.length;
    for (const button of elements.displayModeButtons) {
        button.click();
        await waitForRenderFrame();
        const pressed = getPressedDisplayModeIds();
        if (pressed.length !== 1 || pressed[0] !== button.dataset.displayMode || state.displayMode !== button.dataset.displayMode) {
            modeSwitchWorks = false;
        }
    }
    const defaultButton = elements.displayModeButtons.find(button => button.dataset.displayMode === DISPLAY_MODE_DEFAULT);
    if (defaultButton) {
        defaultButton.click();
    }
    await waitForRenderFrame();
    const pressedModes = getPressedDisplayModeIds();
    result.modeSwitchWorks = modeSwitchWorks && Boolean(defaultButton) && pressedModes.length === 1 &&
        pressedModes[0] === DISPLAY_MODE_DEFAULT;
    result.activeMode = state.displayMode;
    result.activeModeButtonCount = pressedModes.length;
    result.activeModeValid = result.modeSwitchWorks && state.displayMode === DISPLAY_MODE_DEFAULT;
    setPanelsHidden(false);
    resetCamera();
    await waitForRenderFrame();
    const limits = getZoomLimits();
    result.minimumDistance = limits.minimum;
    result.maximumDistance = limits.maximum;
    result.distanceBefore = getCameraDistance();
    const targetBefore = state.controls.target.clone();
    const tolerance = 1e-6 * Math.max(1, result.distanceBefore);
    zoomIn.click();
    await waitForZoomSettled();
    result.distanceAfterZoomIn = getCameraDistance();
    result.zoomStepRatio = result.distanceBefore > 0 ? result.distanceAfterZoomIn / result.distanceBefore : 0;
    result.zoomInReduced = result.distanceAfterZoomIn < result.distanceBefore - tolerance;
    zoomOut.click();
    await waitForZoomSettled();
    result.distanceAfterZoomOut = getCameraDistance();
    result.zoomOutRestored = Math.abs(result.distanceAfterZoomOut - result.distanceBefore) <= tolerance;
    for (let step = 0; step < ZOOM_CLAMP_CLICKS; step += 1) {
        zoomIn.click();
    }
    await waitForZoomSettled();
    result.distanceAfterMinClamp = getCameraDistance();
    result.clampedAtMinimum = Math.abs(result.distanceAfterMinClamp - limits.minimum) <= limits.minimum * 1e-6;
    for (let step = 0; step < ZOOM_CLAMP_CLICKS; step += 1) {
        zoomOut.click();
    }
    await waitForZoomSettled();
    result.distanceAfterMaxClamp = getCameraDistance();
    result.clampedAtMaximum = Math.abs(result.distanceAfterMaxClamp - limits.maximum) <= limits.maximum * 1e-6;
    resetCamera();
    await waitForRenderFrame();
    result.distanceAfterReset = getCameraDistance();
    result.resetRestored = Math.abs(result.distanceAfterReset - result.distanceBefore) <= tolerance;
    result.targetKept = state.controls.target.distanceTo(targetBefore) <= 1e-9;
    result.targetMatchesModelCenter = Boolean(state.modelSphereCenter) &&
        state.controls.target.distanceTo(state.modelSphereCenter) <= state.modelRadius * 1e-6;
    result.keyDistanceStart = getCameraDistance();
    dispatchZoomKey("+", "Equal", window);
    await waitForZoomSettled();
    result.keyDistanceZoomIn = getCameraDistance();
    result.keyZoomInReduced = result.keyDistanceZoomIn < result.keyDistanceStart - tolerance;
    dispatchZoomKey("-", "Minus", window);
    await waitForZoomSettled();
    result.keyDistanceZoomOut = getCameraDistance();
    result.keyZoomOutIncreased = result.keyDistanceZoomOut > result.keyDistanceZoomIn + tolerance;
    const input = elements.animationOpenSeconds;
    if (input) {
        const wasDisabled = input.disabled === true;
        result.keyInputTemporarilyEnabled = wasDisabled;
        if (wasDisabled) {
            input.disabled = false;
        }
        input.focus();
        result.keyInputDistanceBefore = getCameraDistance();
        const blockedEvent = dispatchZoomKey("+", "Equal", input);
        await waitForZoomSettled();
        result.keyInputDistanceAfter = getCameraDistance();
        result.keyBlockedInInput = result.keyInputDistanceAfter === result.keyInputDistanceBefore &&
            blockedEvent.defaultPrevented === false;
        input.blur();
        if (wasDisabled) {
            input.disabled = true;
            updateAnimationTimingControls();
        }
    }
    const treePanel = elements.objectTree ? elements.objectTree.closest(".panel") : null;
    setPanelsHidden(false);
    await waitForRenderFrame();
    result.viewportWidthShown = elements.viewport.clientWidth;
    panelsToggle.click();
    await waitForRenderFrame();
    await waitForRenderFrame();
    result.panelsTogglePressed = panelsToggle.getAttribute("aria-pressed") === "true";
    result.panelsTreeDisplay = treePanel ? window.getComputedStyle(treePanel).display : null;
    result.viewportWidthHidden = elements.viewport.clientWidth;
    result.viewportGrew = result.viewportWidthHidden > result.viewportWidthShown;
    panelsToggle.click();
    await waitForRenderFrame();
    await waitForRenderFrame();
    result.panelsRestored = state.panelsHidden === false &&
        Boolean(treePanel) && window.getComputedStyle(treePanel).display !== "none" &&
        elements.viewport.clientWidth === result.viewportWidthShown;
    setPanelsHidden(false);
    resetCamera();
    applyDisplayMode(DISPLAY_MODE_DEFAULT);
    selectObject(null);
    result.valid = result.toolbarPresent && result.modeButtonCount === result.expectedModeCount &&
        result.modeOrderValid && result.modeLabelsValid && result.modeIconsValid && result.modeSwitchWorks &&
        result.activeModeValid && result.removedLabelMatches === 0 &&
        result.zoomButtonCount === 2 && result.zoomFitAbsent &&
        result.statusBarElementCount === 1 && result.statusBarIsSingleLine &&
        result.timingBlockPresent && result.timingInputsInsideToolbar &&
        result.timingInputsEnabled === result.timingInputsExpected &&
        result.timingOpenLabel === "Открытие, с" && result.timingCloseLabel === "Закрытие, с" &&
        result.timingOpenMinimum === ANIMATION_SECONDS_MIN && result.timingOpenMaximum === ANIMATION_SECONDS_MAX &&
        result.timingCloseMinimum === ANIMATION_SECONDS_MIN && result.timingCloseMaximum === ANIMATION_SECONDS_MAX &&
        result.timingValid &&
        result.zoomInReduced && Math.abs(result.zoomStepRatio - ZOOM_STEP_FACTOR) <= 1e-6 &&
        result.zoomOutRestored && result.clampedAtMinimum && result.clampedAtMaximum &&
        result.resetRestored && result.targetKept && result.targetMatchesModelCenter &&
        result.keyZoomInReduced && result.keyZoomOutIncreased && result.keyBlockedInInput &&
        result.panelsTogglePressed && result.panelsTreeDisplay === "none" &&
        result.viewportGrew && result.panelsRestored;
    result.message = result.valid
        ? `Панель инструментов: ${result.modeButtonCount} иконки режима в порядке источника истины, активный «${result.activeMode}», кнопок зума ${result.zoomButtonCount}, удалённой кнопки вписания нет (${result.zoomFitAbsent}), элементов статус-бара ${result.statusBarElementCount}, блок «Время анимации» в строке инструментов (открытие ${result.timingOpenMinimum}…${result.timingOpenMaximum} с, закрытие ${result.timingCloseMinimum}…${result.timingCloseMaximum} с), зум ${result.distanceBefore} → ${result.distanceAfterZoomIn} → ${result.distanceAfterReset} в пределах ${result.minimumDistance}…${result.maximumDistance}, панели скрыты (${result.viewportWidthShown} → ${result.viewportWidthHidden} px) и показаны снова.`
        : "Панель инструментов не подтверждена: иконки, зум, клавиши, блок времени анимации или скрытие панелей.";
    return result;
}

function scanViewportForDeepestPickStack() {
    const bounds = state.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
        return null;
    }
    const fractionsX = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
    const fractionsY = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
    let best = null;
    for (const vertical of fractionsY) {
        for (const horizontal of fractionsX) {
            const client = {
                x: bounds.left + bounds.width * horizontal,
                y: bounds.top + bounds.height * vertical
            };
            const stack = buildPickStack(client.x, client.y);
            if (!stack || stack.objects.length === 0) {
                continue;
            }
            if (!best || stack.objects.length > best.count) {
                best = {
                    client,
                    count: stack.objects.length,
                    names: stack.objects.map(object => getObjectName(object)),
                    distances: stack.distances.slice()
                };
            }
            if (best.count >= 6) {
                return best;
            }
        }
    }
    return best;
}

function getPickStackAnimatedLayer(objects) {
    for (let index = 0; index < objects.length; index += 1) {
        const binding = findAnimationBinding(objects[index]);
        if (binding.valid && getAnimationOpenPoseTime(getClipAction(binding.clipIndex, true)) > 0) {
            return index;
        }
    }
    return -1;
}

function findAnimatedPartObjects() {
    const found = [];
    const seen = new Set();
    const add = object => {
        if (!object || seen.has(object)) {
            return;
        }
        const binding = findAnimationBinding(object);
        if (binding.valid && getAnimationOpenPoseTime(getClipAction(binding.clipIndex, true)) > 0) {
            seen.add(object);
            found.push(object);
        }
    };
    for (const entry of state.partObjects.values()) {
        add(entry ? entry.object : null);
    }
    if (state.modelRoot) {
        state.modelRoot.traverse(object => {
            if (!isWireframeOverlay(object) && !isWireframeExcludedObject(object)) {
                add(object);
            }
        });
    }
    return found;
}

async function testPickStackCycling() {
    const result = {
        valid: false,
        pointFound: false,
        clickX: null,
        clickY: null,
        stackCount: 0,
        stackNames: [],
        stackDistances: [],
        distancesSorted: false,
        distinctLayers: 0,
        firstIndex: -1,
        firstName: null,
        selectedAfterFirst: null,
        outlineAfterFirst: 0,
        secondIndex: -1,
        secondName: null,
        selectedAfterSecond: null,
        advancedOnSecondClick: false,
        indexAfterFullCycle: -1,
        cyclesAfterFullCycle: 0,
        fullCycleReturnsFirst: false,
        serviceObjectHits: 0,
        geometrylessHits: 0,
        cameraMoved: false,
        cameraMoveResetsStack: false,
        stackAfterCameraMove: null,
        doubleClickStackIndex: -1,
        doubleClickStackCount: 0,
        doubleClickKeptIndex: false,
        doubleClickOpenedAnimation: false,
        doubleClickClipIndex: -1,
        doubleClickTargetName: null,
        doubleClickBindingValid: false,
        doubleClickLayerIndex: -1,
        doubleClickDirection: null,
        doubleClickReachedOpenPose: false,
        summaryText: null,
        summaryHasProgress: false,
        hintText: PICK_STACK_HINT,
        skippedNoAnimations: false,
        message: "Выбор насквозь не проверен."
    };
    if (!state.modelRoot || !state.renderer) {
        result.message = "Модель не загружена.";
        return result;
    }
    closeAllOpenedAnimations();
    selectObject(null);
    applyDisplayMode(DISPLAY_MODE_DEFAULT);
    resetCamera();
    state.doorOpen = false;
    state.animationDirection = "closed";
    await waitForRenderFrame();
    const scan = scanViewportForDeepestPickStack();
    if (!scan) {
        result.message = "Не найдено ни одной точки с попаданием луча в деталь.";
        return result;
    }
    result.pointFound = true;
    result.clickX = Math.round(scan.client.x * 100) / 100;
    result.clickY = Math.round(scan.client.y * 100) / 100;
    resetPickStack();
    state.lastViewportClick = null;
    dispatchViewportClick(scan.client.x, scan.client.y);
    await waitForRenderFrame();
    const afterFirst = getPickStackDiagnostics();
    result.stackCount = afterFirst.count;
    result.stackNames = afterFirst.names;
    result.stackDistances = afterFirst.distances.map(value => Math.round(value * 1000) / 1000);
    result.distinctLayers = new Set(afterFirst.names).size;
    result.distancesSorted = afterFirst.distances.every((value, index, list) => index === 0 || value >= list[index - 1]);
    result.firstIndex = afterFirst.index;
    result.firstName = afterFirst.names[0] || null;
    result.selectedAfterFirst = state.selectedObject ? getObjectName(state.selectedObject) : null;
    result.outlineAfterFirst = getSelectionOutlineDiagnostics().count;
    state.lastViewportClick = { x: scan.client.x, y: scan.client.y, time: 0 };
    dispatchViewportClick(scan.client.x, scan.client.y);
    await waitForRenderFrame();
    const afterSecond = getPickStackDiagnostics();
    result.secondIndex = afterSecond.index;
    result.secondName = afterSecond.names[afterSecond.index] || null;
    result.selectedAfterSecond = state.selectedObject ? getObjectName(state.selectedObject) : null;
    result.advancedOnSecondClick = afterSecond.index === 1;
    result.serviceObjectHits = afterSecond.serviceObjectHits;
    result.geometrylessHits = afterSecond.geometrylessHits;
    for (let step = 0; step < result.stackCount - 1; step += 1) {
        state.lastViewportClick = { x: scan.client.x, y: scan.client.y, time: 0 };
        dispatchViewportClick(scan.client.x, scan.client.y);
        await waitForRenderFrame();
    }
    const afterFull = getPickStackDiagnostics();
    result.indexAfterFullCycle = afterFull.index;
    result.cyclesAfterFullCycle = afterFull.cycles;
    result.fullCycleReturnsFirst = afterFull.index === 0 &&
        afterFirst.names.length === result.stackCount && afterFull.names[0] === afterFirst.names[0];
    result.summaryText = getPickStackText();
    result.summaryHasProgress = typeof result.summaryText === "string" &&
        result.summaryText.includes("Под курсором деталей:") &&
        result.summaryText.includes(`выбрана ${afterFull.index + 1} из ${result.stackCount}`);
    const directionBeforeMove = state.camera.getWorldDirection(new state.THREE.Vector3());
    setCameraAzimuth(37);
    await waitForRenderFrame();
    const directionAfterMove = state.camera.getWorldDirection(new state.THREE.Vector3());
    result.cameraMoved = directionBeforeMove.distanceTo(directionAfterMove) > 0.000001;
    result.stackAfterCameraMove = getPickStackDiagnostics();
    result.cameraMoveResetsStack = result.cameraMoved && result.stackAfterCameraMove.count === 0 &&
        result.stackAfterCameraMove.index === -1;
    resetCamera();
    await waitForRenderFrame();
    buildPickStack(scan.client.x, scan.client.y);
    const indexBeforeDouble = state.pickStack ? state.pickStack.index : -1;
    const countBeforeDouble = state.pickStack ? state.pickStack.objects.length : 0;
    state.lastViewportClick = { x: scan.client.x, y: scan.client.y, time: performance.now() };
    dispatchViewportDoubleClick(scan.client.x, scan.client.y);
    await waitForRenderFrame();
    const afterDouble = getPickStackDiagnostics();
    result.doubleClickStackIndex = afterDouble.index;
    result.doubleClickStackCount = afterDouble.count;
    result.doubleClickKeptIndex = indexBeforeDouble >= 0 &&
        afterDouble.index === indexBeforeDouble && countBeforeDouble > 1;
    const animatedObject = findAnimatedPartObjects()[0] || null;
    const animatedPoint = animatedObject ? await findClickablePointForObject(animatedObject) : null;
    if (!animatedPoint) {
        if (state.clips.length > 0) {
            result.message = "Не найдено точки окна просмотра для двойного щелчка по анимируемой детали.";
            return result;
        }
        result.skippedNoAnimations = true;
        buildPickStack(scan.client.x, scan.client.y);
        const staticIndex = state.pickStack ? state.pickStack.index : -1;
        const staticTarget = getViewportDoubleClickTarget(scan.client.x, scan.client.y);
        const staticActiveBefore = state.activeClipIndex;
        if (staticTarget) {
            selectObject(staticTarget);
        }
        state.lastViewportClick = { x: scan.client.x, y: scan.client.y, time: performance.now() };
        dispatchViewportDoubleClick(scan.client.x, scan.client.y);
        await waitForRenderFrame();
        const afterStaticDouble = getPickStackDiagnostics();
        result.doubleClickStackIndex = afterStaticDouble.index;
        result.doubleClickStackCount = afterStaticDouble.count;
        result.doubleClickKeptIndex = staticIndex >= 0 && afterStaticDouble.index === staticIndex &&
            afterStaticDouble.count >= 2;
        result.doubleClickLayerIndex = 0;
        result.doubleClickTargetName = staticTarget ? getObjectName(staticTarget) : null;
        result.doubleClickBindingValid = false;
        result.doubleClickClipIndex = state.activeClipIndex;
        result.doubleClickDirection = state.animationDirection;
        result.doubleClickOpenedAnimation = false;
        result.doubleClickReachedOpenPose = true;
        const staticOpenClips = state.openClipIndices.size;
        const staticAnimatingClips = state.animatingClipIndices.size;
        closeAllOpenedAnimations();
        selectObject(null);
        result.valid = result.pointFound && result.stackCount >= 2 && result.advancedOnSecondClick &&
            result.fullCycleReturnsFirst && result.cyclesAfterFullCycle === 1 &&
            result.serviceObjectHits === 0 && result.geometrylessHits === 0 &&
            result.cameraMoveResetsStack && result.summaryHasProgress &&
            result.doubleClickKeptIndex && result.outlineAfterFirst > 0 &&
            state.clips.length === 0 && staticOpenClips === 0 && staticAnimatingClips === 0 &&
            result.doubleClickClipIndex === staticActiveBefore;
        result.message = result.valid
            ? `Под курсором ${result.stackCount} деталей (слоёв: ${result.distinctLayers}); щелчки перебрали индексы 1→2→…→${result.stackCount}→1, циклов: ${result.cyclesAfterFullCycle}, стек сброшен при повороте камеры. Пропущено по двойному щелчку: в модели 0 клипов, открытых и проигрываемых клипов не появилось (${staticOpenClips}/${staticAnimatingClips}).`
            : "Выбор насквозь не подтверждён: перебор слоёв, сброс кэша или защита двойного щелчка не сработали.";
        return result;
    }
    buildPickStack(animatedPoint.x, animatedPoint.y);
    const animatedLayer = getPickStackAnimatedLayer(state.pickStack.objects);
    result.doubleClickLayerIndex = animatedLayer;
    if (animatedLayer > 0) {
        state.pickStack.index = animatedLayer;
    }
    const doubleTarget = getViewportDoubleClickTarget(animatedPoint.x, animatedPoint.y);
    const doubleBinding = doubleTarget ? findAnimationBinding(doubleTarget) : { valid: false, clipIndex: -1 };
    result.doubleClickTargetName = doubleTarget ? getObjectName(doubleTarget) : null;
    result.doubleClickBindingValid = doubleBinding.valid;
    if (doubleTarget) {
        selectObject(doubleTarget);
    }
    const activeBefore = state.activeClipIndex;
    state.lastViewportClick = { x: animatedPoint.x, y: animatedPoint.y, time: performance.now() };
    dispatchViewportDoubleClick(animatedPoint.x, animatedPoint.y);
    await waitForRenderFrame();
    result.doubleClickClipIndex = state.activeClipIndex;
    result.doubleClickDirection = state.animationDirection;
    result.doubleClickOpenedAnimation = doubleBinding.valid &&
        (state.activeClipIndex !== activeBefore || state.animationDirection === "opening" ||
            state.openClipIndices.has(doubleBinding.clipIndex));
    if (result.doubleClickOpenedAnimation) {
        result.doubleClickReachedOpenPose = await waitForClipPose(doubleBinding.clipIndex, true, 240);
        toggleAnimatedObject(doubleTarget);
        await waitForClipPose(doubleBinding.clipIndex, false, 240);
    }
    closeAllOpenedAnimations();
    selectObject(null);
    result.valid = result.pointFound && result.stackCount >= 2 && result.advancedOnSecondClick &&
        result.fullCycleReturnsFirst && result.cyclesAfterFullCycle === 1 &&
        result.serviceObjectHits === 0 && result.geometrylessHits === 0 &&
        result.cameraMoveResetsStack && result.summaryHasProgress &&
        result.doubleClickKeptIndex && result.doubleClickOpenedAnimation && result.outlineAfterFirst > 0;
    result.message = result.valid
        ? `Под курсором ${result.stackCount} деталей (слоёв: ${result.distinctLayers}); щелчки перебрали индексы 1→2→…→${result.stackCount}→1, циклов: ${result.cyclesAfterFullCycle}, стек сброшен при повороте камеры, двойной щелчок не перелистал стек и открыл клип ${result.doubleClickClipIndex}.`
        : "Выбор насквозь не подтверждён: перебор слоёв, сброс кэша или защита двойного щелчка не сработали.";
    return result;
}

async function testTreeBlockVisibility() {
    const result = {
        valid: false,
        blockCount: 0,
        selectedBlockKey: null,
        selectedBlockPartCount: 0,
        selectedBlockLabel: null,
        selectionNameText: null,
        blockLabelMatches: false,
        blockRowMarkedSelected: false,
        blockOutlineCount: 0,
        blockOutlineVisibleCount: 0,
        blockDimensionsText: null,
        blockDimensionsInMillimeters: false,
        blockStatusIsShort: false,
        blockMeasurementsValid: false,
        blockPartCountMeasured: 0,
        blockPartCountExpected: 0,
        pickTargetsBefore: 0,
        hiddenAfterBlockHide: 0,
        hiddenMeshCount: 0,
        hiddenMarkerCount: 0,
        pickTargetLeak: 0,
        hiddenBlockObjectCount: 0,
        hiddenObjectVisibleCount: 0,
        blockHiddenOnlyItsParts: true,
        blockRowMarkedHidden: false,
        hiddenPartRowsMarked: 0,
        treeRowsMarkedHidden: 0,
        pickTargetsAfterHide: 0,
        pickTargetsShrunk: false,
        selectionClearedWhenHidden: false,
        contextMenuOpened: false,
        contextMenuItems: [],
        contextMenuHasBlockItems: false,
        contextMenuHasPartItems: false,
        contextMenuHasAnimationItems: false,
        contextMenuAnimationItems: [],
        contextMenuAnimationItemsWhileOpen: [],
        contextMenuAnimationItemsWhilePlaying: [],
        contextMenuShowsCloseWhenOpen: false,
        contextMenuShowsPauseWhenPlaying: false,
        contextMenuAnimationActionWorks: false,
        contextMenuResetActionWorks: false,
        contextMenuRussianLabels: false,
        contextMenuClosedOutside: false,
        contextMenuClosedByEscape: false,
        hiddenAfterPartHide: 0,
        partHiddenOnlyItself: true,
        partRowMarked: false,
        partLabelVisible: false,
        hiddenPartCount: 0,
        restoredObjectCount: 0,
        pickTargetsAfter: 0,
        visibilityRestored: false,
        treeRowsRestored: false,
        skippedNoAnimations: false,
        message: "Блоки дерева и скрытие не проверены."
    };
    if (!state.modelRoot || state.treeBlocks.size === 0) {
        result.message = "В дереве нет ни одного блока для проверки.";
        return result;
    }
    result.blockCount = state.treeBlocks.size;
    result.pickTargetsBefore = state.pickTargets.length;
    const target = Array.from(state.treeBlocks.values())
        .filter(block => block.objects.length > 0)
        .sort((first, second) => second.objects.length - first.objects.length)[0];
    if (!target) {
        result.message = "Ни один блок не содержит деталей.";
        return result;
    }
    result.blockPartCountExpected = target.objects.length;
    selectBlock(target);
    await waitForRenderFrame();
    const blockOutline = getSelectionOutlineDiagnostics();
    result.selectedBlockKey = target.key;
    result.selectedBlockPartCount = state.selectedBlock ? state.selectedBlock.objects.length : 0;
    result.selectedBlockLabel = getSelectionLabel();
    result.selectionNameText = result.selectedBlockLabel;
    result.blockLabelMatches = result.selectedBlockLabel === `Блок ${target.blockIndex + 1}, деталей: ${target.objects.length}`;
    result.blockOutlineCount = blockOutline.count;
    result.blockOutlineVisibleCount = blockOutline.visibleCount;
    result.blockDimensionsText = state.measurements && state.measurements.valid
        ? formatMillimeterTriple(state.measurements.worldSizeMm)
        : null;
    result.blockStatusIsShort = elements.statusText.textContent === getBlockSelectionStatus(target);
    result.blockMeasurementsValid = Boolean(state.measurements && state.measurements.valid);
    result.blockPartCountMeasured = state.measurements ? state.measurements.partCount || 0 : 0;
    result.blockDimensionsInMillimeters = result.blockDimensionsText
        ? /\d+(\.\d+)? × \d+(\.\d+)? × \d+(\.\d+)? мм/.test(result.blockDimensionsText)
        : false;
    const group = state.treeGroupsByKey.get(target.key);
    result.blockRowMarkedSelected = Boolean(group) && group.toggle.dataset.selected === "true";
    result.contextMenuOpened = openTreeContextMenu(120, 160, { kind: "block", block: target });
    result.contextMenuItems = elements.treeContextMenu
        ? Array.from(elements.treeContextMenu.querySelectorAll(".context-menu-item")).map(item => item.textContent)
        : [];
    result.contextMenuHasBlockItems = result.contextMenuItems.includes("Скрыть блок") &&
        result.contextMenuItems.includes("Выделить блок") && result.contextMenuItems.includes("Показать всё");
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 900, clientY: 400 }));
    result.contextMenuClosedOutside = Boolean(elements.treeContextMenu && elements.treeContextMenu.hidden);
    openTreeContextMenu(120, 160, { kind: "block", block: target });
    dispatchEscapeKey(window);
    result.contextMenuClosedByEscape = Boolean(elements.treeContextMenu && elements.treeContextMenu.hidden);
    result.contextMenuRussianLabels = result.contextMenuItems.every(label => /^[А-ЯЁ]/.test(label));
    const otherBlockObjects = new Set();
    for (const block of state.treeBlocks.values()) {
        if (block.key === target.key) {
            continue;
        }
        for (const object of block.objects) {
            otherBlockObjects.add(object);
        }
    }
    runTreeContextMenuAction("hide", { kind: "block", block: target });
    await waitForRenderFrame();
    const hidden = getVisibilityDiagnostics();
    result.hiddenAfterBlockHide = hidden.hiddenObjectCount;
    result.hiddenMeshCount = hidden.hiddenMeshCount;
    result.hiddenMarkerCount = hidden.hiddenMarkerCount;
    result.pickTargetLeak = hidden.pickTargetLeak;
    result.hiddenBlockObjectCount = target.objects.filter(object => state.hiddenObjects.has(object)).length;
    result.blockHiddenOnlyItsParts = result.hiddenAfterBlockHide === target.objects.length &&
        result.hiddenBlockObjectCount === target.objects.length &&
        Array.from(state.hiddenObjects).every(object => !otherBlockObjects.has(object));
    result.pickTargetsAfterHide = state.pickTargets.length;
    result.pickTargetsShrunk = state.pickTargets.length === hidden.pickTargetCount;
    result.treeRowsMarkedHidden = hidden.treeHiddenMarkedRows;
    result.blockRowMarkedHidden = Boolean(group) && group.toggle.dataset.hidden === "true";
    result.hiddenPartRowsMarked = target.objects
        .filter(object => state.hiddenObjects.has(object) && state.treeButtons.get(object) &&
            state.treeButtons.get(object).dataset.hidden === "true").length;
    const hiddenPart = target.objects[0];
    const hiddenPartButton = state.treeButtons.get(hiddenPart);
    result.hiddenPartRowMarked = Boolean(hiddenPartButton) && hiddenPartButton.dataset.hidden === "true";
    result.hiddenPartLabelVisible = Boolean(hiddenPartButton) && hiddenPartButton.querySelector(".object-hidden-tag") !== null;
    result.hiddenObjectVisibleCount = hidden.hiddenObjectVisibleCount;
    result.selectionClearedWhenHidden = state.selectedObject === null && state.selectedBlock === null;
    runTreeContextMenuAction("show-all", { kind: "block", block: target });
    await waitForRenderFrame();
    result.restoredObjectCount = target.objects.length - state.hiddenObjects.size;
    const partTarget = target.objects[0];
    const partButton = state.treeButtons.get(partTarget);
    openTreeContextMenu(140, 200, { kind: "part", object: partTarget });
    result.contextMenuHasPartItems = Array.from(elements.treeContextMenu.querySelectorAll(".context-menu-item"))
        .map(item => item.textContent)
        .every(label => ["Скрыть деталь", "Выделить деталь", "Показать всё", "Открыть", "Закрыть", "Воспроизвести", "Пауза", "Сбросить анимацию"].includes(label));
    const animatedPart = target.objects.find(object => getTreeContextMenuTargetAnimation({ kind: "part", object }) !== null) || null;
    if (animatedPart) {
        openTreeContextMenu(160, 220, { kind: "part", object: animatedPart });
        const animatedItems = Array.from(elements.treeContextMenu.querySelectorAll(".context-menu-item"))
            .map(item => item.textContent);
        result.contextMenuAnimationItems = animatedItems.filter(label => ["Открыть", "Закрыть", "Воспроизвести", "Пауза", "Сбросить анимацию"].includes(label));
        result.contextMenuHasAnimationItems = ["Сбросить анимацию"].includes(result.contextMenuAnimationItems[result.contextMenuAnimationItems.length - 1]) &&
            result.contextMenuAnimationItems.length >= 2;
        closeTreeContextMenu();
        setAnimationSecondsForTest(ANIMATION_SECONDS_MIN);
        runTreeContextMenuAction("toggle-door", { kind: "part", object: animatedPart });
        const openedClip = state.activeClipIndex;
        const reachedOpen = openedClip >= 0 && await waitForClipPose(openedClip, true, 240);
        result.contextMenuAnimationActionWorks = reachedOpen;
        openTreeContextMenu(160, 220, { kind: "part", object: animatedPart });
        result.contextMenuAnimationItemsWhileOpen = Array.from(elements.treeContextMenu.querySelectorAll(".context-menu-item"))
            .map(item => item.textContent)
            .filter(label => ["Открыть", "Закрыть", "Воспроизвести", "Пауза", "Сбросить анимацию"].includes(label));
        result.contextMenuShowsCloseWhenOpen = result.contextMenuAnimationItemsWhileOpen.includes("Закрыть");
        closeTreeContextMenu();
        runTreeContextMenuAction("toggle-playback", { kind: "part", object: animatedPart });
        openTreeContextMenu(160, 220, { kind: "part", object: animatedPart });
        result.contextMenuAnimationItemsWhilePlaying = Array.from(elements.treeContextMenu.querySelectorAll(".context-menu-item"))
            .map(item => item.textContent)
            .filter(label => ["Открыть", "Закрыть", "Воспроизвести", "Пауза", "Сбросить анимацию"].includes(label));
        result.contextMenuShowsPauseWhenPlaying = result.contextMenuAnimationItemsWhilePlaying.includes("Пауза");
        closeTreeContextMenu();
        await waitForClipPose(openedClip, true, 240);
        runTreeContextMenuAction("reset-animation", { kind: "part", object: animatedPart });
        result.contextMenuResetActionWorks = openedClip >= 0 &&
            !state.openClipIndices.has(openedClip) &&
            state.animationDirection === "closed" &&
            !state.animatingClipIndices.has(openedClip);
        runTreeContextMenuAction("show-all", { kind: "part", object: partTarget });
    } else {
        closeTreeContextMenu();
        result.contextMenuHasAnimationItems = false;
        result.skippedNoAnimations = state.clips.length === 0;
        result.contextMenuAnimationItemsWhileOpen = result.contextMenuAnimationItems;
        result.contextMenuAnimationItemsWhilePlaying = result.contextMenuAnimationItems;
        result.contextMenuAnimationActionWorks = result.skippedNoAnimations;
        result.contextMenuResetActionWorks = result.skippedNoAnimations;
        result.contextMenuShowsCloseWhenOpen = result.skippedNoAnimations;
        result.contextMenuShowsPauseWhenPlaying = result.skippedNoAnimations;
    }
    runTreeContextMenuAction("hide", { kind: "part", object: partTarget });
    await waitForRenderFrame();
    result.hiddenAfterPartHide = state.hiddenObjects.size;
    result.hiddenPartCount = state.hiddenObjects.has(partTarget) ? 1 : 0;
    result.partHiddenOnlyItself = state.hiddenObjects.size === 1 && result.hiddenPartCount === 1 &&
        collectPartGeometry(partTarget).every(mesh => !state.pickTargets.includes(mesh));
    result.partRowMarked = Boolean(partButton) && partButton.dataset.hidden === "true";
    const partTag = partButton ? partButton.querySelector(".object-hidden-tag") : null;
    result.partLabelVisible = Boolean(partTag) && partTag.hidden === false;
    runTreeContextMenuAction("show-all", { kind: "part", object: partTarget });
    await waitForRenderFrame();
    result.pickTargetsAfter = state.pickTargets.length;
    result.visibilityRestored = state.hiddenObjects.size === 0 && getVisibilityDiagnostics().valid &&
        state.pickTargets.length === result.pickTargetsBefore;
    result.treeRowsRestored = getTreeDiagnostics().hiddenMarkedRows === 0;
    closeAllOpenedAnimations();
    setAnimationTimingDefaults();
    selectObject(null);
    const animationMenuValid = result.skippedNoAnimations
        ? result.contextMenuAnimationItems.length === 0 && result.contextMenuAnimationActionWorks &&
            result.contextMenuResetActionWorks && result.contextMenuShowsCloseWhenOpen &&
            result.contextMenuShowsPauseWhenPlaying
        : result.contextMenuHasAnimationItems && result.contextMenuAnimationActionWorks &&
            result.contextMenuShowsCloseWhenOpen && result.contextMenuShowsPauseWhenPlaying &&
            result.contextMenuResetActionWorks;
    result.valid = result.blockCount > 0 && result.blockLabelMatches && result.blockRowMarkedSelected &&
        result.blockOutlineCount > 0 && result.blockOutlineCount === result.blockOutlineVisibleCount &&
        result.blockMeasurementsValid && result.blockDimensionsInMillimeters && result.blockStatusIsShort &&
        result.blockPartCountMeasured === target.objects.length &&
        result.contextMenuOpened && result.contextMenuHasBlockItems && result.contextMenuHasPartItems &&
        animationMenuValid &&
        result.contextMenuRussianLabels && result.contextMenuClosedOutside && result.contextMenuClosedByEscape &&
        result.blockHiddenOnlyItsParts && result.pickTargetLeak === 0 &&
        result.treeRowsMarkedHidden === target.objects.length &&
        result.blockRowMarkedHidden && result.hiddenPartRowsMarked === target.objects.length &&
        result.pickTargetsShrunk &&
        result.hiddenObjectVisibleCount === 0 &&
        result.partHiddenOnlyItself && result.partRowMarked && result.partLabelVisible &&
        result.visibilityRestored && result.treeRowsRestored;
    result.message = result.valid
        ? `Блок ${target.blockIndex + 1} выделяется целиком: контуров ${result.blockOutlineCount}, деталей ${result.blockPartCountMeasured}, габариты в мм в статус-баре; «Скрыть блок» скрыл ровно ${result.hiddenAfterBlockHide} деталей и ${result.hiddenMeshCount} мешей, утечек в pickTargets ${result.pickTargetLeak}; «Скрыть деталь» скрыл ${result.hiddenAfterPartHide}; «Показать всё» вернул ${result.pickTargetsAfter} целей выбора; действия анимации в меню детали: ${result.contextMenuAnimationItems.length > 0 ? result.contextMenuAnimationItems.join(", ") : "не показаны, в модели 0 клипов"}.`
        : "Выделение блока, контекстное меню или скрытие по правой кнопке не подтверждены.";
    return result;
}

async function waitForClipPose(clipIndex, openPose, maxFrames) {
    for (let frame = 0; frame < maxFrames; frame += 1) {
        await waitForRenderFrame();
        if (openPose) {
            if (state.openClipIndices.has(clipIndex)) {
                return true;
            }
        } else if (!state.animatingClipIndices.has(clipIndex)) {
            return true;
        }
    }
    return false;
}

async function testMultiOpenAnimations() {
    const result = {
        valid: false,
        clipA: -1,
        clipB: -1,
        openPoseA: 0,
        openPoseB: 0,
        multiOpenA: null,
        multiOpenB: null,
        multiOpenBTimeAfterA: null,
        multiOpenATimeAfterB: null,
        multiOpenPreserved: false,
        closeTimeB: null,
        multiOpenATimeAfterCloseB: null,
        closedOnlySelected: false,
        preservedOpenClips: 0,
        openClipCount: 0,
        animatingClipCount: 0,
        openClipIndexes: [],
        finalOpenClipCount: 0,
        finalAnimatingClipCount: 0,
        framedOpenParts: false,
        secondsPerTransition: 0,
        skippedNoAnimations: false,
        message: "Мульти-открытие не проверено."
    };
    if (!state.mixer || !state.modelRoot) {
        result.skippedNoAnimations = state.clips.length === 0;
        result.message = result.skippedNoAnimations
            ? "Пропущено: в модели нет клипов анимации, мульти-открытие неприменимо."
            : "В модели нет микшера анимаций.";
        return result;
    }
    const pair = findAnimationTestPair();
    if (!pair) {
        result.message = "В модели не найдены две детали с разными связанными клипами.";
        return result;
    }
    result.clipA = pair.clipA;
    result.clipB = pair.clipB;
    result.openPoseA = getClipOpenPoseTime(pair.clipA);
    result.openPoseB = getClipOpenPoseTime(pair.clipB);
    const previousOpenSeconds = state.openSeconds;
    const previousCloseSeconds = state.closeSeconds;
    const openClipForTest = (object, clipIndex) => {
        selectObject(object);
        if (!selectAnimation(clipIndex)) {
            return false;
        }
        setAnimationSecondsForTest(ANIMATION_SECONDS_MIN);
        return startTimedOpening();
    };
    closeAllOpenedAnimations();
    result.secondsPerTransition = setAnimationSecondsForTest(ANIMATION_SECONDS_MIN);
    if (!openClipForTest(pair.objectA, pair.clipA)) {
        result.message = "Не удалось запустить открытие клипа A.";
        return result;
    }
    if (!await waitForClipPose(pair.clipA, true, 90)) {
        result.message = "Клип A не дошёл до открытой позы.";
        return result;
    }
    result.multiOpenA = getClipTime(pair.clipA);
    result.multiOpenBTimeAfterA = getClipTime(pair.clipB);
    if (!openClipForTest(pair.objectB, pair.clipB)) {
        result.message = "Не удалось запустить открытие клипа B.";
        return result;
    }
    if (!await waitForClipPose(pair.clipB, true, 90)) {
        result.message = "Клип B не дошёл до открытой позы.";
        return result;
    }
    result.multiOpenB = getClipTime(pair.clipB);
    result.multiOpenATimeAfterB = getClipTime(pair.clipA);
    result.openClipCount = state.openClipIndices.size;
    result.animatingClipCount = state.animatingClipIndices.size;
    result.openClipIndexes = Array.from(state.openClipIndices).sort((first, second) => first - second);
    result.multiOpenPreserved = result.openClipCount === 2 &&
        result.multiOpenATimeAfterB >= result.openPoseA - ANIMATION_SECONDS_EPSILON &&
        result.multiOpenB >= result.openPoseB - ANIMATION_SECONDS_EPSILON &&
        state.openClipIndices.has(pair.clipA) && state.openClipIndices.has(pair.clipB);
    if (!startTimedClosing()) {
        result.message = "Не удалось запустить закрытие клипа B.";
        return result;
    }
    if (!await waitForClipPose(pair.clipB, false, 90)) {
        result.message = "Клип B не дошёл до закрытой позы.";
        return result;
    }
    result.closeTimeB = getClipTime(pair.clipB);
    result.multiOpenATimeAfterCloseB = getClipTime(pair.clipA);
    result.closedOnlySelected = Math.abs(result.closeTimeB) <= ANIMATION_SECONDS_EPSILON &&
        result.multiOpenATimeAfterCloseB >= result.openPoseA - ANIMATION_SECONDS_EPSILON &&
        state.openClipIndices.has(pair.clipA) && !state.openClipIndices.has(pair.clipB);
    result.preservedOpenClips = state.openClipIndices.size;
    if (!selectAnimation(pair.clipB) || !startTimedOpening()) {
        result.message = "Не удалось повторно открыть клип B.";
        return result;
    }
    if (!await waitForClipPose(pair.clipB, true, 90)) {
        result.message = "Клип B не дошёл до открытой позы при повторном открытии.";
        return result;
    }
    result.finalOpenClipCount = state.openClipIndices.size;
    result.finalAnimatingClipCount = state.animatingClipIndices.size;
    result.framedOpenParts = frameOpenAnimatedParts();
    result.valid = result.multiOpenPreserved && result.closedOnlySelected &&
        result.finalOpenClipCount === 2 && result.finalAnimatingClipCount === 0;
    result.message = result.valid
        ? "Две детали открыты одновременно, закрытие выбранного клипа не влияет на ранее открытый."
        : "Мульти-открытие не подтверждено измерениями времени клипов.";
    state.openSeconds = previousOpenSeconds;
    state.closeSeconds = previousCloseSeconds;
    elements.animationOpenSeconds.value = formatAnimationSeconds(previousOpenSeconds);
    elements.animationCloseSeconds.value = formatAnimationSeconds(previousCloseSeconds);
    updateAnimationTimingControls();
    return result;
}

function captureFramePixels() {
    const gl = state.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const total = Math.max(width * height, 0);
    const pixels = new Uint8Array(total * 4);
    updateBeamLight();
    state.scene.updateMatrixWorld(true);
    state.camera.updateMatrixWorld(true);
    if (state.displayMode === "transparent" && state.modelRoot) {
        updateTransparentRenderOrder();
    }
    state.renderer.render(state.scene, state.camera);
    gl.finish();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { width, height, total, pixels };
}

function countNonBackgroundPixels(frame) {
    const backgroundHex = state.scene.background && state.scene.background.isColor
        ? state.scene.background.getHex(state.THREE.SRGBColorSpace)
        : DEFAULT_BACKGROUND_COLOR;
    const background = {
        r: (backgroundHex >> 16) & 255,
        g: (backgroundHex >> 8) & 255,
        b: backgroundHex & 255
    };
    let count = 0;
    for (let offset = 0; offset < frame.pixels.length; offset += 4) {
        if (Math.abs(frame.pixels[offset] - background.r) > 8 ||
            Math.abs(frame.pixels[offset + 1] - background.g) > 8 ||
            Math.abs(frame.pixels[offset + 2] - background.b) > 8) {
            count += 1;
        }
    }
    return count;
}

function compareFramePixels(first, second, threshold = 8) {
    let changedPixelCount = 0;
    let maxChannelDelta = 0;
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    for (let offset = 0; offset < first.pixels.length; offset += 4) {
        const delta = Math.max(
            Math.abs(first.pixels[offset] - second.pixels[offset]),
            Math.abs(first.pixels[offset + 1] - second.pixels[offset + 1]),
            Math.abs(first.pixels[offset + 2] - second.pixels[offset + 2]));
        if (delta > maxChannelDelta) {
            maxChannelDelta = delta;
        }
        if (delta > threshold) {
            changedPixelCount += 1;
        }
        redSum += second.pixels[offset];
        greenSum += second.pixels[offset + 1];
        blueSum += second.pixels[offset + 2];
    }
    const total = Math.max(first.total, 1);
    return {
        changedPixelCount,
        changedPixelPercent: first.total > 0 ? changedPixelCount * 100 / first.total : 0,
        maxChannelDelta,
        meanRed: redSum / total,
        meanGreen: greenSum / total,
        meanBlue: blueSum / total
    };
}

function captureBeamMaterialSignature() {
    const meshes = getModelMeshes();
    const items = [];
    for (const mesh of meshes) {
        for (const material of getMeshMaterials(mesh.material)) {
            items.push([
                material.color ? material.color.getHex(state.THREE.SRGBColorSpace) : 0,
                material.emissive ? material.emissive.getHex(state.THREE.SRGBColorSpace) : 0,
                Number(material.emissiveIntensity),
                Number(material.roughness),
                Number(material.metalness),
                Number(material.opacity)
            ].join(":"));
        }
    }
    return `${meshes.length}|${items.length}|${items.join("|")}`;
}

function isSameDirection(first, second, epsilon = 1e-6) {
    return Boolean(first) && Boolean(second) &&
        Math.abs(first.x - second.x) <= epsilon &&
        Math.abs(first.y - second.y) <= epsilon &&
        Math.abs(first.z - second.z) <= epsilon;
}

function getBeamStateSummary() {
    const beam = state.beam;
    const observer = getBeamObserverDiagnostics();
    return {
        enabled: beam.enabled,
        kelvin: Math.round(beam.kelvin),
        intensity: Number(beam.intensity.toFixed(2)),
        saturation: Number(beam.saturation.toFixed(2)),
        directionLabel: "свет от наблюдателя",
        direction: observer && getBeamObserverDirectionVector() ? vectorData(getBeamObserverDirectionVector()) : null,
        color: colorToHexPadded(getBeamColorHex(beam.kelvin, beam.saturation)),
        lightPositionDeviation: observer ? observer.positionDeviation : null,
        lightTargetDeviation: observer ? observer.targetDeviation : null,
        observerAngleDeg: observer ? observer.angleDeg : null,
        gizmoObjectCount: countLightManipulatorObjects(),
        glowEnabled: Boolean(state.selectedObject && state.glowProfiles.get(state.selectedObject) && state.glowProfiles.get(state.selectedObject).enabled),
        selectedName: state.selectedObject ? getObjectName(state.selectedObject) : null
    };
}

function applyLightStateCommand(message) {
    if (message.reset === true) {
        resetBeamSettings();
    }
    setBeamControlValues(message);
    if (typeof message.enabled === "boolean") {
        setBeamEnabled(message.enabled);
    }
    if (typeof message.view === "string") {
        const appliedView = placeBeamObserverView(message.view);
        if (!appliedView) {
            throw new Error(`Неизвестный ракурс наблюдателя для снимка: ${message.view}`);
        }
    }
    if (message.resetView === true) {
        closeAllOpenedAnimations();
        selectObject(null);
        clearAllGlow();
        resetCamera();
    }
    if (message.highlight === true) {
        const target = findSelectionOutlineTarget();
        if (target) {
            selectObject(target);
            setGlowEnabled(target, true);
        }
    }
    if (typeof message.backgroundColor === "string") {
        applyBackgroundColor(message.backgroundColor);
    }
    const summary = getBeamStateSummary();
    setStatus(`Свет от наблюдателя: ${summary.enabled ? "включён" : "выключен"}, ${summary.kelvin} К, цвет ${summary.color}, отклонение от камеры ${summary.lightPositionDeviation}.`);
    return summary;
}

async function testBeamRig() {
    const result = {
        valid: false,
        defaultValid: false,
        kelvin: null,
        kelvinColorHex: null,
        keyColorHex: null,
        colorMatchesKelvin: false,
        enabled: false,
        intensity: null,
        hemisphereIntensity: null,
        ambientIntensity: null,
        hemisphereLightCount: 0,
        directionalLightCount: 0,
        ambientLightCount: 0,
        pointLightCount: 0,
        spotLightCount: 0,
        rectAreaLightCount: 0,
        shadowCasterCount: 0,
        gizmoObjects: 0,
        gizmoObjectCount: 0,
        lightObserverPositionMatchesCamera: false,
        lightTargetMatchesControls: false,
        lightPositionDeviation: null,
        lightTargetDeviation: null,
        observerAngleDeg: null,
        observerAngleValid: false,
        defaultObserverDirection: null,
        defaultViewForwardDirection: null,
        directionLabel: "свет от наблюдателя",
        darkLuminanceLimit: BEAM_DARK_LUMINANCE_LIMIT,
        darkPixelPercentLimit: BEAM_DARK_PIXEL_PERCENT_MAX,
        maxDarkPixelPercent: null,
        viewCount: 0,
        views: [],
        viewsDarkPixelPercentValid: false,
        viewsLightChangesImage: false,
        viewsObserverAngleValid: false,
        viewsGizmoFree: false,
        lightFollowsCameraAcrossViews: false,
        strayMarkersBefore: 0,
        strayMarkersAfter: 0,
        selectionHelperCount: 0,
        boxHelperCount: 0,
        wireframeOverlayValid: false,
        discoveredLineSegmentCount: 0,
        lineSegmentCount: 0,
        materialsUnchangedByLight: false,
        lightDisabledIntensity: null,
        lightDisabledNonBackgroundPercentage: 0,
        lightDisabledImageReadable: false,
        lightOnNonBackgroundPercentage: 0,
        lightChangesImage: false,
        message: "Проверка источника света не выполнена."
    };
    if (!state.modelRoot || !state.renderer || !state.beam.light) {
        result.message = "Модель или основной источник света не загружены.";
        return result;
    }
    resetBeamSettings();
    resetCamera();
    await waitForRenderFrame();
    const markersBefore = getMarkerDiagnostics();
    result.strayMarkersBefore = markersBefore.strayMarkers;
    const baseLights = getBaseLightDiagnostics();
    result.hemisphereLightCount = baseLights.hemisphereCount;
    result.directionalLightCount = baseLights.directionalCount;
    result.ambientLightCount = baseLights.ambientCount;
    result.pointLightCount = baseLights.pointCount;
    result.spotLightCount = baseLights.spotCount;
    result.rectAreaLightCount = baseLights.rectAreaCount;
    result.shadowCasterCount = baseLights.shadowCasterCount;
    result.hemisphereIntensity = baseLights.hemisphereIntensity;
    result.ambientIntensity = baseLights.ambientIntensity;
    const defaultRig = getBeamRigDiagnostics();
    result.defaultValid = defaultRig.valid;
    result.kelvin = defaultRig.kelvin;
    result.kelvinColorHex = defaultRig.kelvinColorHex;
    result.keyColorHex = defaultRig.lightColor;
    result.colorMatchesKelvin = defaultRig.colorMatchesKelvin;
    result.enabled = defaultRig.enabled;
    result.intensity = defaultRig.lightIntensity;
    result.defaultObserverDirection = defaultRig.travelDirection;
    result.defaultViewForwardDirection = defaultRig.viewForwardDirection;
    result.lightObserverPositionMatchesCamera = defaultRig.lightObserverPositionMatchesCamera;
    result.lightTargetMatchesControls = defaultRig.lightTargetMatchesControls;
    result.lightPositionDeviation = defaultRig.lightPositionDeviation;
    result.lightTargetDeviation = defaultRig.lightTargetDeviation;
    result.observerAngleDeg = defaultRig.observerAngleDeg;
    result.observerAngleValid = defaultRig.observerAngleValid;
    result.gizmoObjects = defaultRig.gizmoObjectCount;
    result.gizmoObjectCount = defaultRig.gizmoObjectCount;
    const materialsBefore = captureBeamMaterialSignature();
    const frameDefault = captureFramePixels();
    result.lightOnNonBackgroundPercentage = frameDefault.total > 0
        ? countNonBackgroundPixels(frameDefault) * 100 / frameDefault.total
        : 0;
    setBeamEnabled(false);
    await waitForRenderFrame();
    const frameLightOff = captureFramePixels();
    result.lightDisabledIntensity = Number(state.beam.light.intensity);
    result.lightDisabledNonBackgroundPercentage = frameLightOff.total > 0
        ? countNonBackgroundPixels(frameLightOff) * 100 / frameLightOff.total
        : 0;
    result.lightDisabledImageReadable = result.lightDisabledNonBackgroundPercentage >= 1;
    result.lightChangesImage = compareFramePixels(frameLightOff, frameDefault).changedPixelCount > 0;
    setBeamEnabled(true);
    const views = await measureObserverLightViews();
    result.views = views;
    result.viewCount = views.length;
    result.maxDarkPixelPercent = views.length > 0
        ? Math.round(Math.max(...views.map(view => view.darkPixelPercent)) * 10000) / 10000
        : null;
    result.viewsDarkPixelPercentValid = views.length === BEAM_OBSERVER_VIEW_PLANS.length &&
        views.every(view => view.darkPixelPercentValid);
    result.viewsLightChangesImage = views.length > 0 && views.every(view => view.lightChangesImage && view.darkPixelPercentWithLightBetter);
    result.viewsObserverAngleValid = views.length > 0 && views.every(view => view.observerAngleValid &&
        view.lightPositionDeviation < BEAM_OBSERVER_POSITION_EPSILON &&
        view.lightTargetDeviation < BEAM_OBSERVER_POSITION_EPSILON);
    result.viewsGizmoFree = views.length > 0 && views.every(view => view.gizmoObjectCount === 0);
    result.lightFollowsCameraAcrossViews = result.viewsObserverAngleValid;
    const materialsAfter = captureBeamMaterialSignature();
    result.materialsUnchangedByLight = materialsBefore === materialsAfter;
    resetCamera();
    await waitForRenderFrame();
    const restoredRig = getBeamRigDiagnostics();
    const markersAfter = getMarkerDiagnostics();
    const wireframe = getWireframeOverlayDiagnostics();
    result.strayMarkersAfter = markersAfter.strayMarkers;
    result.selectionHelperCount = state.selectionHelper ? 1 : 0;
    result.boxHelperCount = countBoxHelpers(state.modelRoot);
    result.wireframeOverlayValid = wireframe.valid;
    result.discoveredLineSegmentCount = wireframe.discoveredLineSegmentCount;
    result.lineSegmentCount = wireframe.lineSegmentCount;
    result.valid = result.defaultValid && result.colorMatchesKelvin && result.enabled === true &&
        Math.abs(Number(result.intensity) - BEAM_INTENSITY_DEFAULT) <= 1e-9 &&
        Math.round(Number(result.kelvin)) === BEAM_KELVIN_DEFAULT &&
        result.hemisphereLightCount === 1 && result.directionalLightCount === 1 && result.ambientLightCount === 1 &&
        result.pointLightCount === 0 && result.spotLightCount === 0 && result.rectAreaLightCount === 0 &&
        result.shadowCasterCount === 0 &&
        Math.abs(Number(result.hemisphereIntensity) - BASE_LIGHT_FILL_INTENSITY) <= 1e-9 &&
        Math.abs(Number(result.ambientIntensity) - BASE_LIGHT_AMBIENT_INTENSITY) <= 1e-9 &&
        result.gizmoObjects === 0 && result.gizmoObjectCount === 0 &&
        result.lightObserverPositionMatchesCamera && result.lightTargetMatchesControls &&
        result.observerAngleValid && result.lightFollowsCameraAcrossViews &&
        result.viewCount === BEAM_OBSERVER_VIEW_PLANS.length &&
        result.viewsDarkPixelPercentValid && result.viewsLightChangesImage &&
        result.viewsGizmoFree && result.materialsUnchangedByLight &&
        result.lightDisabledImageReadable && result.lightChangesImage && restoredRig.valid &&
        result.strayMarkersBefore === 0 && result.strayMarkersAfter === 0 &&
        result.selectionHelperCount === 0 && result.boxHelperCount === 0 &&
        result.wireframeOverlayValid && result.discoveredLineSegmentCount === result.lineSegmentCount;
    result.message = result.valid
        ? `Свет от наблюдателя: цвет ${result.kelvinColorHex} при ${result.kelvin} К, отклонение позиции света от камеры ${result.lightPositionDeviation}, цель света совпадает с точкой обзора (отклонение ${result.lightTargetDeviation}), наклон света к камере ${result.observerAngleDeg}°, заполняющий hemisphere=${result.hemisphereIntensity} и ambient=${result.ambientIntensity}, манипулятора в сцене нет: ${result.gizmoObjectCount} объектов; тёмные пиксели модели (яркость < ${result.darkLuminanceLimit}): ${views.map(view => `${view.label} ${view.darkPixelPercent}%`).join(", ")}.`
        : "Проверка источника света не пройдена: проверьте положение света относительно камеры, цель света, наклон к камере, отсутствие манипулятора и долю тёмных пикселей на ракурсах.";
    return result;
}

async function testPartSelectionAndGlow() {
    const artifacts = getInspectorPanelArtifacts();
    const result = {
        pickTargetCount: state.pickTargets.length,
        lightPanelRemoved: artifacts.length === 0,
        lightPanelArtifacts: artifacts,
        baseLightingValid: getBaseLightDiagnostics().valid,
        measurementValid: false,
        dimensionsMm: null,
        localDimensionsMm: null,
        worldSize: null,
        triangleCount: 0,
        meshCount: 0,
        animatedPart: false,
        pickSuccess: false,
        pickTested: 0,
        pickSampled: 0,
        pickFirstOther: null,
        pickClickCount: 0,
        pickStackIndex: -1,
        pickStackCount: 0,
        markerClickTested: 0,
        markerClickSampleCount: 0,
        markerClickSkippedWithoutGeometry: 0,
        markerClickParentReachable: 0,
        markerClickParentMeshReachable: 0,
        markerClickParentBoundsReachable: 0,
        markerClickSamePart: 0,
        markerClickOtherPart: 0,
        markerClickHelperHits: 0,
        markerClickMissCount: 0,
        markerClickSampleLog: [],
        markerClickValid: false,
        glowValid: false,
        glowCloneApplied: false,
        glowIsolationPart: null,
        glowChangedMaterials: 0,
        glowEmissiveHex: null,
        glowIntensity: null,
        glowColorMatchesKelvin: false,
        glowIsolated: false,
        glowPersistsAfterDeselect: false,
        glowOtherOwnState: false,
        glowTargetRestoresProfile: false,
        glowRestoreRestoredMaterial: false,
        glowMaterialsCleared: false,
        message: "В модели не найдены детали для проверки выбора и подсветки."
    };
    const candidates = findSelectionTestCandidates();
    const target = candidates.panelWithFirstAnimation || candidates.animated || candidates.hardware;
    const other = findDistinctPartObject(target);
    if (!target) {
        return result;
    }
    state.scene.updateMatrixWorld(true);
    selectObject(target);
    await waitForRenderFrame();
    const measurements = getPartMeasurements(target);
    result.measurementValid = measurements.valid && measurements.triangleCount > 0 && measurements.meshCount > 0;
    result.dimensionsMm = measurements.worldSizeMm;
    result.localDimensionsMm = measurements.localSizeMm;
    result.worldSize = measurements.worldSize;
    result.triangleCount = measurements.triangleCount;
    result.meshCount = measurements.meshCount;
    result.animatedPart = measurements.animated;
    const pick = await testViewportPick(target);
    result.pickSuccess = pick.success;
    result.pickTested = pick.tested;
    result.pickSampled = pick.sampled;
    result.pickFirstOther = pick.firstOther;
    result.pickClickCount = pick.clicks;
    result.pickStackIndex = pick.stackIndex;
    result.pickStackCount = pick.stackCount;
    const markers = testMarkerClicks();
    result.markerClickTested = markers.tested;
    result.markerClickSampleCount = markers.samplesTested;
    result.markerClickSkippedWithoutGeometry = markers.skippedWithoutGeometry;
    result.markerClickParentReachable = markers.reachableThroughMarker;
    result.markerClickParentMeshReachable = markers.reachableThroughMesh;
    result.markerClickParentBoundsReachable = markers.reachableThroughDeclaredBounds;
    result.markerClickSamePart = markers.samePart;
    result.markerClickOtherPart = markers.otherPart;
    result.markerClickHelperHits = markers.helperHits;
    result.markerClickMissCount = markers.missCount;
    result.markerClickSampleLog = markers.samples;
    result.markerClickValid = markers.success;
    selectObject(null);
    const glow = testGlowToggle(target, other);
    result.glowValid = glow.success;
    result.glowIsolationPart = other ? getObjectName(other) : null;
    result.glowCloneApplied = glow.cloneApplied;
    result.glowChangedMaterials = glow.changedMaterials;
    result.glowEmissiveHex = glow.emissiveHex;
    result.glowIntensity = glow.intensity;
    result.glowColorMatchesKelvin = glow.colorMatchesKelvin;
    result.glowIsolated = glow.isolated;
    result.glowPersistsAfterDeselect = glow.persistsAfterDeselect;
    result.glowOtherOwnState = glow.otherOwnState;
    result.glowTargetRestoresProfile = glow.targetRestoresProfile;
    result.glowRestoreRestoredMaterial = glow.restoredOriginals;
    result.glowMaterialsCleared = glow.noGlowMaterials;
    result.message = "Габариты в мм, выбор детали кликом и подсветка детали проверены.";
    return result;
}

async function testAnimationTimingControls() {
    const result = {
        valid: false,
        timingBlockPresent: false,
        openInputPresent: false,
        closeInputPresent: false,
        inputsInsideToolbar: false,
        openInputLabel: null,
        closeInputLabel: null,
        openInputMinimum: 0,
        openInputMaximum: 0,
        closeInputMinimum: 0,
        closeInputMaximum: 0,
        timingInputsEnabled: false,
        defaultOpenSeconds: ANIMATION_SECONDS_DEFAULT,
        defaultCloseSeconds: ANIMATION_SECONDS_DEFAULT,
        defaultOpenInput: null,
        defaultCloseInput: null,
        clipCount: 0,
        activeClipIndex: -1,
        appliedOpenSeconds: null,
        appliedCloseSeconds: null,
        openTimeScaleApplied: false,
        openPoseReached: false,
        closeTimeScaleApplied: false,
        defaultsAfterClipChange: false,
        alternateClipIndex: -1,
        restoredDefaultOpen: null,
        restoredDefaultClose: null,
        skippedNoAnimations: false,
        message: "Время анимации в панели инструментов не проверено."
    };
    const openInput = elements.animationOpenSeconds;
    const closeInput = elements.animationCloseSeconds;
    if (!openInput || !closeInput) {
        result.message = "Поля времени анимации отсутствуют в панели инструментов.";
        return result;
    }
    result.openInputPresent = true;
    result.closeInputPresent = true;
    result.timingBlockPresent = Boolean(elements.toolbarTiming);
    result.inputsInsideToolbar = openInput.closest(".viewport-toolbar") !== null &&
        closeInput.closest(".viewport-toolbar") !== null;
    result.timingInputsEnabled = !openInput.disabled && !closeInput.disabled;
    result.timingInputsExpected = state.clips.length > 0;
    result.openInputLabel = getAnimationTimingLabel("animation-open-seconds");
    result.closeInputLabel = getAnimationTimingLabel("animation-close-seconds");
    result.openInputMinimum = Number(openInput.min);
    result.openInputMaximum = Number(openInput.max);
    result.closeInputMinimum = Number(closeInput.min);
    result.closeInputMaximum = Number(closeInput.max);
    result.clipCount = state.clips.length;
    if (state.clips.length === 0) {
        result.skippedNoAnimations = true;
        result.defaultOpenInput = openInput.value;
        result.defaultCloseInput = closeInput.value;
        const controlsValid = result.timingBlockPresent && result.inputsInsideToolbar &&
            !result.timingInputsEnabled &&
            result.openInputLabel === "Открытие, с" && result.closeInputLabel === "Закрытие, с" &&
            result.openInputMinimum === ANIMATION_SECONDS_MIN && result.openInputMaximum === ANIMATION_SECONDS_MAX &&
            result.closeInputMinimum === ANIMATION_SECONDS_MIN && result.closeInputMaximum === ANIMATION_SECONDS_MAX &&
            result.defaultOpenInput === formatAnimationSeconds(ANIMATION_SECONDS_DEFAULT) &&
            result.defaultCloseInput === formatAnimationSeconds(ANIMATION_SECONDS_DEFAULT) &&
            state.openSeconds === ANIMATION_SECONDS_DEFAULT && state.closeSeconds === ANIMATION_SECONDS_DEFAULT;
        result.valid = controlsValid;
        result.message = controlsValid
            ? "Пропущено по времени клипа: в модели 0 клипов, у полей «Открытие, с» и «Закрытие, с» сохранены пределы 0.05…60 с и значения 1.00 с, поля заблокированы, так как применять время не к чему."
            : "Поля времени анимации в панели инструментов не соответствуют состоянию модели без анимаций.";
        return result;
    }
    closeAllOpenedAnimations();
    setAnimationTimingDefaults();
    result.defaultOpenInput = openInput.value;
    result.defaultCloseInput = closeInput.value;
    const pair = findAnimationTestPair();
    const target = pair ? pair.objectA : findSelectionOutlineTarget();
    const binding = target ? findAnimationBinding(target) : { valid: false };
    if (!binding.valid) {
        result.message = "В модели не найдена деталь с привязанной анимацией для проверки времени.";
        return result;
    }
    closeAllOpenedAnimations();
    selectObject(target);
    selectAnimation(binding.clipIndex);
    result.activeClipIndex = state.activeClipIndex;
    const openSeconds = 0.5;
    const closeSeconds = 2;
    setAnimationSecondsForTest(openSeconds);
    elements.animationCloseSeconds.value = formatAnimationSeconds(closeSeconds);
    updateAnimationTimingSettings();
    result.appliedOpenSeconds = state.openSeconds;
    result.appliedCloseSeconds = state.closeSeconds;
    const expectedOpenScale = state.openPoseTime / state.openSeconds;
    if (startTimedOpening()) {
        const scale = Number(state.activeAction.getEffectiveTimeScale());
        result.openTimeScaleApplied = Math.abs(scale - expectedOpenScale) <= 1e-6;
        result.openPoseReached = await waitForClipPose(state.activeClipIndex, true, 240);
        if (result.openPoseReached) {
            const expectedCloseScale = -state.openPoseTime / state.closeSeconds;
            if (startTimedClosing()) {
                const closeScale = Number(state.activeAction.getEffectiveTimeScale());
                result.closeTimeScaleApplied = Math.abs(closeScale - expectedCloseScale) <= 1e-6;
                await waitForClipPose(state.activeClipIndex, false, 240);
            }
        }
    }
    const alternateClipIndex = findAlternateClipIndex(binding.clipIndex);
    result.alternateClipIndex = alternateClipIndex;
    if (alternateClipIndex !== null) {
        selectAnimation(alternateClipIndex);
        result.defaultsAfterClipChange = state.openSeconds === ANIMATION_SECONDS_DEFAULT &&
            state.closeSeconds === ANIMATION_SECONDS_DEFAULT &&
            elements.animationOpenSeconds.value === formatAnimationSeconds(ANIMATION_SECONDS_DEFAULT) &&
            elements.animationCloseSeconds.value === formatAnimationSeconds(ANIMATION_SECONDS_DEFAULT);
        selectAnimation(binding.clipIndex);
    }
    closeAllOpenedAnimations();
    setAnimationTimingDefaults();
    result.restoredDefaultOpen = state.openSeconds;
    result.restoredDefaultClose = state.closeSeconds;
    selectObject(null);
    result.valid = result.timingBlockPresent && result.inputsInsideToolbar && result.timingInputsEnabled &&
        result.openInputLabel === "Открытие, с" && result.closeInputLabel === "Закрытие, с" &&
        result.openInputMinimum === ANIMATION_SECONDS_MIN && result.openInputMaximum === ANIMATION_SECONDS_MAX &&
        result.closeInputMinimum === ANIMATION_SECONDS_MIN && result.closeInputMaximum === ANIMATION_SECONDS_MAX &&
        result.defaultOpenInput === formatAnimationSeconds(ANIMATION_SECONDS_DEFAULT) &&
        result.defaultCloseInput === formatAnimationSeconds(ANIMATION_SECONDS_DEFAULT) &&
        result.appliedOpenSeconds === openSeconds && result.appliedCloseSeconds === closeSeconds &&
        result.openTimeScaleApplied && result.openPoseReached && result.closeTimeScaleApplied &&
        result.defaultsAfterClipChange &&
        result.restoredDefaultOpen === ANIMATION_SECONDS_DEFAULT && result.restoredDefaultClose === ANIMATION_SECONDS_DEFAULT;
    result.message = result.valid
        ? `Время анимации: поля «Открытие, с» и «Закрытие, с» в панели инструментов (${result.openInputMinimum}…${result.openInputMaximum} с); клип ${result.activeClipIndex} открыт за ${result.appliedOpenSeconds} с и закрыт за ${result.appliedCloseSeconds} с, смена клипа на ${result.alternateClipIndex} вернула значения по умолчанию ${result.defaultOpenSeconds} с.`
        : "Поля времени анимации в панели инструментов не подтверждены измерениями.";
    return result;
}

async function testStatusLine() {
    const result = {
        valid: false,
        statusBarPresent: false,
        statusBarElementCount: 0,
        statusBarIsSingleLine: false,
        removedSummaryElements: 0,
        statusWithoutSelection: null,
        selectedName: null,
        statusWithSelection: null,
        statusHasNoDimensions: false,
        blockStatus: null,
        blockStatusIsShort: false,
        statusAfterDeselect: null,
        message: "Строка статуса не проверена."
    };
    if (!elements.statusBar || !elements.statusText) {
        result.message = "В статус-баре нет строки статуса.";
        return result;
    }
    result.statusBarPresent = true;
    result.statusBarElementCount = elements.statusBar.children.length;
    result.statusBarIsSingleLine = result.statusBarElementCount === 1 &&
        elements.statusBar.firstElementChild === elements.statusText;
    result.removedSummaryElements = ["selection-summary", "renderer-summary"]
        .filter(id => document.getElementById(id) !== null).length;
    selectObject(null);
    result.statusWithoutSelection = elements.statusText.textContent;
    if (!state.modelRoot) {
        result.message = "Модель не загружена.";
        return result;
    }
    const target = findSelectionOutlineTarget();
    if (!target) {
        result.message = "В модели не найдены детали для проверки строки статуса.";
        return result;
    }
    selectObject(target);
    await waitForRenderFrame();
    result.selectedName = getObjectName(target);
    result.statusWithSelection = elements.statusText.textContent;
    result.statusHasNoDimensions = !/\d+(\.\d+)? × \d+(\.\d+)? × \d+(\.\d+)? мм/.test(result.statusWithSelection);
    const block = Array.from(state.treeBlocks.values()).find(item => item.objects.length > 0) || null;
    if (block) {
        selectBlock(block);
        await waitForRenderFrame();
        result.blockStatus = elements.statusText.textContent;
        result.blockStatusIsShort = result.blockStatus === getBlockSelectionStatus(block);
    }
    selectObject(null);
    result.statusAfterDeselect = elements.statusText.textContent;
    result.valid = result.statusBarIsSingleLine && result.removedSummaryElements === 0 &&
        result.statusHasNoDimensions && result.blockStatus !== null && result.blockStatusIsShort &&
        result.statusAfterDeselect !== result.statusWithSelection;
    result.message = result.valid
        ? `Статус-бар: один элемент, короткая строка «${result.statusWithSelection}», при выборе блока «${result.blockStatus}» без пояснений.`
        : "Строка статуса не подтверждена.";
    return result;
}

async function testNoAnimationModelHandling() {
    const result = {
        valid: false,
        clipCount: state.clips.length,
        mixerCreated: state.mixer !== null,
        animationRootCount: getAnimationRootObjects().length,
        boundPartCount: 0,
        declaredFirstParts: getAnimationBindingDiagnostics().declaredFirstParts,
        selectedNode: null,
        treeValid: false,
        treeBlockCount: 0,
        treeGroupCount: 0,
        treeRowCount: 0,
        pickTargetCount: state.pickTargets.length,
        selectionOutlineCount: 0,
        selectionOutlineVisibleCount: 0,
        deselectOutlineCount: null,
        dimensionsMm: null,
        displayModesValid: false,
        displayModeCount: 0,
        displayMode: state.displayMode,
        statusWithSelection: null,
        statusAfterDeselect: null,
        statusReportsNoAnimations: false,
        animationInputsDisabled: false,
        openClipCount: 0,
        animatingClipCount: 0,
        activeClipIndex: state.activeClipIndex,
        animationDirection: state.animationDirection,
        doorOpen: state.doorOpen,
        animationBindingValid: false,
        animationBindingSkippedNoAnimations: false,
        markerMotionSkippedNoAnimations: false,
        markersValid: false,
        strayMarkers: 0,
        message: "Проверка модели без анимаций не выполнена."
    };
    if (!state.modelRoot) {
        result.message = "Модель не загружена.";
        return result;
    }
    const binding = getAnimationBindingDiagnostics();
    result.animationBindingValid = binding.valid;
    result.animationBindingSkippedNoAnimations = binding.skippedNoAnimations;
    const markers = getMarkerDiagnostics();
    result.markersValid = markers.valid;
    result.strayMarkers = markers.strayMarkers;
    result.boundPartCount = markers.animationBinding ? markers.animationBinding.boundNegativeParts : 0;
    result.markerMotionSkippedNoAnimations = Boolean(markers.motionProbe && markers.motionProbe.skippedNoAnimations);
    const tree = getTreeDiagnostics();
    result.treeValid = tree.valid;
    result.treeBlockCount = tree.selectableBlockGroupCount;
    result.treeGroupCount = tree.groupCount;
    result.treeRowCount = state.treeButtons.size;
    const displayModes = testDisplayModes();
    result.displayModeCount = DISPLAY_MODE_IDS.length;
    result.displayModesValid = DISPLAY_MODE_IDS.every(mode => displayModes[mode] && displayModes[mode].valid) &&
        DISPLAY_MODE_IDS.length === DISPLAY_MODES.length;
    result.displayMode = state.displayMode;
    const target = findSelectionOutlineTarget();
    if (target) {
        result.selectedNode = getObjectName(target);
        selectObject(target);
        await waitForRenderFrame();
        const selected = getSelectionOutlineDiagnostics();
        result.selectionOutlineCount = selected.count;
        result.selectionOutlineVisibleCount = selected.visibleCount;
        result.statusWithSelection = elements.statusText ? elements.statusText.textContent : null;
        const measurements = getPartMeasurements(target);
        result.dimensionsMm = measurements.valid ? measurements.worldSizeMm : null;
        selectObject(null);
        await waitForRenderFrame();
        result.deselectOutlineCount = getSelectionOutlineDiagnostics().count;
        result.statusAfterDeselect = elements.statusText ? elements.statusText.textContent : null;
        result.statusReportsNoAnimations = typeof result.statusWithSelection === "string" &&
            result.statusWithSelection.includes("В модели нет анимаций.");
    }
    result.animationInputsDisabled = elements.animationOpenSeconds.disabled === true &&
        elements.animationCloseSeconds.disabled === true;
    result.openClipCount = state.openClipIndices.size;
    result.animatingClipCount = state.animatingClipIndices.size;
    const noClips = state.clips.length === 0;
    result.valid = noClips && !result.mixerCreated && result.animationRootCount === 0 &&
        result.boundPartCount === 0 && result.declaredFirstParts === 0 &&
        result.animationBindingValid && result.animationBindingSkippedNoAnimations &&
        result.treeValid && result.treeBlockCount > 0 && result.treeRowCount > 0 &&
        result.pickTargetCount > 0 && result.displayModesValid && result.displayMode === DISPLAY_MODE_DEFAULT &&
        Boolean(target) && result.selectionOutlineCount > 0 && result.selectionOutlineVisibleCount > 0 &&
        result.deselectOutlineCount === 0 && result.dimensionsMm !== null && result.statusReportsNoAnimations &&
        result.markersValid && result.strayMarkers === 0 && result.markerMotionSkippedNoAnimations &&
        result.animationInputsDisabled &&
        result.openClipCount === 0 && result.animatingClipCount === 0 &&
        result.activeClipIndex === -1 && result.animationDirection === "closed" && !result.doorOpen;
    result.message = result.valid
        ? `Модель без анимаций обработана без сбоя: клипов 0, микшер не создан, корней анимации 0, привязанных деталей 0, первых анимаций 0; дерево валидно (групп ${result.treeGroupCount}, блоков ${result.treeBlockCount}, строк ${result.treeRowCount}), целей выбора ${result.pickTargetCount}; все ${result.displayModeCount} режима отображения валидны; деталь «${result.selectedNode}» выделяется (контуров ${result.selectionOutlineCount}, видимых ${result.selectionOutlineVisibleCount}) и снимается (${result.deselectOutlineCount}); строка статуса сообщает «${result.statusWithSelection}»; поля времени анимации заблокированы; открытых клипов 0, активный клип ${result.activeClipIndex}, маркеры валидны, stray ${result.strayMarkers}.`
        : "Проверка модели без анимаций не подтверждена.";
    return result;
}

async function testModelWithoutAnimations() {
    const displayModes = testDisplayModes();
    const displayModesValid = DISPLAY_MODE_IDS.every(mode => displayModes[mode] && displayModes[mode].valid) &&
        DISPLAY_MODE_IDS.length === DISPLAY_MODES.length;
    const partTest = await testPartSelectionAndGlow();
    const lightRig = await testBeamRig();
    const lightRigValid = lightRig.valid;
    const multiOpen = await testMultiOpenAnimations();
    const multiOpenValid = multiOpen.skippedNoAnimations && !multiOpen.valid &&
        state.clips.length === 0 && state.openClipIndices.size === 0 && state.animatingClipIndices.size === 0;
    const selectionOutline = await testSelectionOutlineHighlight();
    const selectionOutlineValid = selectionOutline.success;
    const clickSemantics = await testClickSemantics();
    const clickSemanticsValid = clickSemantics.valid && clickSemantics.skippedNoAnimations;
    const escapeClear = await testEscapeClearsSelection();
    const escapeClearValid = escapeClear.valid;
    const pickStack = await testPickStackCycling();
    const pickStackValid = pickStack.valid;
    const treeVisibility = await testTreeBlockVisibility();
    const treeVisibilityValid = treeVisibility.valid;
    const animationTiming = await testAnimationTimingControls();
    const animationTimingValid = animationTiming.valid && animationTiming.skippedNoAnimations;
    const statusLine = await testStatusLine();
    const statusLineValid = statusLine.valid;
    const viewportToolbar = await testViewportToolbar();
    const viewportToolbarValid = viewportToolbar.valid;
    const noAnimationModel = await testNoAnimationModelHandling();
    const partTestValid = partTest.measurementValid && partTest.pickSuccess && partTest.markerClickValid &&
        partTest.glowValid && partTest.glowRestoreRestoredMaterial && partTest.glowIsolated &&
        partTest.glowColorMatchesKelvin && partTest.lightPanelRemoved && partTest.baseLightingValid;
    const visibility = getVisibilityDiagnostics();
    const success = Boolean(displayModesValid && partTestValid && lightRigValid && multiOpenValid &&
        selectionOutlineValid && clickSemanticsValid && escapeClearValid && pickStackValid &&
        treeVisibilityValid && animationTimingValid && statusLineValid && viewportToolbarValid &&
        noAnimationModel.valid);
    return {
        type: "selectionTestResult",
        success,
        skippedNoAnimations: true,
        clipCount: state.clips.length,
        selectedNode: noAnimationModel.selectedNode,
        animationIndex: null,
        panelNode: null,
        panelAnimationIndex: null,
        panelClipIndex: -1,
        panelBindingValid: false,
        loopNode: null,
        loopPartId: null,
        loopPartType: null,
        loopOwnAnimationIndex: null,
        loopBindingValid: false,
        loopSingleSelectKeptClip: true,
        loopHasAnimatedAncestor: false,
        autoOpenSucceeded: false,
        closeSucceeded: false,
        singleSelectActiveClipUnchanged: true,
        singleSelectAutoOpenSucceeded: false,
        singleSelectKeptDirection: true,
        singleSelectDoorOpen: false,
        singleSelectAnimationPlaying: false,
        singleSelectActiveClipIndex: -1,
        clipIndexBeforeSingleSelect: -1,
        doubleToggleOpenSucceeded: false,
        doubleToggleCloseSucceeded: false,
        doubleToggleChangedClip: true,
        doubleToggleActiveClipIndex: -1,
        boundClipIndex: -1,
        openingDirection: null,
        openingTimeScale: null,
        closeDirection: null,
        closingTimeScale: null,
        closeMidTime: null,
        displayModes,
        displayModesValid,
        displayModeCatalog: testDisplayModeCatalog(),
        partTestValid,
        measurementValid: partTest.measurementValid,
        dimensionsMm: partTest.dimensionsMm,
        localDimensionsMm: partTest.localDimensionsMm,
        worldSize: partTest.worldSize,
        triangleCount: partTest.triangleCount,
        meshCount: partTest.meshCount,
        animatedPart: false,
        pickTargetCount: partTest.pickTargetCount,
        pickSuccess: partTest.pickSuccess,
        pickTested: partTest.pickTested,
        partPickClickCount: partTest.pickClickCount,
        partPickStackIndex: partTest.pickStackIndex,
        partPickStackCount: partTest.pickStackCount,
        markerClickTested: partTest.markerClickTested,
        markerClickSampleCount: partTest.markerClickSampleCount,
        markerClickSkippedWithoutGeometry: partTest.markerClickSkippedWithoutGeometry,
        markerClickParentReachable: partTest.markerClickParentReachable,
        markerClickParentMeshReachable: partTest.markerClickParentMeshReachable,
        markerClickParentBoundsReachable: partTest.markerClickParentBoundsReachable,
        markerClickSamePart: partTest.markerClickSamePart,
        markerClickOtherPart: partTest.markerClickOtherPart,
        markerClickHelperHits: partTest.markerClickHelperHits,
        markerClickMissCount: partTest.markerClickMissCount,
        markerClickSampleLog: partTest.markerClickSampleLog,
        markerClickValid: partTest.markerClickValid,
        glowValid: partTest.glowValid,
        glowCloneApplied: partTest.glowCloneApplied,
        glowIsolationPart: partTest.glowIsolationPart,
        glowChangedMaterials: partTest.glowChangedMaterials,
        glowEmissiveHex: partTest.glowEmissiveHex,
        glowIntensity: partTest.glowIntensity,
        glowColorMatchesKelvin: partTest.glowColorMatchesKelvin,
        glowIsolated: partTest.glowIsolated,
        glowPersistsAfterDeselect: partTest.glowPersistsAfterDeselect,
        glowOtherOwnState: partTest.glowOtherOwnState,
        glowTargetRestoresProfile: partTest.glowTargetRestoresProfile,
        glowRestoreRestoredMaterial: partTest.glowRestoreRestoredMaterial,
        glowMaterialsCleared: partTest.glowMaterialsCleared,
        lightPanelRemoved: partTest.lightPanelRemoved,
        lightPanelArtifacts: partTest.lightPanelArtifacts,
        baseLightingValid: partTest.baseLightingValid,
        lightRigValid,
        lightRig,
        lightKelvin: lightRig.kelvin,
        lightKelvinColorHex: lightRig.kelvinColorHex,
        lightIntensity: lightRig.intensity,
        lightGizmoObjects: lightRig.gizmoObjectCount,
        lightObserverPositionMatchesCamera: lightRig.lightObserverPositionMatchesCamera,
        lightTargetMatchesControls: lightRig.lightTargetMatchesControls,
        lightPositionDeviation: lightRig.lightPositionDeviation,
        lightTargetDeviation: lightRig.lightTargetDeviation,
        lightObserverAngleDeg: lightRig.observerAngleDeg,
        lightViewCount: lightRig.viewCount,
        lightMaxDarkPixelPercent: lightRig.maxDarkPixelPercent,
        multiOpenValid,
        multiOpenPreserved: false,
        closedOnlySelected: true,
        multiOpen,
        selectionOutlineValid,
        selectionOutlineCount: selectionOutline.outlineCount,
        selectionOutlineMeshCount: selectionOutline.outlineMeshCount,
        selectionOutlineVisibleCount: selectionOutline.outlineVisibleCount,
        selectionOutlineVisible: selectionOutline.outlineVisible,
        selectionOutlineColor: selectionOutline.outlineColor,
        selectionOutlineBuildMs: selectionOutline.outlineBuildMs,
        selectionOutlineEmissiveMaterialCount: selectionOutline.outlineEmissiveMaterialCount,
        selectionOutlineViewportClick: selectionOutline.selectionFromViewport,
        selectionOutlineTreeClickUsed: selectionOutline.treeClickUsed,
        selectionOutlineClickOutsideTree: selectionOutline.clickOutsideTree,
        selectionOutlineDeselectedCount: selectionOutline.deselectedOutlineCount,
        selectionOutlineDeselectedVisibleCount: selectionOutline.deselectedOutlineVisibleCount,
        selectionOutlineStrayMarkers: selectionOutline.strayMarkers,
        selectionOutlineMarkerPollution: selectionOutline.markerPollution,
        selectionOutlineRaycastStubbed: selectionOutline.raycastStubbed,
        selectionOutlineWireframeValid: selectionOutline.wireframeOverlayValid,
        selectionOutlineSelectionHelperCount: selectionOutline.selectionHelperCount,
        selectionOutlineBoxHelperCount: selectionOutline.boxHelperCount,
        selectionOutlineSelectedName: selectionOutline.selectedName,
        selectionOutlinePixelsColor: selectionOutline.modes.facets ? selectionOutline.modes.facets.pixelCount : 0,
        selectionOutlinePixelsWireframe: selectionOutline.modes.wireframe ? selectionOutline.modes.wireframe.pixelCount : 0,
        selectionOutlinePixelsTransparent: selectionOutline.modes.transparent ? selectionOutline.modes.transparent.pixelCount : 0,
        selectionOutlinePixelsFacets: selectionOutline.modes.facets ? selectionOutline.modes.facets.pixelCount : 0,
        selectionOutlineFrameTimeMs: selectionOutline.modes.facets ? selectionOutline.modes.facets.frameTimeMs : 0,
        selectionOutline,
        clickSemanticsValid,
        clickSemantics,
        singleClickSelected: clickSemantics.singleClickSelected,
        singleClickAutoOpenSucceeded: clickSemantics.singleSelectAutoOpenSucceeded,
        singleClickAnimationPlaying: clickSemantics.singleSelectAnimationPlaying,
        singleClickOutlineCount: clickSemantics.singleClickOutlineCount,
        doubleClickOpenSucceeded: clickSemantics.doubleToggleOpenSucceeded,
        doubleClickCloseSucceeded: clickSemantics.doubleToggleCloseSucceeded,
        helperClickCount: clickSemantics.helperClickCount,
        helperRaycastIntercepted: clickSemantics.helperRaycastIntercepted,
        helperInPickTargets: clickSemantics.helperInPickTargets,
        escapeClearValid,
        escapeClear,
        escapeOutlineCount: escapeClear.outlineCountAfterEscape,
        escapeOutlineVisibleCount: escapeClear.outlineVisibleCountAfterEscape,
        escapeEmissiveMaterialCount: escapeClear.emissiveMaterialCountAfterEscape,
        escapeStatusText: escapeClear.statusAfterEscape,
        escapeStatusCleared: escapeClear.statusClearedAfterEscape,
        escapeNumberInputChanged: escapeClear.numberInputChanged,
        pickStackValid,
        pickStack,
        pickStackCount: pickStack.stackCount,
        pickStackFirstIndex: pickStack.firstIndex,
        pickStackSecondIndex: pickStack.secondIndex,
        pickStackCycles: pickStack.cyclesAfterFullCycle,
        pickStackText: pickStack.summaryText,
        treeVisibilityValid,
        treeVisibility,
        treeVisibilityHiddenCount: visibility.hiddenObjectCount,
        treeVisibilityPickTargetLeak: visibility.pickTargetLeak,
        animationTimingValid,
        animationTiming,
        animationTimingOpenSeconds: animationTiming.appliedOpenSeconds,
        animationTimingCloseSeconds: animationTiming.appliedCloseSeconds,
        animationTimingClipIndex: animationTiming.activeClipIndex,
        animationTimingAlternateClipIndex: animationTiming.alternateClipIndex,
        animationTimingDefaultsAfterClipChange: animationTiming.defaultsAfterClipChange,
        statusLineValid,
        statusLine,
        statusLineText: statusLine.statusWithSelection,
        statusLineBlockText: statusLine.blockStatus,
        statusLineElementCount: statusLine.statusBarElementCount,
        statusLineRemovedSummaryElements: statusLine.removedSummaryElements,
        viewportToolbarValid,
        viewportToolbar,
        toolbarActiveMode: viewportToolbar.activeMode,
        toolbarModeButtonCount: viewportToolbar.modeButtonCount,
        toolbarModeOrder: viewportToolbar.modeOrder,
        toolbarRemovedLabelMatches: viewportToolbar.removedLabelMatches,
        toolbarTimingOpenLabel: viewportToolbar.timingOpenLabel,
        toolbarTimingCloseLabel: viewportToolbar.timingCloseLabel,
        toolbarZoomButtonCount: viewportToolbar.zoomButtonCount,
        toolbarZoomFitAbsent: viewportToolbar.zoomFitAbsent,
        toolbarStatusBarElementCount: viewportToolbar.statusBarElementCount,
        toolbarDistanceBefore: viewportToolbar.distanceBefore,
        toolbarDistanceAfterZoomIn: viewportToolbar.distanceAfterZoomIn,
        toolbarDistanceAfterReset: viewportToolbar.distanceAfterReset,
        toolbarMinimumDistance: viewportToolbar.minimumDistance,
        toolbarMaximumDistance: viewportToolbar.maximumDistance,
        toolbarViewportWidthShown: viewportToolbar.viewportWidthShown,
        toolbarViewportWidthHidden: viewportToolbar.viewportWidthHidden,
        openClipCount: 0,
        animatingClipCount: 0,
        hierarchySource: state.hierarchy.source,
        noAnimationModelValid: noAnimationModel.valid,
        noAnimationModel,
        timing: getAnimationTimingDiagnostics(),
        mixerTime: null,
        message: success
            ? `Модель без анимаций (0 клипов) обработана штатно: выделение одиночным щелчком, выбор насквозь повторным щелчком, три режима отображения в порядке Грани в цвете → Прозрачный → Каркасный, блоки дерева со скрытием, панель инструментов с тремя режимами, кнопками зума и блоком «Время анимации», одна короткая строка статуса, подсветка выделения в окне и видимый источник света проверены. Пропущено как неприменимое: открытие и закрытие анимации двойным щелчком, привязка анимаций, мульти-открытие, применение времени клипа и команды анимации в контекстном меню.`
            : !displayModesValid
                ? "Не удалось проверить режимы отображения на модели без анимаций."
                : !lightRigValid
                    ? lightRig.message
                    : !partTestValid
                        ? "Габариты, выбор детали кликом, отверстия, крепёж или подсветка детали не подтверждены на модели без анимаций."
                        : !selectionOutlineValid
                            ? selectionOutline.message
                            : !clickSemanticsValid
                                ? clickSemantics.message
                                : !escapeClearValid
                                    ? escapeClear.message
                                    : !pickStackValid
                                        ? pickStack.message
                                        : !treeVisibilityValid
                                            ? treeVisibility.message
                                            : !animationTimingValid
                                                ? animationTiming.message
                                                : !statusLineValid
                                                    ? statusLine.message
                                                    : !viewportToolbarValid
                                                        ? viewportToolbar.message
                                                        : noAnimationModel.message
    };
}

async function testFirstAnimatedSelection() {
    if (!state.modelRoot) {
        const result = {
            type: "selectionTestResult",
            success: false,
            selectedNode: null,
            animationIndex: null,
            autoOpenSucceeded: false,
            closeSucceeded: false,
            message: "Модель не загружена."
        };
        sendToHost(result);
        return result;
    }
    const candidates = findSelectionTestCandidates();
    if (candidates.animated === null) {
        const result = state.clips.length === 0
            ? await testModelWithoutAnimations()
            : {
                type: "selectionTestResult",
                success: false,
                selectedNode: null,
                animationIndex: null,
                autoOpenSucceeded: false,
                closeSucceeded: false,
                message: "В модели есть клипы, но не найдены узлы с данными анимации."
            };
        sendToHost(result);
        return result;
    }
    const panelBinding = findAnimationBinding(candidates.panelWithFirstAnimation);
    const panelClipIndex = panelBinding.valid ? panelBinding.clipIndex : -1;
    const panelAnimationIndex = panelBinding.valid ? panelBinding.sourceIndex : null;
    let loopName = null;
    let loopPartId = null;
    let loopPartType = null;
    let loopOwnAnimationIndex = null;
    let loopBindingValid = null;
    let loopSingleSelectKeptClip = null;
    if (candidates.hardware !== null) {
        loopName = getObjectName(candidates.hardware);
        loopPartId = getPartId(candidates.hardware);
        loopPartType = getPartSourceType(candidates.hardware);
        loopOwnAnimationIndex = getOwnAnimationFieldIndex(candidates.hardware);
        const clipBeforeLoopSelect = state.activeClipIndex;
        selectObject(candidates.hardware);
        loopBindingValid = findAnimationBinding(candidates.hardware).valid === true;
        loopSingleSelectKeptClip = state.activeClipIndex === clipBeforeLoopSelect;
    }

    const candidate = candidates.animated;
    const binding = findAnimationBinding(candidate);
    const alternateClipIndex = findAlternateClipIndex(binding.clipIndex);
    if (alternateClipIndex !== null) {
        selectAnimation(alternateClipIndex);
    }
    const clipIndexBeforeSingleSelect = state.activeClipIndex;
    const directionBeforeSingleSelect = state.animationDirection;
    selectObject(candidate);
    await waitForRenderFrame();
    const singleSelectActiveClipUnchanged = state.activeClipIndex === clipIndexBeforeSingleSelect;
    const singleSelectActiveClipIndex = state.activeClipIndex;
    const singleSelectAutoOpenSucceeded = state.selectionDiagnostic.autoOpenSucceeded === true;
    const singleSelectKeptDirection = state.animationDirection === directionBeforeSingleSelect;
    const singleSelectDoorOpen = state.doorOpen;
    const singleSelectAnimationPlaying = state.animationPlaying;

    const toggleResult = toggleAnimatedObject(candidate);
    const doubleToggleOpenSucceeded = toggleResult.toggled === true && toggleResult.opening === true;
    const doubleToggleClipIndex = state.activeClipIndex;
    const openingDirection = state.animationDirection;
    const openingTimeScale = state.activeAction ? Number(state.activeAction.getEffectiveTimeScale()) : null;
    let doubleToggleCloseSucceeded = false;
    let closeDirection = null;
    let closingTimeScale = null;
    let closeMidTime = null;
    if (doubleToggleOpenSucceeded && state.mixer && state.activeAction) {
        completeAnimationOpening();
        const closeResult = toggleAnimatedObject(candidate);
        closeDirection = state.animationDirection;
        closingTimeScale = state.activeAction ? Number(state.activeAction.getEffectiveTimeScale()) : null;
        if (closeResult.toggled === true && closeResult.opening === false && closeDirection === "closing" && closingTimeScale < 0) {
            state.mixer.update(state.closeSeconds * 0.25);
            updateTimedAnimation();
            closeMidTime = Number(state.activeAction.time);
            state.mixer.update(state.closeSeconds * 2);
            updateTimedAnimation();
            doubleToggleCloseSucceeded = closeMidTime > 0 && closeMidTime < state.openPoseTime &&
                state.animationDirection === "closed" && Math.abs(state.activeAction.time) <= ANIMATION_SECONDS_EPSILON;
        }
    }
    const displayModes = testDisplayModes();
    const displayModesValid = DISPLAY_MODE_IDS.every(mode => displayModes[mode] && displayModes[mode].valid) &&
        DISPLAY_MODE_IDS.length === DISPLAY_MODES.length;
    const partTest = await testPartSelectionAndGlow();
    const lightRig = await testBeamRig();
    const lightRigValid = lightRig.valid;
    const multiOpen = await testMultiOpenAnimations();
    const multiOpenValid = multiOpen.valid && multiOpen.multiOpenPreserved && multiOpen.closedOnlySelected;
    const openClipCountAfterMultiOpen = state.openClipIndices.size;
    const animatingClipCountAfterMultiOpen = state.animatingClipIndices.size;
    const loopBindingInvalid = loopBindingValid === false;
    const bindingsValid = panelBinding.valid && panelClipIndex >= 0 && loopBindingInvalid;
    const doubleToggleChangedClip = doubleToggleClipIndex === binding.clipIndex;
    const partTestValid = partTest.measurementValid && partTest.pickSuccess && partTest.markerClickValid &&
        partTest.glowValid && partTest.glowRestoreRestoredMaterial && partTest.glowIsolated &&
        partTest.glowColorMatchesKelvin && partTest.lightPanelRemoved && partTest.baseLightingValid;
    const selectionOutline = await testSelectionOutlineHighlight();
    const selectionOutlineValid = selectionOutline.success;
    const clickSemantics = await testClickSemantics();
    const clickSemanticsValid = clickSemantics.valid;
    const escapeClear = await testEscapeClearsSelection();
    const escapeClearValid = escapeClear.valid;
    const pickStack = await testPickStackCycling();
    const pickStackValid = pickStack.valid;
    const treeVisibility = await testTreeBlockVisibility();
    const treeVisibilityValid = treeVisibility.valid;
    const animationTiming = await testAnimationTimingControls();
    const animationTimingValid = animationTiming.valid;
    const statusLine = await testStatusLine();
    const statusLineValid = statusLine.valid;
    const viewportToolbar = await testViewportToolbar();
    const viewportToolbarValid = viewportToolbar.valid;
    const visibility = getVisibilityDiagnostics();
    const success = Boolean(bindingsValid && singleSelectActiveClipUnchanged && !singleSelectAutoOpenSucceeded &&
        !singleSelectDoorOpen && !singleSelectAnimationPlaying && singleSelectKeptDirection &&
        doubleToggleOpenSucceeded && doubleToggleChangedClip && doubleToggleCloseSucceeded && displayModesValid &&
        partTestValid && lightRigValid && multiOpenValid && selectionOutlineValid &&
        clickSemanticsValid && escapeClearValid && pickStackValid && treeVisibilityValid &&
        animationTimingValid && statusLineValid && viewportToolbarValid);
    const result = {
        type: "selectionTestResult",
        success,
        selectionOutlineValid,
        selectionOutlineCount: selectionOutline.outlineCount,
        selectionOutlineMeshCount: selectionOutline.outlineMeshCount,
        selectionOutlineVisibleCount: selectionOutline.outlineVisibleCount,
        selectionOutlineVisible: selectionOutline.outlineVisible,
        selectionOutlineColor: selectionOutline.outlineColor,
        selectionOutlineBuildMs: selectionOutline.outlineBuildMs,
        selectionOutlineEmissiveMaterialCount: selectionOutline.outlineEmissiveMaterialCount,
        selectionOutlineViewportClick: selectionOutline.selectionFromViewport,
        selectionOutlineTreeClickUsed: selectionOutline.treeClickUsed,
        selectionOutlineClickOutsideTree: selectionOutline.clickOutsideTree,
        selectionOutlineDeselectedCount: selectionOutline.deselectedOutlineCount,
        selectionOutlineDeselectedVisibleCount: selectionOutline.deselectedOutlineVisibleCount,
        selectionOutlineStrayMarkers: selectionOutline.strayMarkers,
        selectionOutlineMarkerPollution: selectionOutline.markerPollution,
        selectionOutlineRaycastStubbed: selectionOutline.raycastStubbed,
        selectionOutlineWireframeValid: selectionOutline.wireframeOverlayValid,
        selectionOutlineSelectionHelperCount: selectionOutline.selectionHelperCount,
        selectionOutlineBoxHelperCount: selectionOutline.boxHelperCount,
        selectionOutlineSelectedName: selectionOutline.selectedName,
        selectionOutlinePixelsColor: selectionOutline.modes.facets ? selectionOutline.modes.facets.pixelCount : 0,
        selectionOutlinePixelsWireframe: selectionOutline.modes.wireframe ? selectionOutline.modes.wireframe.pixelCount : 0,
        selectionOutlinePixelsTransparent: selectionOutline.modes.transparent ? selectionOutline.modes.transparent.pixelCount : 0,
        selectionOutlinePixelsFacets: selectionOutline.modes.facets ? selectionOutline.modes.facets.pixelCount : 0,
        selectionOutlineFrameTimeMs: selectionOutline.modes.facets ? selectionOutline.modes.facets.frameTimeMs : 0,
        selectionOutline,
        multiOpenValid,
        multiOpenPreserved: multiOpen.multiOpenPreserved,
        closedOnlySelected: multiOpen.closedOnlySelected,
        multiOpen: multiOpen,
        lightRigValid,
        lightRig,
        lightKelvin: lightRig.kelvin,
        lightKelvinColorHex: lightRig.kelvinColorHex,
        lightIntensity: lightRig.intensity,
        lightGizmoObjects: lightRig.gizmoObjectCount,
        lightObserverPositionMatchesCamera: lightRig.lightObserverPositionMatchesCamera,
        lightTargetMatchesControls: lightRig.lightTargetMatchesControls,
        lightPositionDeviation: lightRig.lightPositionDeviation,
        lightTargetDeviation: lightRig.lightTargetDeviation,
        lightObserverAngleDeg: lightRig.observerAngleDeg,
        lightViewCount: lightRig.viewCount,
        lightMaxDarkPixelPercent: lightRig.maxDarkPixelPercent,
        clickSemanticsValid,
        clickSemantics,
        singleClickSelected: clickSemantics.singleClickSelected,
        singleClickAutoOpenSucceeded: clickSemantics.singleSelectAutoOpenSucceeded,
        singleClickAnimationPlaying: clickSemantics.singleSelectAnimationPlaying,
        singleClickOutlineCount: clickSemantics.singleClickOutlineCount,
        doubleClickOpenSucceeded: clickSemantics.doubleToggleOpenSucceeded,
        doubleClickCloseSucceeded: clickSemantics.doubleToggleCloseSucceeded,
        helperClickCount: clickSemantics.helperClickCount,
        helperRaycastIntercepted: clickSemantics.helperRaycastIntercepted,
        helperInPickTargets: clickSemantics.helperInPickTargets,
        escapeClearValid,
        escapeClear,
        escapeOutlineCount: escapeClear.outlineCountAfterEscape,
        escapeOutlineVisibleCount: escapeClear.outlineVisibleCountAfterEscape,
        escapeEmissiveMaterialCount: escapeClear.emissiveMaterialCountAfterEscape,
        escapeStatusText: escapeClear.statusAfterEscape,
        escapeStatusCleared: escapeClear.statusClearedAfterEscape,
        escapeNumberInputChanged: escapeClear.numberInputChanged,
        pickStackValid,
        pickStack,
        pickStackCount: pickStack.stackCount,
        pickStackFirstIndex: pickStack.firstIndex,
        pickStackSecondIndex: pickStack.secondIndex,
        pickStackCycles: pickStack.cyclesAfterFullCycle,
        pickStackText: pickStack.summaryText,
        treeVisibilityValid,
        treeVisibility,
        treeVisibilityHiddenCount: visibility.hiddenObjectCount,
        treeVisibilityPickTargetLeak: visibility.pickTargetLeak,
        animationTimingValid,
        animationTiming,
        animationTimingOpenSeconds: animationTiming.appliedOpenSeconds,
        animationTimingCloseSeconds: animationTiming.appliedCloseSeconds,
        animationTimingClipIndex: animationTiming.activeClipIndex,
        animationTimingAlternateClipIndex: animationTiming.alternateClipIndex,
        animationTimingDefaultsAfterClipChange: animationTiming.defaultsAfterClipChange,
        statusLineValid,
        statusLine,
        statusLineText: statusLine.statusWithSelection,
        statusLineBlockText: statusLine.blockStatus,
        statusLineElementCount: statusLine.statusBarElementCount,
        statusLineRemovedSummaryElements: statusLine.removedSummaryElements,
        viewportToolbarValid,
        viewportToolbar,
        toolbarActiveMode: viewportToolbar.activeMode,
        toolbarModeButtonCount: viewportToolbar.modeButtonCount,
        toolbarModeOrder: viewportToolbar.modeOrder,
        toolbarRemovedLabelMatches: viewportToolbar.removedLabelMatches,
        toolbarTimingOpenLabel: viewportToolbar.timingOpenLabel,
        toolbarTimingCloseLabel: viewportToolbar.timingCloseLabel,
        toolbarZoomButtonCount: viewportToolbar.zoomButtonCount,
        toolbarZoomFitAbsent: viewportToolbar.zoomFitAbsent,
        toolbarStatusBarElementCount: viewportToolbar.statusBarElementCount,
        toolbarDistanceBefore: viewportToolbar.distanceBefore,
        toolbarDistanceAfterZoomIn: viewportToolbar.distanceAfterZoomIn,
        toolbarDistanceAfterReset: viewportToolbar.distanceAfterReset,
        toolbarMinimumDistance: viewportToolbar.minimumDistance,
        toolbarMaximumDistance: viewportToolbar.maximumDistance,
        toolbarViewportWidthShown: viewportToolbar.viewportWidthShown,
        toolbarViewportWidthHidden: viewportToolbar.viewportWidthHidden,
        displayModeCatalog: testDisplayModeCatalog(),
        openClipCount: openClipCountAfterMultiOpen,
        animatingClipCount: animatingClipCountAfterMultiOpen,
        selectedNode: getObjectName(candidate),
        animationIndex: binding.valid ? binding.sourceIndex : null,
        hierarchySource: state.hierarchy.source,
        autoOpenSucceeded: doubleToggleOpenSucceeded,
        closeSucceeded: doubleToggleCloseSucceeded,
        singleSelectActiveClipUnchanged,
        singleSelectAutoOpenSucceeded,
        singleSelectKeptDirection,
        singleSelectDoorOpen,
        singleSelectAnimationPlaying,
        singleSelectActiveClipIndex,
        clipIndexBeforeSingleSelect,
        doubleToggleOpenSucceeded,
        doubleToggleCloseSucceeded,
        doubleToggleChangedClip,
        doubleToggleActiveClipIndex: doubleToggleClipIndex,
        boundClipIndex: binding.valid ? binding.clipIndex : -1,
        openingDirection,
        openingTimeScale,
        closeDirection,
        closingTimeScale,
        closeMidTime,
        panelNode: candidates.panelWithFirstAnimation ? getObjectName(candidates.panelWithFirstAnimation) : null,
        panelAnimationIndex,
        panelClipIndex,
        panelBindingValid: panelBinding.valid,
        loopNode: loopName,
        loopPartId,
        loopPartType,
        loopOwnAnimationIndex,
        loopBindingValid,
        loopSingleSelectKeptClip,
        loopHasAnimatedAncestor: candidates.hardwareHasAnimatedAncestor,
        displayModes,
        displayModesValid,
        partTestValid,
        measurementValid: partTest.measurementValid,
        dimensionsMm: partTest.dimensionsMm,
        localDimensionsMm: partTest.localDimensionsMm,
        worldSize: partTest.worldSize,
        triangleCount: partTest.triangleCount,
        meshCount: partTest.meshCount,
        animatedPart: partTest.animatedPart,
        pickTargetCount: partTest.pickTargetCount,
        pickSuccess: partTest.pickSuccess,
        pickTested: partTest.pickTested,
        partPickClickCount: partTest.pickClickCount,
        partPickStackIndex: partTest.pickStackIndex,
        partPickStackCount: partTest.pickStackCount,
        markerClickTested: partTest.markerClickTested,
        markerClickSampleCount: partTest.markerClickSampleCount,
        markerClickSkippedWithoutGeometry: partTest.markerClickSkippedWithoutGeometry,
        markerClickParentReachable: partTest.markerClickParentReachable,
        markerClickParentMeshReachable: partTest.markerClickParentMeshReachable,
        markerClickParentBoundsReachable: partTest.markerClickParentBoundsReachable,
        markerClickSamePart: partTest.markerClickSamePart,
        markerClickOtherPart: partTest.markerClickOtherPart,
        markerClickHelperHits: partTest.markerClickHelperHits,
        markerClickMissCount: partTest.markerClickMissCount,
        markerClickSampleLog: partTest.markerClickSampleLog,
        markerClickValid: partTest.markerClickValid,
        glowValid: partTest.glowValid,
        glowCloneApplied: partTest.glowCloneApplied,
        glowIsolationPart: partTest.glowIsolationPart,
        glowChangedMaterials: partTest.glowChangedMaterials,
        glowEmissiveHex: partTest.glowEmissiveHex,
        glowIntensity: partTest.glowIntensity,
        glowColorMatchesKelvin: partTest.glowColorMatchesKelvin,
        glowIsolated: partTest.glowIsolated,
        glowPersistsAfterDeselect: partTest.glowPersistsAfterDeselect,
        glowOtherOwnState: partTest.glowOtherOwnState,
        glowTargetRestoresProfile: partTest.glowTargetRestoresProfile,
        glowRestoreRestoredMaterial: partTest.glowRestoreRestoredMaterial,
        glowMaterialsCleared: partTest.glowMaterialsCleared,
        lightPanelRemoved: partTest.lightPanelRemoved,
        lightPanelArtifacts: partTest.lightPanelArtifacts,
        baseLightingValid: partTest.baseLightingValid,
        timing: getAnimationTimingDiagnostics(),
        mixerTime: state.activeAction ? state.activeAction.time : null,
        message: success
            ? "Выделение одиночным щелчком, выбор насквозь повторным щелчком, переключение анимации двойным щелчком, привязка анимаций, мульти-открытие, три режима отображения в порядке Грани в цвете → Прозрачный → Каркасный, блоки дерева со скрытием и действиями анимации в меню, панель инструментов с четырьмя режимами, кнопками зума «−» и «+», блоком «Время анимации» и скрытием панелей, одна короткая строка статуса, подсветка выделения в окне и видимый источник света проверены."
            : !bindingsValid
                ? "Привязка анимации к детали определена неверно."
                : !singleSelectActiveClipUnchanged || singleSelectAutoOpenSucceeded || singleSelectDoorOpen || singleSelectAnimationPlaying
                    ? "Одиночный щелчок изменил состояние анимации."
                    : !doubleToggleOpenSucceeded || !doubleToggleChangedClip
                        ? "Двойной щелчок не открыл связанную анимацию."
                        : !doubleToggleCloseSucceeded
                            ? "Двойной щелчок не закрыл связанную анимацию."
                            : !displayModesValid
                                ? "Не удалось проверить режимы отображения."
                                : !lightRigValid
                                    ? lightRig.message
                                    : !multiOpenValid
                                        ? `Мульти-открытие не подтверждено: ${multiOpen.message}`
                                        : !selectionOutlineValid
                                            ? selectionOutline.message
                                            : !clickSemanticsValid
                                                ? clickSemantics.message
                                                : !escapeClearValid
                                                    ? escapeClear.message
                                                    : !pickStackValid
                                                        ? pickStack.message
                                                        : !treeVisibilityValid
                                                            ? treeVisibility.message
                                                            : !animationTimingValid
                                                                ? animationTiming.message
                                                                : !statusLineValid
                                                                    ? statusLine.message
                                                                    : !viewportToolbarValid
                                                                        ? viewportToolbar.message
                                                                        : !partTest.measurementValid
                                                                            ? "Не удалось получить габариты детали в миллиметрах."
                                                                            : !partTest.pickSuccess
                                                                                ? "Щелчок по детали в окне просмотра не выбрал деталь."
                                                                                : !partTest.markerClickValid
                                                                                    ? "Щелчок по отверстию или крепежу нарушил выбор родительской детали."
                                                                                    : !partTest.glowValid
                                                                                        ? "Переключение подсветки детали не изменило emissive или не восстановило материал."
                                                                                        : "Не удалось проверить выбор детали и подсветку."
    };
    sendToHost(result);
    return result;
}

function populateModelView(gltf, root, packageMetadata, documentModel) {
    buildPartObjectMap(root);
    buildObjectTree(root, packageMetadata);
    const markerSummary = collectMarkerData(gltf, root, packageMetadata);
    elements.viewportHint.style.display = "none";
    state.pickTargets = [];
    refreshPickTargets();
    state.clips = Array.isArray(gltf.animations) ? gltf.animations.slice() : [];
    state.mixer = state.clips.length > 0 ? new state.THREE.AnimationMixer(root) : null;
    buildAnimationLookup(gltf, documentModel);
    resetAnimationSelection();
    resizeViewport();
    fitCamera(root);
    selectObject(null);
    return { objectCount: 0, markerSummary, partObjectCount: state.partObjects.size, hierarchy: state.hierarchy };
}

async function loadModel(descriptor) {
    if (!state.ready) {
        reportError("Локальные модули просмотрщика ещё не готовы.", descriptor.requestId || null);
        return;
    }
    const extension = getModelExtension(descriptor.name);
    if (extension !== "glb" && extension !== "gltf") {
        reportError("Выберите локальный файл GLB или glTF.", descriptor.requestId || null);
        return;
    }
    clearModel();
    sendToHost({ type: "viewerStatus", stage: "loadStarted", requestId: descriptor.requestId || null });
    const currentToken = state.loadToken;
    setLoading("Проверка модели...");
    setStatus(`Загрузка модели ${descriptor.name}...`);
    const started = performance.now();
    try {
        const documentModel = getGltfJsonDocument(descriptor.name, descriptor.arrayBuffer);
        const resourceBase = descriptor.hasExternalResources ? descriptor.resourceBase : "";
        assertLocalReferences(documentModel, resourceBase);
        sendToHost({ type: "viewerStatus", stage: "parsingModel", requestId: descriptor.requestId || null });
        setLoading("Разбор сцены и анимаций glTF...");
        const gltf = await parseModel(descriptor.arrayBuffer, resourceBase);
        sendToHost({ type: "viewerStatus", stage: "modelParsed", requestId: descriptor.requestId || null });
        if (currentToken !== state.loadToken) {
            return;
        }
        if (!gltf.scene) {
            throw new Error("Модель glTF не содержит сцены.");
        }
        preparePackageMetadata(descriptor.packageMetadata);
        state.modelRoot = gltf.scene;
        assignObjectIdentity(state.modelRoot);
        applyDisplayMode(state.displayMode);
        state.modelRoot.traverse(object => {
            if (object.isMesh) {
                object.castShadow = false;
                object.receiveShadow = false;
            }
        });
        disableSceneShadows();
        state.scene.add(state.modelRoot);
        const details = populateModelView(gltf, state.modelRoot, descriptor.packageMetadata, documentModel);
        sendToHost({ type: "viewerStatus", stage: "viewerPopulated", requestId: descriptor.requestId || null });
        hideLoading();
        const loadDurationMs = performance.now() - started;
        const counts = getAnimationCounts();
        const markerDiagnostics = getMarkerDiagnostics();
        setStatus(`Модель ${descriptor.name} загружена. Отверстий: ${details.markerSummary.holes}, крепежа и фурнитуры: ${details.markerSummary.fasteners}. Анимаций glTF: ${state.clips.length}.`);
        await reportRenderDiagnostics(descriptor.requestId || null, markerDiagnostics);
        sendToHost({
            type: "modelLoaded",
            requestId: descriptor.requestId,
            name: descriptor.name,
            path: descriptor.path,
            animationCount: state.clips.length,
            rotationAnimationCount: counts.rotation,
            slidingAnimationCount: counts.sliding,
             objectCount: details.objectCount,
             holeCount: details.markerSummary.holes,
             fastenerCount: details.markerSummary.fasteners,
             fastenerMarkerCount: details.markerSummary.fastenerMarkers,
             fastenerGeometryParts: details.markerSummary.fastenerGeometry,
             fastenerSynthesizedParts: details.markerSummary.fastenerSynthesized,
             strayMarkerCount: markerDiagnostics.strayMarkers,
             inheritedAnimationParts: markerDiagnostics.inheritedAnimationParts,
             animationBindingValid: markerDiagnostics.animationBinding ? markerDiagnostics.animationBinding.valid : false,
             animIdxMinusOneParts: markerDiagnostics.animationBinding ? markerDiagnostics.animationBinding.declaredNegativeParts : 0,
             animIdxMinusOneBoundParts: markerDiagnostics.animationBinding ? markerDiagnostics.animationBinding.boundNegativeParts : 0,
             animIdxZeroParts: markerDiagnostics.animationBinding ? markerDiagnostics.animationBinding.declaredFirstParts : 0,
             animIdxZeroClipIndexes: markerDiagnostics.animationBinding ? markerDiagnostics.animationBinding.declaredFirstClipIndexes : [],
             holeMarkersOnParts: markerDiagnostics.markerSummary.parentedToPart,
             wrongMarkerParentCount: markerDiagnostics.wrongParentCount,
             hierarchyDefined: details.hierarchy.defined,
             hierarchySource: details.hierarchy.source,
             loadDurationMs
        });
    } catch (error) {
        if (currentToken !== state.loadToken) {
            return;
        }
        reportError(userErrorMessage(error, "Не удалось загрузить модель"), descriptor.requestId || null);
    }
}

function parseHostMessage(data) {
    if (typeof data === "string") {
        return JSON.parse(data);
    }
    if (data && typeof data === "object") {
        return data;
    }
    throw new Error("Сообщение приложения не является объектом JSON.");
}

async function handleHostMessage(data) {
    const message = parseHostMessage(data);
    if (message.type === "loadModel") {
        if (typeof message.requestId !== "string" || typeof message.name !== "string" ||
            typeof message.path !== "string" || typeof message.bytes !== "string") {
            reportError("Сообщение модели от приложения неполное.");
            return;
        }
        sendToHost({ type: "viewerStatus", stage: "hostMessageReceived", requestId: message.requestId });
        const descriptor = {
            requestId: message.requestId,
            name: message.name,
            path: message.path,
            resourceBase: typeof message.resourceBase === "string" ? message.resourceBase : "",
            hasExternalResources: message.hasExternalResources === true,
            packageMetadata: null,
            arrayBuffer: null
        };
        if (typeof message.packageMetadataJson === "string") {
            descriptor.packageMetadata = JSON.parse(message.packageMetadataJson);
        }
        sendToHost({ type: "viewerStatus", stage: "decodingBase64", requestId: message.requestId });
        descriptor.arrayBuffer = decodeBase64(message.bytes);
        sendToHost({ type: "viewerStatus", stage: "base64Decoded", requestId: message.requestId });
        await loadModel(descriptor);
    } else if (message.type === "resetCamera") {
        sendToHost({ type: "viewerStatus", stage: "resetMessageReceived", requestId: null });
        resetCamera();
    } else if (message.type === "testFirstAnimatedSelection") {
        await testFirstAnimatedSelection();
    } else if (message.type === "setDisplayMode") {
        if (typeof message.mode !== "string" || !isDisplayMode(message.mode)) {
            reportError("Сообщение о режиме отображения модели содержит неизвестный режим.");
            return;
        }
        applyDisplayMode(message.mode);
        await waitForRenderFrame();
        sendToHost({ type: "viewerStatus", stage: "displayModeApplied", requestId: null });
    } else if (message.type === "configureLightState") {
        const summary = applyLightStateCommand(message);
        await waitForRenderFrame();
        sendToHost({
            type: "viewerStatus",
            stage: `lightStateApplied:${summary.kelvin}K:${summary.enabled ? 1 : 0}:${summary.gizmoObjectCount}:${summary.glowEnabled ? 1 : 0}`,
            requestId: null
        });
    } else if (message.type === "applyCaptureScenario") {
        const outcome = applyCaptureScenario(message.scenario);
        await waitForRenderFrame();
        if (!outcome.applied) {
            reportError(outcome.message || "Сценарий снимка не применён.");
            return;
        }
        sendToHost({
            type: "viewerStatus",
            stage: `captureScenarioApplied:${outcome.scenario}`,
            requestId: null
        });
    } else if (message.type === "frameFastener") {
        const framed = frameFastenerGeometry();
        if (!framed) {
            reportError("В модели не найден крепёж с геометрией для кадрирования снимка.");
            return;
        }
        await waitForRenderFrame();
        sendToHost({ type: "viewerStatus", stage: "fastenerFramed", requestId: null });
    }
}

function refreshPickTargets() {
    state.pickTargets = getModelMeshes().filter(mesh =>
        isObjectVisible(mesh) && typeof mesh.raycast === "function" && Boolean(mesh.geometry));
    resetPickStack();
    return state.pickTargets.length;
}

function resolveSelectionTarget(object) {
    if (!object) {
        return null;
    }
    let treeAncestor = null;
    let partAncestor = null;
    for (let current = object; current; current = current.parent) {
        if (isWireframeOverlay(current) || isWireframeExcludedObject(current)) {
            continue;
        }
        if (!treeAncestor && state.treeButtons.has(current)) {
            treeAncestor = current;
        }
        if (getPartId(current) !== null) {
            partAncestor = current;
        }
    }
    return treeAncestor || partAncestor || object;
}

function setPointerFromClient(clientX, clientY) {
    const bounds = state.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
        return false;
    }
    state.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    state.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    return true;
}

function collectPickStackTargets() {
    if (!state.modelRoot || !state.raycaster) {
        return { targets: [], skippedService: 0, skippedGeometryless: 0, skippedHidden: 0 };
    }
    const meshes = state.pickTargets.length > 0 ? state.pickTargets : getModelMeshes();
    const intersections = state.raycaster.intersectObjects(meshes, false);
    const targets = [];
    const seen = new Set();
    let skippedService = 0;
    let skippedGeometryless = 0;
    let skippedHidden = 0;
    for (const intersection of intersections) {
        const object = intersection.object;
        if (!object || !object.isMesh) {
            continue;
        }
        if (isWireframeOverlay(object) || isWireframeExcludedObject(object)) {
            skippedService += 1;
            continue;
        }
        if (!object.geometry) {
            skippedGeometryless += 1;
            continue;
        }
        if (!isObjectVisible(object)) {
            skippedHidden += 1;
            continue;
        }
        const target = resolveSelectionTarget(object);
        if (!target || state.hiddenObjects.has(target)) {
            skippedHidden += 1;
            continue;
        }
        if (seen.has(target)) {
            continue;
        }
        seen.add(target);
        targets.push({ object: target, distance: intersection.distance });
    }
    return { targets, skippedService, skippedGeometryless, skippedHidden };
}

function buildPickStack(clientX, clientY) {
    if (!setPointerFromClient(clientX, clientY)) {
        return null;
    }
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const collected = collectPickStackTargets();
    state.pickStack = {
        clientX,
        clientY,
        objects: collected.targets.map(entry => entry.object),
        distances: collected.targets.map(entry => entry.distance),
        index: 0,
        cycles: 0,
        skippedService: collected.skippedService,
        skippedGeometryless: collected.skippedGeometryless,
        skippedHidden: collected.skippedHidden
    };
    return state.pickStack;
}

function resetPickStack() {
    state.pickStack = null;
}

function isPickStackNear(clientX, clientY, radius) {
    const stack = state.pickStack;
    if (!stack) {
        return false;
    }
    return Math.hypot(clientX - stack.clientX, clientY - stack.clientY) <= radius;
}

function getPickStackText() {
    const stack = state.pickStack;
    if (!stack || stack.objects.length === 0) {
        return "Под курсором деталей нет";
    }
    return `Под курсором деталей: ${stack.objects.length}, выбрана ${stack.index + 1} из ${stack.objects.length}`;
}

function getPickStackDiagnostics() {
    const stack = state.pickStack;
    const objects = stack ? stack.objects : [];
    return {
        active: Boolean(stack) && objects.length > 0,
        clientX: stack ? Math.round(stack.clientX * 100) / 100 : null,
        clientY: stack ? Math.round(stack.clientY * 100) / 100 : null,
        count: objects.length,
        index: stack ? stack.index : -1,
        cycles: stack ? stack.cycles : 0,
        distances: stack ? stack.distances.map(value => Math.round(value * 1000) / 1000) : [],
        names: objects.map(object => getObjectName(object)),
        serviceObjectHits: stack ? stack.skippedService : 0,
        geometrylessHits: stack ? stack.skippedGeometryless : 0,
        hiddenHits: stack ? stack.skippedHidden : 0,
        text: getPickStackText(),
        hint: PICK_STACK_HINT
    };
}

function isViewportDoubleClickCandidate(clientX, clientY) {
    const last = state.lastViewportClick;
    if (!last) {
        return false;
    }
    return performance.now() - last.time <= PICK_STACK_DOUBLE_CLICK_MS &&
        Math.hypot(clientX - last.x, clientY - last.y) <= PICK_STACK_PIXEL_RADIUS;
}

function findVisibleTreeBlock() {
    if (!elements.objectTree) {
        return null;
    }
    const treeBounds = elements.objectTree.getBoundingClientRect();
    let best = null;
    for (const block of state.treeBlocks.values()) {
        const group = state.treeGroupsByKey.get(block.key);
        if (!group) {
            continue;
        }
        const bounds = group.toggle.getBoundingClientRect();
        if (bounds.height <= 0 || bounds.top < treeBounds.top || bounds.bottom > treeBounds.bottom) {
            continue;
        }
        if (!best || block.objects.length < best.block.objects.length) {
            best = { block, group, bounds };
        }
    }
    return best;
}

function findVisibleTreePart() {
    if (!elements.objectTree) {
        return null;
    }
    const treeBounds = elements.objectTree.getBoundingClientRect();
    const blocks = Array.from(state.treeBlocks.values())
        .filter(block => block.objects.some(object => getTreeContextMenuTargetAnimation({ kind: "part", object }) !== null))
        .sort((first, second) => second.objects.length - first.objects.length);
    for (const block of blocks) {
        const group = state.treeGroupsByKey.get(block.key);
        if (!group) {
            continue;
        }
        group.setExpanded(true);
        for (const object of block.objects) {
            if (!getTreeContextMenuTargetAnimation({ kind: "part", object })) {
                continue;
            }
            const button = state.treeButtons.get(object);
            if (!button) {
                continue;
            }
            const bounds = button.getBoundingClientRect();
            if (bounds.height <= 0 || bounds.top < treeBounds.top || bounds.bottom > treeBounds.bottom) {
                continue;
            }
            return { object, bounds };
        }
    }
    return null;
}

function getGeometryUvSpan(meshes) {
    const span = { u: 0, v: 0 };
    for (const mesh of meshes) {
        const uv = mesh.geometry && mesh.geometry.attributes ? mesh.geometry.attributes.uv : null;
        if (!uv || uv.count === 0) {
            continue;
        }
        let minU = Infinity;
        let maxU = -Infinity;
        let minV = Infinity;
        let maxV = -Infinity;
        for (let index = 0; index < uv.count; index += 1) {
            const u = uv.getX(index);
            const v = uv.getY(index);
            if (u < minU) {
                minU = u;
            }
            if (u > maxU) {
                maxU = u;
            }
            if (v < minV) {
                minV = v;
            }
            if (v > maxV) {
                maxV = v;
            }
        }
        if (Number.isFinite(minU) && Number.isFinite(minV)) {
            span.u = Math.max(span.u, maxU - minU);
            span.v = Math.max(span.v, maxV - minV);
        }
    }
    return span;
}

function applyTextureDetailScenario() {
    const THREE = state.THREE;
    if (!state.modelRoot || !THREE || !state.camera || !state.controls) {
        return { applied: false, scenario: "texture-detail", message: "Модель не загружена." };
    }
    state.scene.updateMatrixWorld(true);
    let target = null;
    let bestTexturedFace = 0;
    let bestTexturedVolume = 0;
    let texturedMeshCount = 0;
    for (const entry of state.partObjects.values()) {
        const object = entry ? entry.object : null;
        if (!object) {
            continue;
        }
        const measured = measurePartGeometry(object);
        if (measured.meshes.length === 0 || measured.worldBox.isEmpty()) {
            continue;
        }
        const size = measured.worldBox.getSize(new THREE.Vector3());
        const sorted = [size.x, size.y, size.z].sort((first, second) => second - first);
        const textured = measured.meshes.filter(mesh =>
            getMeshMaterials(mesh.material).some(material => material && material.map)).length;
        if (textured === 0) {
            continue;
        }
        const face = sorted[0] * sorted[1];
        if (face > bestTexturedFace || (face === bestTexturedFace && sorted[0] * sorted[1] * sorted[2] > bestTexturedVolume)) {
            bestTexturedFace = face;
            bestTexturedVolume = sorted[0] * sorted[1] * sorted[2];
            texturedMeshCount = textured;
            target = object;
        }
    }
    if (!target) {
        return { applied: false, scenario: "texture-detail", message: "В модели не найдены детали с текстурами." };
    }
    const box = new THREE.Box3();
    for (const mesh of collectPartGeometry(target)) {
        box.expandByObject(mesh);
    }
    if (box.isEmpty()) {
        return { applied: false, scenario: "texture-detail", message: "У детали нет габаритов для кадра." };
    }
    selectObject(target);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const modelBox = new THREE.Box3().setFromObject(state.modelRoot);
    const modelCenter = modelBox.isEmpty() ? center : modelBox.getCenter(new THREE.Vector3());
    const axes = [
        { name: "x", vector: new THREE.Vector3(1, 0, 0), size: size.x, uv: "u" },
        { name: "y", vector: new THREE.Vector3(0, 1, 0), size: size.y, uv: "v" },
        { name: "z", vector: new THREE.Vector3(0, 0, 1), size: size.z, uv: null }
    ];
    const normal = axes.reduce((thinnest, axis) => axis.size < thinnest.size ? axis : thinnest);
    const uvSpan = getGeometryUvSpan(collectPartGeometry(target));
    const outward = normal.vector.clone().multiplyScalar(
        normal.vector.dot(center.clone().sub(modelCenter)) >= 0 ? 1 : -1);
    const verticalFov = THREE.MathUtils.degToRad(state.camera.fov);
    const faceAxes = axes.filter(axis => axis.size > normal.size * 2).sort((first, second) => second.size - first.size);
    const tilesPerMeter = Math.max(...faceAxes.map(axis => {
        const span = uvSpan[axis.uv] || 0;
        return axis.size > 0 ? span / axis.size : 0;
    }));
    const surfaceLimit = faceAxes.length >= 2 ? faceAxes[1].size : Math.max(size.x, size.y, size.z);
    const visibleExtent = Math.min(Math.max(surfaceLimit, TEXTURE_DETAIL_SURFACE_MIN), TEXTURE_DETAIL_SURFACE_MAX);
    const halfHeight = Math.tan(verticalFov * 0.5);
    const halfWidth = halfHeight * state.camera.aspect;
    const viewAngle = THREE.MathUtils.degToRad(TEXTURE_DETAIL_VIEW_ANGLE_DEGREES);
    const tiltAxis = (faceAxes.length >= 2 ? faceAxes : [normal]).reduce((flattest, axis) =>
        Math.abs(axis.vector.y) < Math.abs(flattest.vector.y) ? axis : flattest);
    const tilted = outward.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(tiltAxis.vector, viewAngle));
    const direction = tilted.y >= 0
        ? tilted
        : outward.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(tiltAxis.vector, -viewAngle));
    direction.applyAxisAngle(outward, THREE.MathUtils.degToRad(TEXTURE_DETAIL_AZIMUTH_DEGREES));
    const distance = Math.max(visibleExtent * 0.5 / halfWidth, visibleExtent * 0.5 / halfHeight) *
        TEXTURE_DETAIL_VIEW_FILL;
    state.camera.position.copy(center).addScaledVector(direction, distance);
    state.controls.target.copy(center);
    state.controls.minDistance = Math.min(state.controls.minDistance, normal.size * 0.05);
    state.controls.update();
    updateCameraClipping();
    return {
        applied: true,
        scenario: "texture-detail",
        object: getObjectName(target),
        texturedMeshes: texturedMeshCount,
        panelNormal: normal.name,
        panelThickness: normal.size,
        panelSize: { x: size.x, y: size.y, z: size.z },
        uvSpan: { u: uvSpan.u || 0, v: uvSpan.v || 0 },
        tilesPerMeter,
        visibleTiles: tilesPerMeter > 0 ? visibleExtent * tilesPerMeter : 0,
        visibleExtent,
        visibleExtentMm: Math.round(visibleExtent * 1000),
        viewAngleDegrees: TEXTURE_DETAIL_VIEW_ANGLE_DEGREES,
        azimuthDegrees: TEXTURE_DETAIL_AZIMUTH_DEGREES,
        distance,
        center: vectorData(center)
    };
}

function applyCaptureScenario(scenario) {
    if (!isCaptureScenario(scenario)) {
        return { applied: false, scenario, message: "Неизвестный сценарий снимка." };
    }
    closeTreeContextMenu();
    selectObject(null);
    resetCamera();
    setPanelsHidden(false);
    applyDisplayMode(DISPLAY_MODE_DEFAULT);
    if (scenario === "toolbar-panels-hidden") {
        setPanelsHidden(true);
        return { applied: true, scenario, panelsHidden: state.panelsHidden, viewportWidth: elements.viewport.clientWidth };
    }
    if (scenario === "toolbar-zoom-in") {
        for (let step = 0; step < ZOOM_CAPTURE_STEPS; step += 1) {
            zoomCameraByStep(1);
        }
        return {
            applied: true,
            scenario,
            steps: ZOOM_CAPTURE_STEPS,
            targetDistance: getZoomLimits().fit,
            distance: getCameraDistance()
        };
    }
    if (scenario === "texture-detail") {
        return applyTextureDetailScenario();
    }
    if (scenario === "selection") {
        const target = findSelectionOutlineTarget();
        selectObject(target);
        return { applied: Boolean(target), scenario, name: target ? getObjectName(target) : null, color: colorToHexPadded(SELECTION_OUTLINE_COLOR) };
    }
    if (scenario === "context-menu") {
        const part = findVisibleTreePart();
        if (part) {
            const partApplied = openTreeContextMenu(
                Math.round(part.bounds.left + Math.min(part.bounds.width * 0.5, 140)),
                Math.round(part.bounds.bottom + 2),
                { kind: "part", object: part.object });
            return {
                applied: partApplied,
                scenario,
                target: "part",
                object: getObjectName(part.object),
                items: elements.treeContextMenu
                    ? Array.from(elements.treeContextMenu.querySelectorAll(".context-menu-item")).map(item => item.textContent)
                    : []
            };
        }
        const found = findVisibleTreeBlock();
        if (!found) {
            return { applied: false, scenario, message: "В видимой части дерева нет блока для контекстного меню." };
        }
        const applied = openTreeContextMenu(
            Math.round(found.bounds.left + Math.min(found.bounds.width * 0.5, 120)),
            Math.round(found.bounds.bottom + 2),
            { kind: "block", block: found.block });
        return {
            applied,
            scenario,
            target: "block",
            block: `Блок ${found.block.blockIndex + 1}`,
            parts: found.block.objects.length,
            items: elements.treeContextMenu
                ? Array.from(elements.treeContextMenu.querySelectorAll(".context-menu-item")).map(item => item.textContent)
                : []
        };
    }
    const scan = scanViewportForDeepestPickStack();
    if (!scan) {
        return { applied: false, scenario, message: "Не найдено точки с несколькими попаданиями луча." };
    }
    buildPickStack(scan.client.x, scan.client.y);
    for (let step = 1; step < Math.min(2, state.pickStack.objects.length); step += 1) {
        state.lastViewportClick = { x: scan.client.x, y: scan.client.y, time: 0 };
        handleViewportClick(scan.client.x, scan.client.y);
    }
    selectObject(state.pickStack.objects[state.pickStack.index]);
    setStatus(`Выделено «${getObjectName(state.selectedObject)}».`);
    return {
        applied: true,
        scenario,
        count: state.pickStack.objects.length,
        index: state.pickStack.index,
        text: getPickStackText(),
        names: state.pickStack.objects.map(object => getObjectName(object))
    };
}

function handleViewportClick(clientX, clientY) {
    const stack = state.pickStack;
    const reuse = stack && stack.objects.length > 0 && isPickStackNear(clientX, clientY, PICK_STACK_PIXEL_RADIUS);
    if (!reuse) {
        const built = buildPickStack(clientX, clientY);
        return {
            picked: built && built.objects.length > 0 ? built.objects[0] : null,
            advanced: false,
            index: built ? built.index : -1
        };
    }
    const doubleClickCandidate = isViewportDoubleClickCandidate(clientX, clientY);
    if (!doubleClickCandidate) {
        stack.index = (stack.index + 1) % stack.objects.length;
        if (stack.index === 0) {
            stack.cycles += 1;
        }
    }
    return { picked: stack.objects[stack.index], advanced: !doubleClickCandidate, index: stack.index };
}

function getViewportDoubleClickTarget(clientX, clientY) {
    const stack = state.pickStack;
    if (stack && stack.objects.length > 0 && isPickStackNear(clientX, clientY, PICK_STACK_PIXEL_RADIUS)) {
        return stack.objects[stack.index];
    }
    return pickViewportObject({ clientX, clientY });
}

function pickViewportObject(event) {
    if (!state.modelRoot || !state.raycaster || !state.pointer || !state.camera || !state.renderer) {
        return null;
    }
    if (!setPointerFromClient(event.clientX, event.clientY)) {
        return null;
    }
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const targets = state.pickTargets.length > 0 ? state.pickTargets : getModelMeshes();
    const intersections = state.raycaster.intersectObjects(targets, false);
    for (const intersection of intersections) {
        const object = intersection.object;
        if (!object || !object.isMesh || isWireframeOverlay(object) || isWireframeExcludedObject(object)) {
            continue;
        }
        if (!isObjectVisible(object)) {
            continue;
        }
        return resolveSelectionTarget(object);
    }
    return null;
}

function bindEvents() {
    for (const button of elements.displayModeButtons) {
        button.addEventListener("click", () => {
            applyDisplayMode(button.dataset.displayMode);
        });
    }
    if (elements.zoomIn) {
        elements.zoomIn.addEventListener("click", () => applyZoomAction("in"));
    }
    if (elements.zoomOut) {
        elements.zoomOut.addEventListener("click", () => applyZoomAction("out"));
    }
    if (elements.backgroundColor) {
elements.backgroundColor.addEventListener("input", () => {
    applyBackgroundColor(elements.backgroundColor.value);
});
elements.backgroundColor.addEventListener("change", () => {
    applyBackgroundColor(elements.backgroundColor.value);
});
// Выпадающий список «Как пользоваться»: открытие кнопкой, закрытие щелчком мимо.
const helpToggleElement = document.getElementById("help-toggle");
const helpPanelElement = document.getElementById("help-panel");
if (helpToggleElement && helpPanelElement) {
    helpToggleElement.addEventListener("click", () => {
        const willOpen = helpPanelElement.hidden;
        helpPanelElement.hidden = !willOpen;
        helpToggleElement.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
    document.addEventListener("pointerdown", (event) => {
        if (helpPanelElement.hidden) {
            return;
        }
        if (!helpPanelElement.contains(event.target) && !helpToggleElement.contains(event.target)) {
            helpPanelElement.hidden = true;
            helpToggleElement.setAttribute("aria-expanded", "false");
        }
    });
}
    }
    elements.viewport.addEventListener("contextmenu", event => event.preventDefault());
    window.addEventListener("keydown", event => {
        if (isEscapeKey(event)) {
            closeTreeContextMenu();
            clearSelectionByEscape();
            return;
        }
        if (getActiveEditableInput()) {
            return;
        }
        const zoomAction = getZoomKeyAction(event);
        if (!zoomAction) {
            return;
        }
        event.preventDefault();
        applyZoomAction(zoomAction);
    });
    document.addEventListener("pointerdown", event => {
        if (!elements.treeContextMenu || elements.treeContextMenu.hidden) {
            return;
        }
        if (event.target instanceof Node && elements.treeContextMenu.contains(event.target)) {
            return;
        }
        closeTreeContextMenu();
    });
    state.renderer.domElement.addEventListener("pointerdown", event => {
        state.pointerDown = { x: event.clientX, y: event.clientY, button: event.button };
    });
    state.renderer.domElement.addEventListener("pointerup", event => {
        if (!state.modelRoot || !state.pointerDown || state.pointerDown.button !== 0) {
            return;
        }
        const movement = Math.hypot(event.clientX - state.pointerDown.x, event.clientY - state.pointerDown.y);
        state.pointerDown = null;
        if (movement > 5) {
            return;
        }
        closeTreeContextMenu();
        const click = handleViewportClick(event.clientX, event.clientY);
        state.lastViewportClick = { x: event.clientX, y: event.clientY, time: performance.now() };
        if (click.picked) {
            selectObject(click.picked);
            setStatus(`Выделено «${getObjectName(click.picked)}».`);
        } else {
            selectObject(null);
            setStatus("");
        }
    });
    state.renderer.domElement.addEventListener("dblclick", event => {
        if (Date.now() - lastTouchDoubleTapHandled < 600) {
            // Двойное касание уже обработано touch-обработчиком ниже.
            return;
        }
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        closeTreeContextMenu();
        const picked = getViewportDoubleClickTarget(event.clientX, event.clientY);
        if (!picked) {
            return;
        }
        selectObject(picked);
        toggleAnimatedObject(picked);
    });
    // Двойное касание на телефонах: часть мобильных браузеров не присылает
    // dblclick по touch-событиям, поэтому пара быстрых тапов ловится вручную
    // и запускает ту же анимацию.
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let lastTouchDoubleTapHandled = 0;
    state.renderer.domElement.addEventListener("touchend", event => {
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) {
            return;
        }
        const now = Date.now();
        const moved = Math.hypot(touch.clientX - lastTapX, touch.clientY - lastTapY);
        const isDoubleTap = now - lastTapTime < 400 && moved < 30;
        lastTapTime = now;
        lastTapX = touch.clientX;
        lastTapY = touch.clientY;
        if (!isDoubleTap) {
            return;
        }
        lastTouchDoubleTapHandled = now;
        event.preventDefault();
        closeTreeContextMenu();
        const picked = getViewportDoubleClickTarget(touch.clientX, touch.clientY);
        if (!picked) {
            return;
        }
        selectObject(picked);
        toggleAnimatedObject(picked);
    });
    const hostMessageTarget = window.chrome && window.chrome.webview ? window.chrome.webview : window;
    hostMessageTarget.addEventListener("message", event => {
        handleHostMessage(event.data).catch(error => reportError(userErrorMessage(error, "Ошибка обработки сообщения приложения")));
    });
    window.addEventListener("error", event => {
        reportError(`Ошибка просмотрщика: ${event.message || "Неизвестная ошибка."}`);
    });
    window.addEventListener("unhandledrejection", event => {
        reportError(userErrorMessage(event.reason, "Ошибка просмотрщика"));
    });
}

async function initialize() {
    try {
        const threeModule = await import("./vendor/three.module.js").catch(error => {
            throw new Error(`Не удалось загрузить модуль Three.js: ${errorMessage(error)}`);
        });
        const loaderModule = await import("./vendor/loaders/GLTFLoader.js").catch(error => {
            throw new Error(`Не удалось загрузить GLTFLoader: ${errorMessage(error)}`);
        });
        const controlsModule = await import("./vendor/loaders/OrbitControls.js").catch(error => {
            throw new Error(`Не удалось загрузить OrbitControls: ${errorMessage(error)}`);
        });
        state.THREE = threeModule;
        state.GLTFLoader = loaderModule.GLTFLoader;
        state.OrbitControls = controlsModule.OrbitControls;
        if (!state.GLTFLoader || !state.OrbitControls) {
            throw new Error("Локальные модули Three.js не экспортируют GLTFLoader и OrbitControls.");
        }
        createScene();
        // Начальное состояние берём из разметки: автозагрузчик помечает
        // workspace как hidden ещё до запуска движка, панель не мелькает.
        setPanelsHidden(elements.workspace.dataset.panels === "hidden");
        bindEvents();
        clearModel();
        state.ready = true;
        hideLoading();
        setStatus("Просмотрщик готов.");
        startRenderLoop();
        window.modelViewerApi = {
            resetCamera,
            zoomCameraByStep,
            applyZoomAction,
            getZoomLimits,
            setPanelsHidden,
            getViewportToolbarDiagnostics,
            testViewportToolbar,
            dispatchZoomKey,
            selectObject,
            toggleAnimatedObject,
            findAnimationBinding,
            pickViewportObject,
            selectAnimation,
            toggleAnimation,
            resetSelectedAnimation,
            toggleDoor,
            setDisplayMode: applyDisplayMode,
            setBackgroundColor: applyBackgroundColor,
            getAnimationDiagnostics,
            getAnimationTimingDiagnostics,
            testAnimationTimingControls,
            testStatusLine,
            getBaseLightDiagnostics,
            getBeamRigDiagnostics,
            getBeamStateSummary,
            getBeamObserverDiagnostics,
            getBeamObserverDirectionVector,
            getBeamColorHex,
            placeBeamObserverView,
            setCameraAzimuth,
            measureModelDarkPixels,
            measureObserverLightViews,
            setBeamEnabled,
            setBeamControlValues,
            applyLightStateCommand,
            resetBeamSettings,
            testBeamRig,
            getGlowDiagnostics,
            getPartMeasurements,
            refreshSelectionMeasurements,
            setGlowEnabled,
            setGlowParameters,
            toggleSelectedGlow,
            resolveSelectionTarget,
            refreshPickTargets,
            getTreeDiagnostics,
            getShadowDiagnostics,
            getMarkerDiagnostics,
            getAnimationBindingDiagnostics,
            frameHardwareByName,
            probeMarkerMotion,
            testDisplayModes,
            getDisplayModeCatalog,
            testDisplayModeCatalog,
            getDisplayModeIds: () => DISPLAY_MODE_IDS.slice(),
            getPickStackDiagnostics,
            getVisibilityDiagnostics,
            hideTreeObjects,
            showAllTreeObjects,
            selectBlock,
            openTreeContextMenu,
            closeTreeContextMenu,
            getBlockSelectionKey,
            testPickStackCycling,
            testTreeBlockVisibility,
            applyCaptureScenario,
            measureTransparentProbe,
            testFirstAnimatedSelection,
            testMultiOpenAnimations,
            testSelectionOutlineHighlight,
            testClickSemantics,
            testEscapeClearsSelection,
            clearSelectionByEscape,
            dispatchEscapeKey,
            focusSelectionOutlineTarget: () => {
                const target = findSelectionOutlineTarget();
                selectObject(target);
                return target ? getObjectName(target) : null;
            },
            getStatusText: () => elements.statusText.textContent,
            getSelectionOutlineDiagnostics,
            getSelectionOutlineColor: () => colorToHexPadded(SELECTION_OUTLINE_COLOR),
            getStatus: () => elements.statusText.textContent,
            getLocation: () => window.location.href,

                    /**
                     * Загрузка модели по URL. Добавлено в копию просмотрщика для публикации:
                     * в источнике модель приходит от хоста WPF через base64-сообщение,
                     * а при раздаче по ссылке её нужно взять из сети самому.
                     */
                    loadModelFromUrl: async (url) => {
                      const response = await fetch(url);
                      if (!response.ok) {
                        throw new Error(`Не удалось загрузить модель: ${response.status}`);
                      }
                      const arrayBuffer = await response.arrayBuffer();
                      const slash = url.lastIndexOf("/");
                      return loadModel({
                        requestId: "url",
                        name: url.substring(slash + 1) || "model.glb",
                        path: url,
                        resourceBase: slash >= 0 ? url.substring(0, slash + 1) : "",
                        hasExternalResources: true,
                        packageMetadata: null,
                        arrayBuffer
                      });
                    },
                        };
        sendToHost({ type: "viewerReady", threeRevision: state.THREE.REVISION });
    } catch (error) {
        reportError(userErrorMessage(error, "Ошибка запуска просмотрщика"));
    }
}

initialize();
