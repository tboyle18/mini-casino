// The arcade games the casino app runs itself, on the wallet (see mini-casino.html). Each one
// exports mount({ stage, controls, info, bank }) and returns { dispose() }, like the lab demos.
export const games = {
  plinko: () => import('./plinko.js'),
  crash: () => import('./crash.js'),
};

// The slot-machine hall behind the home screen (lab/lobby.js)
export const lobby = () => import('./lobby.js');
