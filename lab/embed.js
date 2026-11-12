// The arcade games the casino app runs itself, on the wallet (see mini-casino.html). Each one
// exports mount({ stage, controls, info, bank }) and returns { dispose() }.
export const games = {
  plinko: () => import('./plinko.js'),
  crash: () => import('./crash.js'),
  slots: () => import('./slots.js'),
};


// The 3D roulette wheel for the spin screen (lab/roulette.js, mountCasinoWheel)
export const roulette = () => import('./roulette.js');

// The 3D blackjack table for the solo game (lab/table.js, mountCasinoTable)
export const table = () => import('./table.js');

// The big-win celebration over the whole screen (lab/celebrate.js, celebrate)
export const celebrate = () => import('./celebrate.js');

// The casino floor (beta): glide between the games and take a seat (lab/floor.js)
export const floor = () => import('./floor.js');
