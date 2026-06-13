import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function envValue(name, fallback = '') {
  const value = process.env[name] ?? fallback;
  return value.replace(/^"|"$/g, '');
}

const BASE_URL = envValue('PHOTOBOOTH_BASE_URL', 'http://localhost:3000');
const STATION_TOKEN = envValue('PRINT_STATION_TOKEN', 'dev-print-station-token');
const PRINTER_NAME = envValue('PRINTER_NAME', 'Liene Photo Printer');
const SUMATRA_PATH = envValue('SUMATRA_PATH');
const PRINT_COMMAND = envValue('PRINT_COMMAND');
const PRINT_BACKEND = envValue('PRINT_BACKEND', process.platform === 'win32' ? 'windows-imageview' : 'sumatra');
const POLL_MS = Number(process.env.POLL_MS ?? 2500);
const PRINT_QUEUE_POLL_MS = Number(process.env.PRINT_QUEUE_POLL_MS ?? 1500);
const PRINT_QUEUE_ACCEPT_TIMEOUT_MS = Number(process.env.PRINT_QUEUE_ACCEPT_TIMEOUT_MS ?? 15000);
const PRINT_QUEUE_DONE_TIMEOUT_MS = Number(process.env.PRINT_QUEUE_DONE_TIMEOUT_MS ?? 180000);
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR ?? path.join(process.cwd(), 'print-station-downloads');
const DRY_RUN = process.env.DRY_RUN === '1';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function stationFetch(pathname, options = {}) {
  const response = await fetch(new URL(pathname, BASE_URL), {
    ...options,
    headers: {
      authorization: `Bearer ${STATION_TOKEN}`,
      ...(options.headers ?? {})
    }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body;
}

async function updateStatus(jobId, status, errorMessage = '', statusMessage = '') {
  await stationFetch(`/api/print-jobs/${jobId}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status, errorMessage, statusMessage })
  });
}

async function downloadRenderedPrint(job) {
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  const fileUrl = new URL(job.renderedPrintUrl, BASE_URL);
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Could not download rendered print: HTTP ${response.status}`);
  }

  const extension = path.extname(fileUrl.pathname) || '.jpg';
  const filePath = path.join(DOWNLOAD_DIR, `${job.id}${extension}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, bytes);
  return filePath;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      windowsHide: true
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function startCommand(command, args) {
  const child = spawn(command, args, {
    stdio: 'ignore',
    windowsHide: true,
    detached: false
  });
  child.on('error', (error) => {
    console.error(`Could not start ${command}: ${error.message}`);
  });
  return child;
}

function runCaptureCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error((stderr || stdout || `${command} exited with code ${code}`).trim()));
      }
    });
  });
}

function expandPrintCommand(filePath) {
  if (!PRINT_COMMAND) {
    return null;
  }

  const parts = PRINT_COMMAND.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return parts.map((part) => (
    part
      .replace(/^"|"$/g, '')
      .replaceAll('{file}', filePath)
      .replaceAll('{printer}', PRINTER_NAME)
  ));
}

async function printFile(filePath) {
  if (DRY_RUN) {
    console.log(`[dry-run] Would print ${filePath} to ${PRINTER_NAME}`);
    return;
  }

  const expandedCommand = expandPrintCommand(filePath);
  if (expandedCommand) {
    const [command, ...args] = expandedCommand;
    await runCommand(command, args);
    return;
  }

  if (PRINT_BACKEND === 'windows-imageview') {
    if (process.platform !== 'win32') {
      throw new Error('PRINT_BACKEND=windows-imageview only works on Windows.');
    }

    console.log(`Sending ${path.basename(filePath)} to ${PRINTER_NAME} with Windows image print`);
    startCommand('rundll32.exe', [
      'shimgvw.dll,ImageView_PrintTo',
      filePath,
      PRINTER_NAME
    ]);
    return;
  }

  if (PRINT_BACKEND === 'sumatra' && SUMATRA_PATH) {
    console.log(`Sending ${path.basename(filePath)} to ${PRINTER_NAME} with SumatraPDF`);
    await runCommand(SUMATRA_PATH, [
      '-print-to',
      PRINTER_NAME,
      '-print-settings',
      'fit',
      '-silent',
      filePath
    ]);
    return;
  }

  if (PRINT_BACKEND === 'sumatra') {
    throw new Error('Set SUMATRA_PATH before running the print station with PRINT_BACKEND=sumatra.');
  }

  throw new Error(`Unknown PRINT_BACKEND "${PRINT_BACKEND}". Use windows-imageview, sumatra, or PRINT_COMMAND.`);
}

function parseWmicList(output) {
  return output
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((block) => {
      const item = {};
      for (const line of block.split('\n')) {
        const separator = line.indexOf('=');
        if (separator === -1) {
          continue;
        }
        item[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
      }
      return item;
    })
    .filter((item) => Object.keys(item).length > 0);
}

async function getPrinterJobs() {
  const output = await runCaptureCommand('wmic.exe', [
    'path',
    'Win32_PrintJob',
    'get',
    'Name,Document,JobStatus,Status,Size',
    '/format:list'
  ]);
  return parseWmicList(output).filter((printJob) => (
    printJob.Name === PRINTER_NAME || printJob.Name?.startsWith(`${PRINTER_NAME},`)
  ));
}

function describePrintJob(printJob) {
  const rawStatus = `${printJob.JobStatus ?? ''} ${printJob.Status ?? ''}`.toLowerCase();
  if (/error|offline|paper|blocked|paused|deleting|user intervention/.test(rawStatus)) {
    return {
      failed: true,
      message: 'The printer needs attention. Please check the printer and paper.'
    };
  }
  if (/spooling/.test(rawStatus)) {
    return { failed: false, message: 'Preparing your photo for the printer.' };
  }
  if (/printing/.test(rawStatus)) {
    return { failed: false, message: 'Printing your photo now.' };
  }
  return { failed: false, message: 'Your photo is in the printer queue.' };
}

async function waitForPrinterToFinish(jobId) {
  if (DRY_RUN) {
    await updateStatus(jobId, 'printed', '', 'Dry run complete.');
    return;
  }

  if (process.platform !== 'win32' || PRINT_COMMAND || PRINT_BACKEND !== 'windows-imageview') {
    await updateStatus(jobId, 'printed', '', 'Sent to the printer.');
    return;
  }

  const acceptedDeadline = Date.now() + PRINT_QUEUE_ACCEPT_TIMEOUT_MS;
  const doneDeadline = Date.now() + PRINT_QUEUE_DONE_TIMEOUT_MS;
  let accepted = false;

  while (Date.now() < doneDeadline) {
    let printerJobs;
    try {
      printerJobs = await getPrinterJobs();
    } catch (error) {
      throw new Error(`Could not read the Windows print queue: ${error.message}`);
    }

    if (printerJobs.length > 0) {
      accepted = true;
      const currentJob = printerJobs[0];
      const { failed, message } = describePrintJob(currentJob);
      if (failed) {
        throw new Error(message);
      }
      await updateStatus(jobId, 'printing', '', message);
    } else if (accepted) {
      await updateStatus(jobId, 'printed', '', 'Printed. Pick it up at the photo table.');
      return;
    } else if (Date.now() > acceptedDeadline) {
      throw new Error('The printer did not confirm this job. Please check the printer and try again.');
    } else {
      await updateStatus(jobId, 'printing', '', 'Waiting for the printer to accept your photo.');
    }

    await sleep(PRINT_QUEUE_POLL_MS);
  }

  throw new Error('Printing is taking longer than expected. Please check the printer.');
}

async function processJob(job) {
  console.log(`Printing job ${job.id} (${job.layout})`);
  try {
    const filePath = await downloadRenderedPrint(job);
    await updateStatus(job.id, 'printing', '', 'Sending your photo to the printer.');
    await printFile(filePath);
    await waitForPrinterToFinish(job.id);
    console.log(`Printed job ${job.id}`);
  } catch (error) {
    await updateStatus(job.id, 'failed', error.message, error.message);
    console.error(`Failed job ${job.id}: ${error.message}`);
  }
}

async function main() {
  console.log(`Print station connected to ${BASE_URL}`);
  console.log(`Printer name: ${PRINTER_NAME}`);
  console.log(`Print backend: ${PRINT_COMMAND ? 'custom command' : PRINT_BACKEND}`);
  if (DRY_RUN) {
    console.log('Dry run mode is enabled. Jobs will be marked printed without sending to a printer.');
  }

  while (true) {
    try {
      const { job } = await stationFetch('/api/print-jobs/next');
      if (job) {
        await processJob(job);
      } else {
        await sleep(POLL_MS);
      }
    } catch (error) {
      console.error(`Print station error: ${error.message}`);
      await sleep(POLL_MS);
    }
  }
}

main();
