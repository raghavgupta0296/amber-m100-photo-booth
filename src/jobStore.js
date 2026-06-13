import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const VALID_LAYOUTS = new Set(['single_4x6', 'strip']);
const VALID_STATUSES = new Set(['queued', 'printing', 'printed', 'failed']);
const DATA_URL_PATTERN = /^data:image\/(jpeg|jpg|png|webp);base64,/i;
const DEFAULT_STATUS_MESSAGES = {
  queued: 'Waiting for the print station.',
  printing: 'Printing your photo now.',
  printed: 'Printed. Pick it up at the photo table.',
  failed: 'Printing failed. Please ask the photo table.'
};

export function createJobStore(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const dataDir = options.dataDir ?? path.join(rootDir, 'data');
  const uploadDir = options.uploadDir ?? path.join(rootDir, 'uploads');
  const jobsPath = options.jobsPath ?? path.join(dataDir, 'jobs.json');

  let writeChain = Promise.resolve();

  async function ensureStorage() {
    await mkdir(dataDir, { recursive: true });
    await mkdir(uploadDir, { recursive: true });
    try {
      await readFile(jobsPath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      await writeFile(jobsPath, '[]\n', 'utf8');
    }
  }

  async function readJobs() {
    await ensureStorage();
    const raw = await readFile(jobsPath, 'utf8');
    const jobs = JSON.parse(raw || '[]');
    if (!Array.isArray(jobs)) {
      throw new Error('Job store is corrupt: expected an array.');
    }
    return jobs.map((job) => ({
      statusMessage: DEFAULT_STATUS_MESSAGES[job.status] ?? '',
      ...job
    }));
  }

  async function writeJobs(jobs) {
    await ensureStorage();
    const tempPath = `${jobsPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(jobs, null, 2)}\n`, 'utf8');
    await rename(tempPath, jobsPath);
  }

  function withWriteLock(operation) {
    const next = writeChain.then(operation, operation);
    writeChain = next.catch(() => {});
    return next;
  }

  async function saveDataUrl(dataUrl, filenameBase) {
    await ensureStorage();

    if (typeof dataUrl !== 'string' || !DATA_URL_PATTERN.test(dataUrl)) {
      throw new Error('Expected a base64 image data URL.');
    }

    const extensionMatch = dataUrl.match(DATA_URL_PATTERN);
    const extension = extensionMatch[1].toLowerCase() === 'jpg' ? 'jpg' : extensionMatch[1].toLowerCase();
    const body = dataUrl.replace(DATA_URL_PATTERN, '');
    const bytes = Buffer.from(body, 'base64');

    if (bytes.length < 1024) {
      throw new Error('Image upload is too small to be valid.');
    }
    if (bytes.length > 12 * 1024 * 1024) {
      throw new Error('Image upload is too large. Please submit a smaller photo.');
    }

    const filename = `${filenameBase}.${extension}`;
    await writeFile(path.join(uploadDir, filename), bytes);
    return `/uploads/${filename}`;
  }

  async function createJob(input) {
    return withWriteLock(async () => {
      const layout = input.layout;
      if (!VALID_LAYOUTS.has(layout)) {
        throw new Error('Invalid layout.');
      }

      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const sourceImageUrl = await saveDataUrl(input.sourceImageDataUrl, `${id}-source`);
      const renderedPrintUrl = await saveDataUrl(input.renderedPrintDataUrl, `${id}-print`);

      const guestName = typeof input.guestName === 'string' ? input.guestName.trim().slice(0, 80) : '';
      const job = {
        id,
        status: 'queued',
        layout,
        guestName,
        sourceImageUrl,
        renderedPrintUrl,
        createdAt,
        printedAt: null,
        errorMessage: '',
        statusMessage: 'Waiting for the print station.'
      };

      const jobs = await readJobs();
      jobs.push(job);
      await writeJobs(jobs);
      return job;
    });
  }

  async function getJob(id) {
    const jobs = await readJobs();
    return jobs.find((job) => job.id === id) ?? null;
  }

  async function getNextQueuedJob() {
    return withWriteLock(async () => {
      const jobs = await readJobs();
      const job = jobs.find((candidate) => candidate.status === 'queued');
      if (!job) {
        return null;
      }
      job.status = 'printing';
      job.errorMessage = '';
      job.statusMessage = 'Sending your photo to the printer.';
      await writeJobs(jobs);
      return job;
    });
  }

  async function updateJobStatus(id, status, errorMessage = '', statusMessage = '') {
    return withWriteLock(async () => {
      if (!VALID_STATUSES.has(status)) {
        throw new Error('Invalid status.');
      }

      const jobs = await readJobs();
      const job = jobs.find((candidate) => candidate.id === id);
      if (!job) {
        return null;
      }

      job.status = status;
      job.errorMessage = typeof errorMessage === 'string' ? errorMessage.slice(0, 500) : '';
      job.statusMessage = typeof statusMessage === 'string' ? statusMessage.slice(0, 500) : '';
      job.printedAt = status === 'printed' ? new Date().toISOString() : job.printedAt;
      await writeJobs(jobs);
      return job;
    });
  }

  return {
    createJob,
    getJob,
    getNextQueuedJob,
    updateJobStatus
  };
}
