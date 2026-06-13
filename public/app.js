const PRINT_WIDTH = 1800;
const PRINT_HEIGHT = 1200;
const STRIP_SHOTS = 3;

const elements = {
  captureView: document.querySelector('#captureView'),
  doneView: document.querySelector('#doneView'),
  appTitle: document.querySelector('#appTitle'),
  cameraVideo: document.querySelector('#cameraVideo'),
  previewCanvas: document.querySelector('#previewCanvas'),
  cameraPlaceholder: document.querySelector('#cameraPlaceholder'),
  connectionStatus: document.querySelector('#connectionStatus'),
  guestName: document.querySelector('#guestName'),
  stripTray: document.querySelector('#stripTray'),
  startCameraButton: document.querySelector('#startCameraButton'),
  captureButton: document.querySelector('#captureButton'),
  retakeButton: document.querySelector('#retakeButton'),
  submitButton: document.querySelector('#submitButton'),
  doneTitle: document.querySelector('#doneTitle'),
  doneImage: document.querySelector('#doneImage'),
  doneStatus: document.querySelector('#doneStatus'),
  newPhotoButton: document.querySelector('#newPhotoButton'),
  layoutButtons: [...document.querySelectorAll('[data-layout]')]
};

const state = {
  stream: null,
  layout: 'single_4x6',
  captures: [],
  renderedPrintDataUrl: '',
  sourceImageDataUrl: ''
};

function setStatus(message) {
  elements.connectionStatus.textContent = message;
}

function setLayout(layout) {
  state.layout = layout;
  state.captures = [];
  state.renderedPrintDataUrl = '';
  state.sourceImageDataUrl = '';
  elements.layoutButtons.forEach((button) => {
    const active = button.dataset.layout === layout;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderStripTray();
  resetPreview();
}

function renderStripTray() {
  elements.stripTray.hidden = state.layout !== 'strip';
  elements.stripTray.replaceChildren();
  if (state.layout !== 'strip') {
    return;
  }

  for (let index = 0; index < STRIP_SHOTS; index += 1) {
    const image = document.createElement('img');
    image.className = 'strip-thumb';
    image.alt = `Strip photo ${index + 1}`;
    if (state.captures[index]) {
      image.src = state.captures[index];
    }
    elements.stripTray.append(image);
  }
}

async function startCamera() {
  try {
    if (state.stream) {
      return;
    }

    setStatus('Opening camera');
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    elements.cameraVideo.srcObject = state.stream;
    elements.cameraPlaceholder.hidden = true;
    elements.captureButton.disabled = false;
    setStatus('Camera ready');
  } catch (error) {
    setStatus('Camera blocked');
    elements.cameraPlaceholder.innerHTML = '<strong>Camera access is blocked</strong><span>Allow camera permission and reload this page.</span>';
  }
}

function drawCoverImage(context, source, x, y, width, height) {
  const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
  const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const dx = x + (width - drawWidth) / 2;
  const dy = y + (height - drawHeight) / 2;
  context.drawImage(source, dx, dy, drawWidth, drawHeight);
}

function getVideoFrameDataUrl() {
  const canvas = document.createElement('canvas');
  canvas.width = PRINT_WIDTH;
  canvas.height = PRINT_HEIGHT;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, PRINT_WIDTH, PRINT_HEIGHT);
  drawCoverImage(context, elements.cameraVideo, 0, 0, PRINT_WIDTH, PRINT_HEIGHT);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function renderSinglePrint(dataUrl) {
  const image = await loadImage(dataUrl);
  const canvas = elements.previewCanvas;
  canvas.width = PRINT_WIDTH;
  canvas.height = PRINT_HEIGHT;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, PRINT_WIDTH, PRINT_HEIGHT);
  drawCoverImage(context, image, 0, 0, PRINT_WIDTH, PRINT_HEIGHT);
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function renderStripPrint(captures) {
  const images = await Promise.all(captures.map(loadImage));
  const canvas = elements.previewCanvas;
  canvas.width = PRINT_WIDTH;
  canvas.height = PRINT_HEIGHT;
  const context = canvas.getContext('2d');

  context.fillStyle = '#fffaf2';
  context.fillRect(0, 0, PRINT_WIDTH, PRINT_HEIGHT);
  context.fillStyle = '#172033';
  context.fillRect(88, 70, 472, 1060);
  context.fillStyle = '#ffffff';
  context.fillRect(112, 96, 424, 1010);

  const photoX = 140;
  const photoWidth = 368;
  const photoHeight = 236;
  const photoGap = 42;
  let photoY = 136;

  for (const image of images) {
    context.fillStyle = '#f8fafc';
    context.fillRect(photoX - 8, photoY - 8, photoWidth + 16, photoHeight + 16);
    drawCoverImage(context, image, photoX, photoY, photoWidth, photoHeight);
    photoY += photoHeight + photoGap;
  }

  context.fillStyle = '#bf5044';
  context.font = '700 34px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText('Wedding Memories', 324, 1018);

  context.fillStyle = '#486c6a';
  context.font = '700 60px system-ui, sans-serif';
  context.textAlign = 'left';
  context.fillText('Thanks for celebrating with us', 680, 360);
  context.fillStyle = '#172033';
  context.font = '500 42px system-ui, sans-serif';
  context.fillText('Pick up your print at the photo table.', 680, 440);

  const hero = images[images.length - 1];
  drawCoverImage(context, hero, 680, 520, 900, 520);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function showPreview() {
  elements.previewCanvas.style.display = 'block';
  elements.retakeButton.hidden = false;
  elements.submitButton.hidden = false;
  elements.captureButton.hidden = true;
}

function resetPreview() {
  elements.previewCanvas.style.display = 'none';
  elements.retakeButton.hidden = true;
  elements.submitButton.hidden = true;
  elements.captureButton.hidden = false;
  elements.captureButton.textContent = state.layout === 'strip'
    ? `Take Photo ${state.captures.length + 1}/${STRIP_SHOTS}`
    : 'Take Photo';
}

async function capturePhoto() {
  if (!state.stream) {
    await startCamera();
  }

  const capture = getVideoFrameDataUrl();
  state.sourceImageDataUrl = capture;

  if (state.layout === 'single_4x6') {
    state.captures = [capture];
    state.renderedPrintDataUrl = await renderSinglePrint(capture);
    showPreview();
    setStatus('Preview ready');
    return;
  }

  state.captures.push(capture);
  renderStripTray();
  if (state.captures.length < STRIP_SHOTS) {
    elements.captureButton.textContent = `Take Photo ${state.captures.length + 1}/${STRIP_SHOTS}`;
    setStatus(`${STRIP_SHOTS - state.captures.length} left`);
    return;
  }

  state.renderedPrintDataUrl = await renderStripPrint(state.captures);
  showPreview();
  setStatus('Preview ready');
}

function retake() {
  state.captures = [];
  state.renderedPrintDataUrl = '';
  state.sourceImageDataUrl = '';
  elements.appTitle.textContent = 'Take a photo for the print table';
  elements.connectionStatus.hidden = false;
  renderStripTray();
  resetPreview();
  setStatus('Ready');
}

async function submitPrint() {
  elements.submitButton.disabled = true;
  setStatus('Sending');
  try {
    const response = await fetch('/api/print-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guestName: elements.guestName.value,
        layout: state.layout,
        sourceImageDataUrl: state.sourceImageDataUrl,
        renderedPrintDataUrl: state.renderedPrintDataUrl
      })
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'Could not send print job.');
    }

    elements.captureView.hidden = true;
    elements.doneView.hidden = false;
    elements.appTitle.textContent = 'Print status';
    elements.connectionStatus.hidden = true;
    elements.doneImage.src = state.renderedPrintDataUrl;
    elements.doneTitle.textContent = 'Sending your photo.';
    elements.doneStatus.textContent = body.job.statusMessage || 'Creating your print job.';
    watchJob(body.job.id);
  } catch (error) {
    setStatus('Send failed');
    alert(error.message);
  } finally {
    elements.submitButton.disabled = false;
  }
}

