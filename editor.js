const TILE = 64;
const canvas = document.createElement('canvas');
canvas.width = 800;
canvas.height = 450;
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');

let tiles = [];
let enemies = [];
let checkpoints = [];
let mode = 'tile';

document.body.insertAdjacentHTML('beforeend', `
  <button onclick="mode='tile'">Tile</button>
  <button onclick="mode='enemy'">Enemy</button>
  <button onclick="mode='checkpoint'">Checkpoint</button>
`);

canvas.onclick = e => {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / TILE);
  const y = Math.floor((e.clientY - r.top) / TILE);

  const target = mode === 'tile' ? tiles :
                 mode === 'enemy' ? enemies : checkpoints;

  const i = target.findIndex(o => o.x === x && o.y === y);
  i >= 0 ? target.splice(i, 1) : target.push({ x, y });
  draw();
};

function draw() {
  ctx.clearRect(0,0,800,450);
  ctx.strokeStyle='#ccc';
  for(let x=0;x<800;x+=TILE)
    for(let y=0;y<450;y+=TILE)
      ctx.strokeRect(x,y,TILE,TILE);

  tiles.forEach(t => drawBox(t,'#ff0'));
  enemies.forEach(e => drawBox(e,'#f00'));
  checkpoints.forEach(c => drawBox(c,'#0f0'));
}

function drawBox(o,color){
  ctx.fillStyle=color;
  ctx.fillRect(o.x*TILE,o.y*TILE,TILE,TILE);
}

function exportLevel(){
  const data={ tiles, enemies, checkpoints };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='level1.json';
  a.click();
}

draw();
