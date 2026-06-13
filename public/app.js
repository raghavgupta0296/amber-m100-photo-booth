const PRINT_WIDTH = 1800;
const PRINT_HEIGHT = 1200;
const STRIP_SHOTS = 3;

const elements = {
  captureView: document.querySelector('#captureView'),
  doneView: document.querySelector('#doneView'),
  appTitle: document.querySelector('#appTitle'),
  cropStage: document.querySelector('#cropStage'),
  cropImage: document.querySelector('#cropImage'),
  cameraVideo: document.querySelector('#cameraVideo'),
  previewCanvas: document.querySelector('#previewCanvas'),
  emptyState: document.querySelector('#emptyState'),
  connectionStatus: document.querySelector('#connectionStatus'),
  guestName: document.querySelector('#guestName'),
  stripTray: document.querySelector('#stripTray'),
  photoInput: document.querySelector('#photoInput'),
  zoomRange: document.querySelector('#zoomRange'),
  cropTools: document.querySelector('#cropTools'),
  choosePhotoButton: document.querySelector('#choosePhotoButton'),
  fallbackCameraButton: document.querySelector('#fallbackCameraButton'),
  retakeButton: document.querySelector('#retakeButton'),
  acceptButton: document.querySelector('#acceptButton'),
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
  mode: 'empty',
  captures: [],
  renderedPrintDataUrl: '',
  sourceImageDataUrl: '',
  activeImage: null,
  objectUrl: '',
  crop: {
    scale: 1,
    minScale: 1,
    offsetX: 0,
    offsetY: 0,
    imageWidth: 0,
    imageHeight: 0,
    stageWidth: 0,
    stageHeight: 0
  },
  drag: {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0
  }
};

function setStatus(message) {
  elements.connectionStatus.textContent = message;
}

function setMode(mode) {
  state.mode = mode;
  const isEmpty = mode === 'empty';
  const isAdjusting = mode === 'adjusting';
  const isPreview = mode === 'preview';
  const isCamera = mode === 'camera';

  elements.emptyState.hidden = !isEmpty;
  elements.cropImage.style.display = isAdjusting ? 'block' : 'none';
  elements.cameraVideo.style.display = isCamera ? 'block' : 'none';
  elements.previewCanvas.style.display = isPreview ? 'block' : 'none';
  elements.cropTools.hidden = !isAdjusting;
  elements.choosePhotoButton.hidden = isAdjusting || isPreview || isCamera;
  elements.fallbackCameraButton.hidden = isNativeCaptureAvailable() || !isCameraFallbackAvailable() || isAdjusting || isPreview || isCamera;
  elements.retakeButton.hidden = isEmpty || isCamera;
  elements.acceptButton.hidden = !isAdjusting && !isCamera;
  elements.submitButton.hidden = !isPreview;
  elements.cropStage.classList.toggle('adjusting', isAdjusting || isCamera);
}

function isCameraFallbackAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

function isNativeCaptureAvailable() {
  return typeof window.FileReader === 'function' && 'files' in elements.photoInput;
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
  resetCapture();
}

function renderStripTray() {
  elements.stripTray.hidden = state.layout !== 'strip';
  elements.stripTray.replaceChildren();
  if (state.layout !== 'strip') {
    return;
  }

  for (let index = 0; index < STRIP_SHOTS; index += 1) {
    if (state.captures[index]) {
      const image = document.createElement('img');
      image.className = 'strip-thumb';
      image.alt = `Strip photo ${index + 1}`;
      image.src = state.captures[index];
      elements.stripTray.append(image);
    } else {
      const slot = document.createElement('div');
      slot.className = 'strip-thumb';
      slot.textContent = `${index + 1}`;
      elements.stripTray.append(slot);
    }
  }
}

function clearObjectUrl() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }
}

function stopCamera() {
  if (!state.stream) {
    return;
  }
  state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null;
  elements.cameraVideo.srcObject = null;
}

function resetCrop() {
  state.activeImage = null;
  state.crop = {
    scale: 1,
    minScale: 1,
    offsetX: 0,
    offsetY: 0,
    imageWidth: 0,
    imageHeight: 0,
    stageWidth: 0,
    stageHeight: 0
  };
  elements.zoomRange.value = '1';
}

