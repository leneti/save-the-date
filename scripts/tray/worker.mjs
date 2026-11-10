// One render worker: traces every n-th row into the shared buffers.
import { parentPort, workerData } from 'node:worker_threads';
import { makeTracer } from './tracer.mjs';

const { cfg, scale, spp, id, n, shared, sharedAux } = workerData;
const tracer = makeTracer(cfg);
const out = new Float32Array(shared);
const aux = new Float32Array(sharedAux);
const width = cfg.W * scale;
const height = cfg.H * scale;
for (let j = id; j < height; j += n) tracer.renderRow(j, scale, spp, out, j * width * 4, aux);
parentPort.postMessage({ done: true });
