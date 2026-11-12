// The graphics lab has moved into the casino: its demos are gone, and the lab page now just
// takes you to the casino floor (old links to the lab's arcade games go to the casino's Arcade).
const name = location.hash.slice(1);
location.replace(name === 'plinko' || name === 'crash' || name === 'slots' ? '/#arcade-' + name : '/#floor');