function resetCapture() {
  stopCamera();
  clearObjectUrl();
  resetCrop();
  elements.photoInput.value = '';
  setMode('empty');
  const nextShot = state.layout === 'strip' ? ` ${state.captures.length + 1}/${STRIP_SHOTS}` : '';
  elements.appTitle.textContent = state.layout === 'strip' ? `Capture strip photo${nextShot}` : 'Make a 4x6 keepsake';
  setStatus('Ready');
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

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function constrainCrop() {
  const crop = state.crop;
  const drawWidth = crop.imageWidth * crop.scale;
  const drawHeight = crop.imageHeight * crop.scale;
  const maxOffsetX = Math.max(0, (drawWidth - crop.stageWidth) / 2);
  const maxOffsetY = Math.max(0, (drawHeight - crop.stageHeight) / 2);
  crop.offsetX = clamp(crop.offsetX, -maxOffsetX, maxOffsetX);
  crop.offsetY = clamp(crop.offsetY, -maxOffsetY, maxOffsetY);
}

function applyCropTransform() {
  constrainCrop();
  const crop = state.crop;
  elements.cropImage.style.width = `${crop.imageWidth}px`;
  elements.cropImage.style.height = `${crop.imageHeight}px`;
  elements.cropImage.style.left = `${(crop.stageWidth - crop.imageWidth) / 2}px`;
  elements.cropImage.style.top = `${(crop.stageHeight - crop.imageHeight) / 2}px`;
  elements.cropImage.style.transform = `translate(${crop.offsetX}px, ${crop.offsetY}px) scale(${crop.scale})`;
}

function initializeCropForImage(image) {
  const stageRect = elements.cropStage.getBoundingClientRect();
  const stageWidth = Math.max(1, stageRect.width);
  const stageHeight = Math.max(1, stageRect.height);
  const minScale = Math.max(stageWidth / image.naturalWidth, stageHeight / image.naturalHeight);

  state.crop = {
    scale: minScale,
    minScale,
    offsetX: 0,
    offsetY: 0,
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
    stageWidth,
    stageHeight
  };
  elements.zoomRange.min = String(minScale);
  elements.zoomRange.max = String(minScale * 3);
  elements.zoomRange.step = String(Math.max(0.01, minScale / 100));
  elements.zoomRange.value = String(minScale);
  applyCropTransform();
}

async function showCropFromFile(file) {
  if (!file?.type.startsWith('image/')) {
    setStatus('Choose an image');
    return;
  }

  stopCamera();
  clearObjectUrl();
  resetCrop();
  state.objectUrl = URL.createObjectURL(file);
  elements.cropImage.onload = () => {
    state.activeImage = elements.cropImage;
    initializeCropForImage(elements.cropImage);
    setMode('adjusting');
    setStatus('Adjust crop');
  };
  elements.cropImage.onerror = () => {
    setStatus('Photo could not load');
    resetCapture();
  };
  elements.cropImage.src = state.objectUrl;
}

function renderCropToDataUrl() {
  const canvas = document.createElement('canvas');
  canvas.width = PRINT_WIDTH;
  canvas.height = PRINT_HEIGHT;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, PRINT_WIDTH, PRINT_HEIGHT);

  const crop = state.crop;
  const source = state.activeImage;
  const visibleLeft = ((crop.imageWidth * crop.scale - crop.stageWidth) / 2 - crop.offsetX) / crop.scale;
  const visibleTop = ((crop.imageHeight * crop.scale - crop.stageHeight) / 2 - crop.offsetY) / crop.scale;
  const visibleWidth = crop.stageWidth / crop.scale;
  const visibleHeight = crop.stageHeight / crop.scale;

  context.drawImage(
    source,
    visibleLeft,
    visibleTop,
    visibleWidth,
    visibleHeight,
    0,
    0,
    PRINT_WIDTH,
    PRINT_HEIGHT
  );
  return canvas.toDataURL('image/jpeg', 0.9);
}