async function watchJob(jobId) {
  const update = async () => {
    const response = await fetch(`/api/print-jobs/${jobId}`);
    if (!response.ok) {
      return;
    }
    const { job } = await response.json();
    const labels = {
      queued: 'Waiting for the print station.',
      printing: 'Printing your photo now.',
      printed: 'Printed. Pick it up at the photo table.',
      failed: job.errorMessage || 'Printing failed. Please ask the photo table.'
    };
    const titles = {
      queued: 'Your photo is queued.',
      printing: 'Your photo is printing.',
      printed: 'Your photo printed.',
      failed: 'Printing needs help.'
    };
    elements.doneTitle.textContent = titles[job.status] || 'Checking your print.';
    elements.doneStatus.textContent = job.statusMessage || labels[job.status] || 'Waiting for update.';
    if (!['printed', 'failed'].includes(job.status)) {
      window.setTimeout(update, 2500);
    }
  };
  update();
}

async function bootStatusPage() {
  const match = window.location.pathname.match(/^\/print\/([^/]+)$/);
  if (!match) {
    return false;
  }

  elements.captureView.hidden = true;
  elements.doneView.hidden = false;
  elements.appTitle.textContent = 'Print status';
  elements.connectionStatus.hidden = true;
  elements.doneTitle.textContent = 'Checking your print.';
  elements.doneImage.hidden = true;
  await watchJob(match[1]);
  return true;
}

elements.layoutButtons.forEach((button) => {
  button.addEventListener('click', () => setLayout(button.dataset.layout));
});
elements.startCameraButton.addEventListener('click', startCamera);
elements.captureButton.addEventListener('click', capturePhoto);
elements.retakeButton.addEventListener('click', retake);
elements.submitButton.addEventListener('click', submitPrint);
elements.newPhotoButton.addEventListener('click', () => {
  elements.doneView.hidden = true;
  elements.captureView.hidden = false;
  elements.doneImage.hidden = false;
  elements.connectionStatus.hidden = false;
  retake();
});

setLayout('single_4x6');
bootStatusPage();
