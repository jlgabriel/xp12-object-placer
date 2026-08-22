import fs from 'node:fs';
const base = 'D:/Laminar/XP12-Last-Release/X-Plane 12/Resources/default scenery/airport scenery/';
const targets = {
  'Large_Fuel_Truck': 'Common_Elements/Vehicles/fuel_truck_small.obj',
  'Tower_14m_Sweden': 'Euro_Airports/Buildings/Towers/Tower_Europe_14m_Sweden.obj',
  'Hangar_A16x16_02': 'Common_Elements/Hangars/hangar_A16x16_02.obj',
};
for (const [name, rel] of Object.entries(targets)) {
  const lines = fs.readFileSync(base + rel, 'latin1').split(/\r\n|\r|\n/);
  let min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity], n = 0, lods = [];
  for (const L of lines) {
    if (/^VT\s/.test(L)) {
      const a = L.trim().split(/\s+/);
      for (let i=0;i<3;i++){ const v=+a[i+1]; if(v<min[i])min[i]=v; if(v>max[i])max[i]=v; }
      n++;
    } else if (/^ATTR_LOD\s/.test(L)) lods.push(L.trim().split(/\s+/).slice(1).join('-'));
  }
  console.log(`== ${name}`);
  console.log(`   VT ${n}  ·  W(E-O) ${(max[0]-min[0]).toFixed(1)} m  ·  H(alto) ${(max[1]-min[1]).toFixed(1)} m  ·  D(N-S) ${(max[2]-min[2]).toFixed(1)} m`);
  console.log(`   base Y: ${min[1].toFixed(2)} m   ·   LODs: ${lods.join(' | ') || 'ninguno'}`);
}
