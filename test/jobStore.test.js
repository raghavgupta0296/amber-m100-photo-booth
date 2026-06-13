import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createJobStore } from '../src/jobStore.js';

const tinyJpegDataUrl = `data:image/jpeg;base64,${Buffer.alloc(2048, 1).toString('base64')}`;

test('creates and claims a queued print job', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'photo-booth-'));
  const store = createJobStore({ rootDir });

  const created = await store.createJob({
    layout: 'single_4x6',
    guestName: 'A Guest',
    sourceImageDataUrl: tinyJpegDataUrl,
    renderedPrintDataUrl: tinyJpegDataUrl
  });

  assert.equal(created.status, 'queued');
  assert.equal(created.layout, 'single_4x6');
  assert.equal(created.guestName, 'A Guest');

  const claimed = await store.getNextQueuedJob();
  assert.equal(claimed.id, created.id);
  assert.equal(claimed.status, 'printing');
  assert.equal(claimed.statusMessage, 'Sending your photo to the printer.');

  const updated = await store.updateJobStatus(created.id, 'printed', '', 'Printed. Pick it up at the photo table.');
  assert.equal(updated.status, 'printed');
  assert.equal(updated.statusMessage, 'Printed. Pick it up at the photo table.');
  assert.ok(updated.printedAt);
});

test('rejects invalid layouts', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'photo-booth-'));
  const store = createJobStore({ rootDir });

  await assert.rejects(
    () => store.createJob({
      layout: 'wallet',
      sourceImageDataUrl: tinyJpegDataUrl,
      renderedPrintDataUrl: tinyJpegDataUrl
    }),
    /Invalid layout/
  );
});
