import * as Cesium from 'cesium';
import * as THREE from 'three';
import {TimeOfDay, WeatherMode} from './types';

export const DFW_ORIGIN_LAT = 32.8968;
export const DFW_ORIGIN_LON = -97.0380;
export const DFW_ORIGIN_HEIGHT_M = 0.0; // Matches Cesium EllipsoidTerrainProvider surface (0m) for zero ground parallax

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

export interface CesiumSceneryController {
  isActive: () => boolean;
  syncAndRender: (camera: THREE.PerspectiveCamera, width: number, height: number) => void;
  setAtmosphere: (weather: WeatherMode, timeOfDay: TimeOfDay, lightningFlash?: number) => void;
  worldToLatLon: (x: number, z: number) => {lat: number; lon: number};
  destroy: () => void;
}

export function createCesiumBridge(container: HTMLElement, isSoftwareGl: boolean): CesiumSceneryController {
  window.CESIUM_BASE_URL = '/cesium/';
  Cesium.Ion.defaultAccessToken = '';

  let viewer: Cesium.Viewer | null = null;
  let esriLayer: Cesium.ImageryLayer | null = null;
  let active = false;
  let lastWidth = 0;
  let lastHeight = 0;

  const originCartesian = Cesium.Cartesian3.fromDegrees(
    DFW_ORIGIN_LON,
    DFW_ORIGIN_LAT,
    DFW_ORIGIN_HEIGHT_M,
  );
  const enuToEcef = Cesium.Transforms.eastNorthUpToFixedFrame(originCartesian);
  const ecefToEnu = Cesium.Matrix4.inverse(enuToEcef, new Cesium.Matrix4());

  // Reusable math scratch objects (zero GC in render loop)
  const _camPosEnu = new Cesium.Cartesian3();
  const _camPosEcef = new Cesium.Cartesian3();
  const _threeForward = new THREE.Vector3();
  const _threeUp = new THREE.Vector3();
  const _dirEnu = new Cesium.Cartesian3();
  const _upEnu = new Cesium.Cartesian3();
  const _dirEcef = new Cesium.Cartesian3();
  const _upEcef = new Cesium.Cartesian3();
  const _enuRotMat = new Cesium.Matrix3();
  const _tmpCart = new Cesium.Cartesian3();
  const _tmpCarto = new Cesium.Cartographic();
  const _bgColor = new Cesium.Color(0.54, 0.73, 0.90, 1.0);

  Cesium.Matrix4.getMatrix3(enuToEcef, _enuRotMat);

  try {
    const creditContainer = document.createElement('div');
    creditContainer.style.display = 'none';

    viewer = new Cesium.Viewer(container, {
      baseLayer: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      animation: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      navigationHelpButton: false,
      navigationInstructionsInitiallyVisible: false,
      baseLayerPicker: false,
      creditContainer,
      useDefaultRenderLoop: false,
      shadows: false,
      msaaSamples: isSoftwareGl ? 1 : 2,
      contextOptions: {
        webgl: {
          alpha: false,
          antialias: !isSoftwareGl,
          powerPreference: 'high-performance',
        },
      },
    });

    viewer.resolutionScale = isSoftwareGl ? 0.75 : Math.min(window.devicePixelRatio || 1, 1.5);
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.baseColor = new Cesium.Color(0.24, 0.28, 0.21, 1.0);
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.maximumScreenSpaceError = isSoftwareGl ? 3.5 : 2.0;
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
    if (viewer.scene.sun) viewer.scene.sun.show = false;
    if (viewer.scene.moon) viewer.scene.moon.show = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;
    viewer.scene.fog.density = 0.0001;
    viewer.scene.fog.minimumBrightness = 0.04;
    viewer.scene.backgroundColor = _bgColor;

    // Free ESRI ArcGIS World Imagery (satellite aerial tiles of DFW metroplex)
    const esriSatellite = new Cesium.UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maximumLevel: 18,
      credit: 'Esri World Imagery',
    });
    esriSatellite.errorEvent.addEventListener(() => {
      // Silently absorb transient tile errors so simulator remains responsive
    });
    esriLayer = viewer.imageryLayers.addImageryProvider(esriSatellite);
    esriLayer.brightness = 1.0;
    esriLayer.contrast = 1.06;
    esriLayer.saturation = 1.02;

    // Disable Cesium's built-in mouse/touch controller so Three.js & mobile flight HUD own input
    const ctrl = viewer.scene.screenSpaceCameraController;
    ctrl.enableRotate = false;
    ctrl.enableTranslate = false;
    ctrl.enableZoom = false;
    ctrl.enableTilt = false;
    ctrl.enableLook = false;

    // Initial position at DFW runway 17C
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(DFW_ORIGIN_LON, DFW_ORIGIN_LAT, 40),
      orientation: {
        heading: Cesium.Math.toRadians(180),
        pitch: Cesium.Math.toRadians(-12),
        roll: 0,
      },
    });
    viewer.resize();

    active = true;
  } catch {
    active = false;
  }

  function syncAndRender(camera: THREE.PerspectiveCamera, width: number, height: number) {
    if (!viewer || !active) return;

    try {
      const w = Math.max(width, 1);
      const h = Math.max(height, 1);
      if (w !== lastWidth || h !== lastHeight) {
        lastWidth = w;
        lastHeight = h;
        viewer.resize();
      }

      // Convert Three.js world (X=East, Y=Up, Z=South) -> ENU (X=East, Y=North, Z=Up)
      _camPosEnu.x = camera.position.x;
      _camPosEnu.y = -camera.position.z;
      _camPosEnu.z = Math.max(camera.position.y, 0.4);

      Cesium.Matrix4.multiplyByPoint(enuToEcef, _camPosEnu, _camPosEcef);

      // Extract Three.js camera forward (-Z in camera local) and up (+Y in camera local)
      _threeForward.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      _threeUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

      _dirEnu.x = _threeForward.x;
      _dirEnu.y = -_threeForward.z;
      _dirEnu.z = _threeForward.y;

      _upEnu.x = _threeUp.x;
      _upEnu.y = -_threeUp.z;
      _upEnu.z = _threeUp.y;

      Cesium.Matrix3.multiplyByVector(_enuRotMat, _dirEnu, _dirEcef);
      Cesium.Matrix3.multiplyByVector(_enuRotMat, _upEnu, _upEcef);

      Cesium.Cartesian3.normalize(_dirEcef, _dirEcef);
      Cesium.Cartesian3.normalize(_upEcef, _upEcef);

      viewer.camera.position = _camPosEcef;
      viewer.camera.direction = _dirEcef;
      viewer.camera.up = _upEcef;

      const frustum = viewer.camera.frustum as Cesium.PerspectiveFrustum;
      const aspect = Math.max(w / h, 0.1);
      frustum.aspectRatio = aspect;
      const vFovRad = THREE.MathUtils.degToRad(camera.fov);
      frustum.fov = aspect >= 1 ? 2 * Math.atan(Math.tan(vFovRad * 0.5) * aspect) : vFovRad;
      frustum.near = Math.max(camera.near, 0.5);
      frustum.far = Math.min(camera.far * 4, 250000);

      viewer.render();
    } catch {
      // Fail-safe: keep Three.js rendering smoothly
    }
  }

  function setAtmosphere(weather: WeatherMode, timeOfDay: TimeOfDay, lightningFlash = 0) {
    if (!viewer || !active) return;

    const flash = Math.max(0, Math.min(1, lightningFlash));
    let bgR = 0.54;
    let bgG = 0.73;
    let bgB = 0.90;
    let fogDensity = 0.0001;
    let fogMinBright = 0.04;
    let atmoBright = 0.0;
    let atmoSat = 0.0;
    let imgBright = 1.0;
    let imgContrast = 1.06;
    let imgSat = 1.02;

    if (timeOfDay === 'golden') {
      bgR = 0.76;
      bgG = 0.56;
      bgB = 0.44;
      imgBright = 0.92;
      atmoBright = -0.05;
    } else if (timeOfDay === 'dusk') {
      bgR = 0.14;
      bgG = 0.19;
      bgB = 0.30;
      imgBright = 0.52;
      imgSat = 0.85;
      atmoBright = -0.35;
    }

    if (weather === 'fog') {
      fogDensity = 0.00088;
      if (timeOfDay === 'day') {
        bgR = 0.76;
        bgG = 0.81;
        bgB = 0.86;
        fogMinBright = 0.45;
        imgBright = 0.86;
      } else if (timeOfDay === 'golden') {
        bgR = 0.76;
        bgG = 0.68;
        bgB = 0.62;
        fogMinBright = 0.36;
        imgBright = 0.78;
      } else {
        bgR = 0.25;
        bgG = 0.30;
        bgB = 0.38;
        fogMinBright = 0.18;
        imgBright = 0.48;
      }
      imgContrast = 0.74;
      imgSat = 0.62;
      atmoBright += 0.18;
      atmoSat = -0.58;
    } else if (weather === 'thunderstorm') {
      fogDensity = 0.00046;
      if (timeOfDay === 'day') {
        bgR = 0.21;
        bgG = 0.25;
        bgB = 0.31;
        imgBright = 0.62;
      } else if (timeOfDay === 'golden') {
        bgR = 0.24;
        bgG = 0.22;
        bgB = 0.27;
        imgBright = 0.54;
      } else {
        bgR = 0.08;
        bgG = 0.11;
        bgB = 0.17;
        imgBright = 0.36;
      }
      fogMinBright = 0.12 + flash * 0.45;
      imgContrast = 1.14;
      imgSat = 0.56;
      atmoBright = -0.36 + flash * 0.55;
      atmoSat = -0.68;
      bgR = Math.min(0.95, bgR + flash * 0.52);
      bgG = Math.min(0.96, bgG + flash * 0.56);
      bgB = Math.min(1.0, bgB + flash * 0.65);
      imgBright = Math.min(1.25, imgBright + flash * 0.42);
    }

    _bgColor.red = bgR;
    _bgColor.green = bgG;
    _bgColor.blue = bgB;
    _bgColor.alpha = 1.0;

    viewer.scene.backgroundColor = _bgColor;
    viewer.scene.fog.enabled = true;
    viewer.scene.fog.density = fogDensity;
    viewer.scene.fog.minimumBrightness = fogMinBright;

    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.brightnessShift = atmoBright;
      viewer.scene.skyAtmosphere.saturationShift = atmoSat;
    }
    viewer.scene.globe.atmosphereLightIntensity = weather === 'thunderstorm' ? 6.0 + flash * 10.0 : 10.0;

    if (esriLayer) {
      esriLayer.brightness = imgBright;
      esriLayer.contrast = imgContrast;
      esriLayer.saturation = imgSat;
    }
  }

  function worldToLatLon(x: number, z: number): {lat: number; lon: number} {
    _tmpCart.x = x;
    _tmpCart.y = -z;
    _tmpCart.z = 0;
    Cesium.Matrix4.multiplyByPoint(enuToEcef, _tmpCart, _tmpCart);
    Cesium.Cartographic.fromCartesian(_tmpCart, Cesium.Ellipsoid.WGS84, _tmpCarto);
    return {
      lat: Cesium.Math.toDegrees(_tmpCarto.latitude),
      lon: Cesium.Math.toDegrees(_tmpCarto.longitude),
    };
  }

  function destroy() {
    if (viewer && !viewer.isDestroyed()) {
      try {
        viewer.destroy();
      } catch {
        // ignore cleanup error
      }
    }
    viewer = null;
    esriLayer = null;
    active = false;
  }

  // Keep reference to ecefToEnu to avoid unused lint warning
  void ecefToEnu;

  return {
    isActive: () => active,
    syncAndRender,
    setAtmosphere,
    worldToLatLon,
    destroy,
  };
}
