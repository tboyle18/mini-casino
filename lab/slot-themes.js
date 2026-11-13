// The slot machines you can pick from on the casino floor. They all play the same game
// (lab/slots-math.js: the same odds, the same pays, the duck is wild on every one); each
// machine has its own name, cabinet colour and reel symbols. A machine's symbols stand in
// for the game's, lowest pay first: cherry, lemon, bell, clover, diamond, seven.
// No three.js here, so the casino can list the machines without loading the 3D code.

export const MACHINES = [
  { id: 'duck', name: 'Lucky Duck 3000', sign: ['LUCKY DUCK', '3000'], body: 0xa8001c, color: '#c8102e', emoji: '🦆',
    sym: { cherry: '🍒', lemon: '🍋', bell: '🔔', clover: '🍀', diamond: '💎', seven: '7' },
    names: { cherry: 'Cherry', lemon: 'Lemon', bell: 'Bell', clover: 'Clover', diamond: 'Diamond', seven: 'Lucky 7' } },
  { id: 'cherry', name: 'Cherry Bomb', sign: ['CHERRY', 'BOMB'], body: 0xc0245c, color: '#d8326a', emoji: '🍒',
    sym: { cherry: '🍒', lemon: '🍋', bell: '🍊', clover: '🍉', diamond: '💣', seven: '7' },
    names: { cherry: 'Cherry', lemon: 'Lemon', bell: 'Orange', clover: 'Melon', diamond: 'Bomb', seven: 'Lucky 7' } },
  { id: 'diamond', name: 'Diamond Dazzle', sign: ['DIAMOND', 'DAZZLE'], body: 0x1a50b8, color: '#1d5fd1', emoji: '💎',
    sym: { cherry: '🍒', lemon: '⭐', bell: '💍', clover: '👑', diamond: '💎', seven: '7' },
    names: { cherry: 'Cherry', lemon: 'Star', bell: 'Ring', clover: 'Crown', diamond: 'Diamond', seven: 'Lucky 7' } },
  { id: 'gold', name: 'Gold Rush', sign: ['GOLD', 'RUSH'], body: 0xc06a12, color: '#d97a1a', emoji: '💰',
    sym: { cherry: '🪙', lemon: '🌵', bell: '⛏️', clover: '🐎', diamond: '🪨', seven: '💰' },
    names: { cherry: 'Coin', lemon: 'Cactus', bell: 'Pickaxe', clover: 'Horse', diamond: 'Nugget', seven: 'Money bag' } },
  { id: 'dragon', name: 'Dragon Fortune', sign: ['DRAGON', 'FORTUNE'], body: 0x0c6a3c, color: '#0f7a45', emoji: '🐉',
    sym: { cherry: '🧧', lemon: '🏮', bell: '🥮', clover: '🐼', diamond: '💎', seven: '🐉' },
    names: { cherry: 'Red envelope', lemon: 'Lantern', bell: 'Mooncake', clover: 'Panda', diamond: 'Jade', seven: 'Dragon' } },
  { id: 'cosmic', name: 'Cosmic Cash', sign: ['COSMIC', 'CASH'], body: 0x5a1478, color: '#6a1a8a', emoji: '🚀',
    sym: { cherry: '⭐', lemon: '🌙', bell: '🪐', clover: '👽', diamond: '🛸', seven: '🚀' },
    names: { cherry: 'Star', lemon: 'Moon', bell: 'Planet', clover: 'Alien', diamond: 'Saucer', seven: 'Rocket' } },
  { id: 'mermaid', name: 'Mermaid Treasure', sign: ['MERMAID', 'TREASURE'], body: 0x0c7a7a, color: '#0f8a8a', emoji: '🧜‍♀️',
    sym: { cherry: '🐚', lemon: '🐠', bell: '🐙', clover: '🐬', diamond: '💎', seven: '🧜‍♀️' },
    names: { cherry: 'Shell', lemon: 'Fish', bell: 'Octopus', clover: 'Dolphin', diamond: 'Pearl', seven: 'Mermaid' } },
  { id: 'buffalo', name: 'Thunder Buffalo', sign: ['THUNDER', 'BUFFALO'], body: 0x7a3e14, color: '#8a4a1a', emoji: '🦬',
    sym: { cherry: '🌵', lemon: '🐺', bell: '🦅', clover: '⚡', diamond: '🌄', seven: '🦬' },
    names: { cherry: 'Cactus', lemon: 'Wolf', bell: 'Eagle', clover: 'Lightning', diamond: 'Canyon', seven: 'Buffalo' } },
];

export const machine = id => MACHINES.find(m => m.id === id) || MACHINES[0];
