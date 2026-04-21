const held = new Set();

document.addEventListener('keydown', e => {
  held.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.key)) {
    e.preventDefault();
  }
});
document.addEventListener('keyup', e => held.delete(e.code));

export const isDown = code => held.has(code);
