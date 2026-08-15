const CONFIG = {
  maxDimension: 1200,
  jpegQuality: 0.8,
};

const captureScreen = document.getElementById("capture-screen");
const loadingScreen = document.getElementById("loading-screen");
const resultsScreen = document.getElementById("results-screen");

const cameraInput = document.getElementById("camera-input");
const previewImg = document.getElementById("preview-img");
const previewWrap = document.getElementById("preview-wrap");
const scanButton = document.getElementById("scan-button");
const chooseAnotherButton = document.getElementById("choose-another-button");
const scanAnotherButton = document.getElementById("scan-another-button");
const errorBanner = document.getElementById("error-banner");

let currentImageDataUrl = null;

function showScreen(screen) {
  for (const el of [captureScreen, loadingScreen, resultsScreen]) {
    el.classList.toggle("hidden", el !== screen);
  }
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove("hidden");
}

function clearError() {
  errorBanner.classList.add("hidden");
  errorBanner.textContent = "";
}

function resetCapture() {
  cameraInput.value = "";
  currentImageDataUrl = null;
  previewWrap.classList.add("hidden");
  scanButton.classList.add("hidden");
  chooseAnotherButton.classList.add("hidden");
}

cameraInput.addEventListener("change", async () => {
  clearError();
  const file = cameraInput.files && cameraInput.files[0];
  if (!file) return;

  try {
    currentImageDataUrl = await resizeAndCompress(file, CONFIG.maxDimension, CONFIG.jpegQuality);
    previewImg.src = currentImageDataUrl;
    previewWrap.classList.remove("hidden");
    scanButton.classList.remove("hidden");
    chooseAnotherButton.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    showError("Couldn't process that photo. Try another one.");
  }
});

chooseAnotherButton.addEventListener("click", () => {
  resetCapture();
  clearError();
});

scanButton.addEventListener("click", async () => {
  if (!currentImageDataUrl) return;
  clearError();
  showScreen(loadingScreen);

  try {
    const res = await fetch("/api/identify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: currentImageDataUrl }),
    });

    const data = await res.json();
    if (!res.ok && !("identified" in data)) {
      throw new Error(data.message || "Something went wrong.");
    }
    renderIdentification(data);
    showScreen(resultsScreen);

    // Facts, price, and reference photos load in separately so the
    // identification itself shows up as soon as it's ready.
    if (data.identified) {
      fetchEnrichment(data.make, data.model, data.year_range);
    }
  } catch (err) {
    console.error(err);
    showScreen(captureScreen);
    showError(err.message || "Something went wrong. Please try again.");
  }
});

async function fetchEnrichment(make, model, yearRange) {
  const enrichLoading = document.getElementById("enrich-loading");
  enrichLoading.classList.remove("hidden");

  try {
    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ make, model, year_range: yearRange }),
    });
    const data = await res.json();
    renderEnrichment(data);
  } catch (err) {
    console.error("Enrichment failed", err);
    renderEnrichment({ facts: [], price_estimate: null, reference_images: [] });
  } finally {
    enrichLoading.classList.add("hidden");
  }
}

scanAnotherButton.addEventListener("click", () => {
  resetCapture();
  clearError();
  showScreen(captureScreen);
});

function renderIdentification(data) {
  const resultContent = document.getElementById("result-content");
  const notIdentified = document.getElementById("not-identified");

  document.getElementById("scanned-photo").src = currentImageDataUrl || "";

  // Clear any facts/price/photos left over from a previous scan.
  document.getElementById("enrich-loading").classList.add("hidden");
  document.getElementById("facts-section").classList.add("hidden");
  document.getElementById("facts-list").innerHTML = "";
  document.getElementById("price-estimate").classList.add("hidden");
  document.getElementById("reference-section").classList.add("hidden");
  document.getElementById("reference-images").innerHTML = "";

  if (!data.identified) {
    resultContent.classList.add("hidden");
    notIdentified.classList.remove("hidden");
    notIdentified.querySelector("p").textContent =
      data.message || "Couldn't confidently identify a car in this photo.";
    return;
  }

  notIdentified.classList.add("hidden");
  resultContent.classList.remove("hidden");

  const title = [data.year_range, data.make, data.model].filter(Boolean).join(" ");
  document.getElementById("result-title").textContent = title;

  const confidencePct = Math.round((data.confidence || 0) * 100);
  document.getElementById("confidence-value").textContent = `${confidencePct}% confidence`;

  document.getElementById("low-confidence-banner").classList.toggle("hidden", !data.low_confidence);
  document.getElementById("result-summary").textContent = data.summary || "";
}

function renderEnrichment(data) {
  const factsList = document.getElementById("facts-list");
  factsList.innerHTML = "";
  (data.facts || []).forEach((fact) => {
    const li = document.createElement("li");
    li.textContent = fact;
    factsList.appendChild(li);
  });
  document.getElementById("facts-section").classList.toggle("hidden", !(data.facts && data.facts.length));

  const priceEl = document.getElementById("price-estimate");
  if (data.price_estimate) {
    priceEl.textContent = `Estimated price: ${data.price_estimate} (estimate)`;
    priceEl.classList.remove("hidden");
  } else {
    priceEl.classList.add("hidden");
  }

  const refGrid = document.getElementById("reference-images");
  refGrid.innerHTML = "";
  (data.reference_images || []).forEach((img) => {
    const figure = document.createElement("figure");
    const imageEl = document.createElement("img");
    imageEl.src = img.url;
    imageEl.alt = img.title || "Reference photo";
    imageEl.loading = "lazy";
    imageEl.referrerPolicy = "no-referrer";
    const caption = document.createElement("figcaption");
    caption.textContent = img.source || "Reference image";
    figure.appendChild(imageEl);
    figure.appendChild(caption);
    refGrid.appendChild(figure);
  });
  document.getElementById("reference-section").classList.toggle(
    "hidden",
    !(data.reference_images && data.reference_images.length),
  );
}

function resizeAndCompress(file, maxDimension, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => {
      console.error("Service worker registration failed", err);
    });
  });
}