function getVideoFrameDataUrl() {
  const canvas = document.createElement('canvas');
  canvas.width = PRINT_WIDTH;
  canvas.height = PRINT_HEIGHT;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, PRINT_WIDTH, PRINT_HEIGHT);
  drawCoverImage(context, elements.cameraVideo, 0, 0, PRINT_WIDTH, PRINT_HEIGHT);
  return canvas.toDataURL('image/jpeg', 0.9);
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
  return canvas.toDataURL('image/jpeg', 0.9);
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
  return canvas.toDataURL('image/jpeg', 0.9);
}

async function acceptCrop() {
  let capture;
  if (state.mode === 'camera') {
    capture = getVideoFrameDataUrl();
  } else if (state.mode === 'adjusting') {
    capture = renderCropToDataUrl();
  } else {
    return;
  }

  stopCamera();
  state.sourceImageDataUrl = capture;

  if (state.layout === 'single_4x6') {
    state.captures = [capture];
    state.renderedPrintDataUrl = await renderSinglePrint(capture);
    setMode('preview');
    elements.appTitle.textContent = 'Ready to print';
    setStatus('Preview ready');
    return;
  }

  state.captures.push(capture);
  renderStripTray();
  if (state.captures.length < STRIP_SHOTS) {
    clearObjectUrl();
    resetCrop();
    setMode('empty');
    elements.appTitle.textContent = `Capture strip photo ${state.captures.length + 1}/${STRIP_SHOTS}`;
    setStatus(`${STRIP_SHOTS - state.captures.length} left`);
    return;
  }

  state.renderedPrintDataUrl = await renderStripPrint(state.captures);
  setMode('preview');
  elements.appTitle.textContent = 'Ready to print';
  setStatus('Preview ready');
}

function retake() {
  state.captures = [];
  state.renderedPrintDataUrl = '';
  state.sourceImageDataUrl = '';
  renderStripTray();
  resetCapture();
}

async function startFallbackCamera() {
  try {
    if (state.stream) {
      setMode('camera');
      return;
    }

    clearObjectUrl();
    resetCrop();
    setStatus('Opening camera');
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    elements.cameraVideo.srcObject = state.stream;
    setMode('camera');
    setStatus('Camera ready');
  } catch (error) {
    setStatus('Camera blocked');
  }
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

elements.choosePhotoButton.addEventListener('click', () => {
  elements.photoInput.click();
});

elements.photoInput.addEventListener('change', () => {
  showCropFromFile(elements.photoInput.files?.[0]);
});

elements.zoomRange.addEventListener('input', () => {
  state.crop.scale = Number(elements.zoomRange.value);
  applyCropTransform();
});

elements.cropStage.addEventListener('pointerdown', (event) => {
  if (state.mode !== 'adjusting') {
    return;
  }
  state.drag = {
    active: true,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startOffsetX: state.crop.offsetX,
    startOffsetY: state.crop.offsetY
  };
  elements.cropStage.setPointerCapture(event.pointerId);
});

elements.cropStage.addEventListener('pointermove', (event) => {
  if (!state.drag.active || state.drag.pointerId !== event.pointerId) {
    return;
  }
  state.crop.offsetX = state.drag.startOffsetX + event.clientX - state.drag.startX;
  state.crop.offsetY = state.drag.startOffsetY + event.clientY - state.drag.startY;
  applyCropTransform();
});

function endDrag(event) {
  if (!state.drag.active || state.drag.pointerId !== event.pointerId) {
    return;
  }
  state.drag.active = false;
  elements.cropStage.releasePointerCapture(event.pointerId);
}

elements.cropStage.addEventListener('pointerup', endDrag);
elements.cropStage.addEventListener('pointercancel', endDrag);
elements.fallbackCameraButton.addEventListener('click', startFallbackCamera);
elements.acceptButton.addEventListener('click', acceptCrop);
elements.retakeButton.addEventListener('click', retake);
elements.submitButton.addEventListener('click', submitPrint);
elements.newPhotoButton.addEventListener('click', () => {
  elements.doneView.hidden = true;
  elements.captureView.hidden = false;
  elements.doneImage.hidden = false;
  elements.connectionStatus.hidden = false;
  retake();
});

window.addEventListener('resize', () => {
  if (state.mode === 'adjusting' && state.activeImage) {
    initializeCropForImage(state.activeImage);
  }
});

setLayout('single_4x6');
bootStatusPage();
