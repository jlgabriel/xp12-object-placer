import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App.js';
import { installStubApi, hasRealCatalog, STUB_ENTRIES, type StubState } from './stubApi.js';
import { preventFileDrop } from '../preventFileDrop.js';
import { applyTheme } from '../theme.js';
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
// `?theme=light` dresses the harness in the other palette, which is the only way to look at both
// without a packaged build.
applyTheme(window.xop.initialTheme);

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
 *
 * And then obj-4..obj-7: four trucks in a row somebody dragged by hand. Not a decoration — it is the
 * only fixture the arrange tools can be looked at against. The row runs at about 60°, none of them
 * is quite on the line and the gaps are 25, 14 and 21 metres, so **Line up** and **Space evenly**
 * both have visible work to do, separately and in either order. Select the four and watch it happen;
 * pressing either button twice must do nothing the second time.
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

  store.arm('lib/airport/Common_Elements/Vehicles/Large_Fuel_Truck.obj');
  store.placeAt({ lon: -70.78472, lat: -33.37738 });
  store.placeAt({ lon: -70.78448, lat: -33.37727 });
  store.placeAt({ lon: -70.78435, lat: -33.37724 });
  store.placeAt({ lon: -70.78414, lat: -33.37711 });

  store.arm(null);
  store.select('obj-1');
  store.goTo({ lon: -70.7845, lat: -33.3768 }, 18);
}

if (state === 'placed') seedPlacements();

const root = document.getElementById('root');
if (!root) throw new Error('no #root in preview.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
