import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App.js';
import { installStubApi, hasRealCatalog, STUB_ENTRIES, type StubState } from './stubApi.js';
import { preventFileDrop } from '../preventFileDrop.js';
import { editorStore } from '../state/editorStore.js';
import '../styles.css';

// The stub has to exist before App's first effect runs, so this happens at module scope.
const params = new URLSearchParams(location.search);
const state = (params.get('state') ?? 'catalog') as StubState;
// `?catalog=real` serves this machine's own scan instead of the thirty hand-made entries, which is
// the only way the harness can answer a question about scale. It says so if it cannot: a harness
// that silently fell back to the small fixture would report a fast list and a tidy tree, and both
// would be about the fixture.
const real = params.get('catalog') === 'real';
if (real && !hasRealCatalog()) {
  console.warn('[preview] ?catalog=real, but src/renderer/dev/catalog.local.json is not there');
}
installStubApi(state, real);
preventFileDrop();

/**
 * Put objects on the map before anything renders, so the drawing can be checked without first
 * driving a placement by hand.
 *
 * Seeded through the store's own actions rather than a back door, so the preview cannot drift into
 * a state the application itself could never reach. Ids come out as obj-1, obj-2, obj-3 — the store
 * counts, deliberately, and a test can name them.
 *
 * The choice of objects is the point of the fixture:
 *   obj-1  a hangar anchored at its front wall, turned 30° — the box reaches away from the anchor,
 *          so if the origin were assumed to be the centre it would sit visibly in the wrong place
 *   obj-2  a fuel truck at rotation 0, which in the simulator faces SOUTH, not north
 *   obj-3  a library path this installation does not have — the dashed placeholder
 */
function seedPlacements(): void {
  const store = editorStore.getState();
  store.setCatalog(STUB_ENTRIES);

  store.arm('lib/airport/hangars/arched/16x16/rusted_1.obj');
  store.placeAt({ lon: -70.78462, lat: -33.3762 });
  store.rotateObject('obj-1', 30);

  store.arm('lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj');
  store.placeAt({ lon: -70.7838, lat: -33.37655 });

  store.arm('lib/some_library_you_do_not_have/shed.obj');
  store.placeAt({ lon: -70.78515, lat: -33.37695 });

  store.arm(null);
  store.select('obj-1');
  store.goTo({ lon: -70.7845, lat: -33.3766 }, 18);
}

if (state === 'placed') seedPlacements();

const root = document.getElementById('root');
if (!root) throw new Error('no #root in preview.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
