const OMDB_BASE_URLS = [
  "https://www.omdbapi.com/",
  "http://www.omdbapi.com/",
];
const DEFAULT_API_KEY = "b8992dc0";

// Batas aplikasi agar pemakaian API tetap terkontrol.
const DISPLAY_LIMIT = 50;
const EXPORT_LIMIT = 500;
const PAGE_SIZE = 10;

// Simpan referensi elemen DOM sekali saja.
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const searchMessage = document.getElementById("searchMessage");
const resultsContainer = document.getElementById("results");
const movieModal = document.getElementById("movieModal");
const modalTitle = document.getElementById("modalTitle");
const modalContent = document.getElementById("modalContent");
const closeModalBtn = document.getElementById("closeModalBtn");
const exportModal = document.getElementById("exportModal");
const closeExportModalBtn = document.getElementById("closeExportModalBtn");
const confirmExportBtn = document.getElementById("confirmExportBtn");
const cancelExportBtn = document.getElementById("cancelExportBtn");

const storageKeys = {
  apiKey: "omdb_api_key",
};

// State runtime yang dipakai bersama untuk alur search, render, dan export.
let currentSearchKeyword = "";
let currentSearchMovies = [];
let currentSearchNextPage = 1;
let currentSearchTotalResults = 0;
let isRandomMode = false;

// Daftar kata acak untuk mode fallback (saat input pencarian kosong).
const randomTerms = [
  "love",
  "moon",
  "city",
  "night",
  "king",
  "queen",
  "ghost",
  "river",
  "ocean",
  "dream",
  "fire",
  "storm",
  "shadow",
  "future",
  "space",
  "dragon",
  "school",
  "family",
  "war",
  "friend",
  "robot",
  "music",
  "planet",
  "island",
  "adventure",
  "legend",
  "battle",
  "secret",
  "magic",
  "hero",
];

function getApiKey() {
  return localStorage.getItem(storageKeys.apiKey) || "";
}

// Simpan API key di browser agar bisa dipakai ulang di setiap request.
function setApiKey(apiKey) {
  localStorage.setItem(storageKeys.apiKey, apiKey);
}

// Paksa sinkron ke API key terbaru yang ditentukan di kode.
setApiKey(DEFAULT_API_KEY);

// Helper HTTP utama ke OMDb dengan retry ke base URL alternatif.
async function fetchFromOmdb(params) {
  let apiKey = getApiKey();
  if (!apiKey) {
    apiKey = DEFAULT_API_KEY;
    setApiKey(apiKey);
  }

  const query = new URLSearchParams({
    apikey: apiKey,
    ...params,
  }).toString();

  let lastNetworkError = null;

  for (const baseUrl of OMDB_BASE_URLS) {
    try {
      const response = await fetch(`${baseUrl}?${query}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.Error || `Request gagal (${response.status}).`);
      }

      if (data.Response === "False") {
        if (String(data.Error || "").toLowerCase().includes("request limit reached")) {
          if (apiKey !== DEFAULT_API_KEY) {
            setApiKey(DEFAULT_API_KEY);
            return fetchFromOmdb(params);
          }
          throw new Error("Limit request OMDb untuk API key ini sudah habis. Coba lagi nanti atau ganti API key.");
        }
        throw new Error(data.Error || "Data tidak ditemukan.");
      }

      return data;
    } catch (error) {
      lastNetworkError = error;
    }
  }

  throw new Error(
    lastNetworkError?.message ||
      "Tidak bisa terhubung ke OMDb. Coba jalankan via local server (bukan file://)."
  );
}

function posterOrFallback(posterUrl) {
  if (!posterUrl || posterUrl === "N/A") {
    return "https://via.placeholder.com/300x450?text=No+Poster";
  }
  return posterUrl;
}

// Membuat query acak untuk mode jelajah/random.
function pickRandomQuery() {
  const term = randomTerms[Math.floor(Math.random() * randomTerms.length)];
  const char = "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
  const page = Math.floor(Math.random() * 8) + 1;
  return Math.random() < 0.5 ? { s: term, page: String(page) } : { s: char, page: String(page) };
}

// Ambil film random unik sampai jumlah target terpenuhi.
async function fetchRandomMovies(count, existingIds = new Set()) {
  const uniqueMovies = [];
  let attempts = 0;
  const maxAttempts = 80;
  let lastError = null;

  while (uniqueMovies.length < count && attempts < maxAttempts) {
    attempts += 1;
    try {
      const data = await fetchFromOmdb(pickRandomQuery());
      const movies = data.Search || [];

      for (const movie of movies) {
        if (uniqueMovies.length >= count) break;
        if (existingIds.has(movie.imdbID)) continue;
        if (uniqueMovies.some((item) => item.imdbID === movie.imdbID)) continue;
        uniqueMovies.push(movie);
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (!uniqueMovies.length && lastError) {
    throw lastError;
  }
  return uniqueMovies;
}

// Ambil film dari pencarian keyword dengan pagination.
async function fetchKeywordMovies(keyword, count, startPage = 1, knownTotal = 0) {
  const collected = [];
  let page = startPage;
  let total = knownTotal;

  while (collected.length < count && page <= 100) {
    const data = await fetchFromOmdb({ s: keyword, page: String(page) });
    const movies = data.Search || [];
    total = Number(data.totalResults || total || 0);
    if (!movies.length) break;

    for (const movie of movies) {
      if (collected.length >= count) break;
      collected.push(movie);
    }

    page += 1;
    if (total && (page - 1) * PAGE_SIZE >= total) break;
  }

  return {
    movies: collected,
    nextPage: page,
    totalResults: total,
  };
}

// Render kartu film ke grid.
function renderMovies(movies) {
  const shown = movies.slice(0, DISPLAY_LIMIT);
  resultsContainer.innerHTML = shown
    .map(
      (movie) => `
      <article class="group overflow-hidden rounded-3xl border border-white/10 bg-white/10 shadow-xl backdrop-blur transition hover:-translate-y-1 hover:bg-white/15">
        <img src="${posterOrFallback(movie.Poster)}" alt="${movie.Title}" class="h-80 w-full object-cover" />
        <div class="p-4">
          <h3 class="line-clamp-1 text-lg font-semibold text-white">${movie.Title}</h3>
          <p class="mt-1 text-sm text-slate-300">${movie.Year} | ${movie.Type}</p>
          <p class="mt-1 text-sm font-semibold text-cyan-300 rating-text" data-rating-id="${movie.imdbID}">
            IMDb Rating: ${movie.__detail?.imdbRating && movie.__detail.imdbRating !== "N/A" ? `${movie.__detail.imdbRating}/10` : "N/A"}
          </p>
          <button
            data-id="${movie.imdbID}"
            class="detail-btn mt-4 w-full rounded-2xl bg-cyan-500 px-3 py-2.5 text-sm font-semibold text-slate-950 transition group-hover:bg-cyan-400"
          >
            Detail
          </button>
        </div>
      </article>
    `
    )
    .join("");

  document.querySelectorAll(".detail-btn").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const imdbID = event.currentTarget.getAttribute("data-id");
      await openMovieDetailModal(imdbID);
    });
  });
}

// Update rating pada satu kartu setelah fetch detail async.
function updateCardRating(imdbID, ratingText) {
  const el = document.querySelector(`.rating-text[data-rating-id="${imdbID}"]`);
  if (!el) return;
  el.textContent = `IMDb Rating: ${ratingText}`;
}

// Isi rating IMDb di kartu secara bertahap dengan concurrency terbatas.
async function hydrateRatingsForDisplayedMovies(movies) {
  const targets = movies
    .slice(0, DISPLAY_LIMIT)
    .filter((movie) => {
      const rating = movie.__detail?.imdbRating;
      return !rating || rating === "N/A";
    });

  if (!targets.length) return;

  const concurrency = 4;
  let idx = 0;

  async function worker() {
    while (idx < targets.length) {
      const currentIndex = idx;
      idx += 1;
      const movie = targets[currentIndex];
      if (!movie) continue;

      try {
        const detail = await fetchFromOmdb({ i: movie.imdbID, plot: "short" });
        movie.__detail = detail;
        const ratingText =
          detail.imdbRating && detail.imdbRating !== "N/A"
            ? `${detail.imdbRating}/10`
            : "N/A";
        updateCardRating(movie.imdbID, ratingText);
      } catch (error) {
        updateCardRating(movie.imdbID, "N/A");
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

// Helper untuk membuka/menutup modal.
function openModal() {
  movieModal.classList.remove("hidden");
  movieModal.classList.add("flex");
  movieModal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  movieModal.classList.add("hidden");
  movieModal.classList.remove("flex");
  movieModal.setAttribute("aria-hidden", "true");
}

function openExportModal() {
  exportModal.classList.remove("hidden");
  exportModal.classList.add("flex");
  exportModal.setAttribute("aria-hidden", "false");
}

function closeExportModal() {
  exportModal.classList.add("hidden");
  exportModal.classList.remove("flex");
  exportModal.setAttribute("aria-hidden", "true");
}

// Ambil dan tampilkan detail lengkap untuk satu film.
async function openMovieDetailModal(imdbID) {
  openModal();
  modalTitle.textContent = "Detail Film";
  modalContent.innerHTML =
    '<p class="text-sm text-slate-300">Mengambil detail film...</p>';

  try {
    const detail = await fetchFromOmdb({ i: imdbID, plot: "full" });
    modalTitle.textContent = `${detail.Title} (${detail.Year})`;
    modalContent.innerHTML = `
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <img src="${posterOrFallback(detail.Poster)}" alt="${detail.Title}" class="w-full rounded-xl object-cover md:col-span-1" />
        <div class="md:col-span-2">
          <p class="text-sm text-slate-300">${detail.Genre} | ${detail.Runtime}</p>
          <p class="mt-1 text-sm text-slate-300">Sutradara: ${detail.Director}</p>
          <p class="mt-1 text-sm text-slate-300">Aktor: ${detail.Actors}</p>
          <p class="mt-1 text-sm font-semibold text-cyan-300">IMDb Rating: ${detail.imdbRating}/10</p>
          <p class="mt-3 leading-6 text-slate-200">${detail.Plot}</p>
        </div>
      </div>
    `;
  } catch (error) {
    modalContent.innerHTML = `<p class="text-sm text-rose-600">${error.message}</p>`;
  }
}

// Escape aman untuk CSV (koma/kutip/newline).
function escapeCsvValue(value) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

// Pastikan jumlah baris film cukup sebelum export dimulai.
async function ensureMoviesForExport() {
  if (!currentSearchMovies.length) {
    await loadMovies();
  }

  while (currentSearchMovies.length < EXPORT_LIMIT) {
    let nextMovies = [];

    if (isRandomMode) {
      const existingIds = new Set(currentSearchMovies.map((movie) => movie.imdbID));
      nextMovies = await fetchRandomMovies(EXPORT_LIMIT - currentSearchMovies.length, existingIds);
    } else {
      if (currentSearchTotalResults && currentSearchMovies.length >= currentSearchTotalResults) {
        break;
      }
      const chunk = await fetchKeywordMovies(
        currentSearchKeyword,
        EXPORT_LIMIT - currentSearchMovies.length,
        currentSearchNextPage,
        currentSearchTotalResults
      );
      nextMovies = chunk.movies;
      currentSearchNextPage = chunk.nextPage;
      currentSearchTotalResults = chunk.totalResults;
    }

    if (!nextMovies.length) {
      break;
    }
    currentSearchMovies = [...currentSearchMovies, ...nextMovies];
  }
}

// Ambil field detail tambahan (Released, Runtime, Plot, dll.) untuk export.
async function ensureMovieDetailsForExport(movies) {
  for (const movie of movies) {
    const detail = movie.__detail || {};
    const hasRichDetail =
      detail &&
      detail.Released &&
      detail.Released !== "N/A" &&
      detail.Runtime &&
      detail.Runtime !== "N/A" &&
      detail.Plot &&
      detail.Plot !== "N/A";

    if (hasRichDetail) {
      continue;
    }

    try {
      const fetched = await fetchFromOmdb({ i: movie.imdbID, plot: "short" });
      movie.__detail = fetched;
    } catch (error) {
      movie.__detail = movie.__detail || {};
    }
  }
}

// Export tetap 500 baris ke CSV sesuai kolom yang diminta.
async function exportCurrentMoviesToCsv() {
  searchMessage.textContent = `Menyiapkan export ${EXPORT_LIMIT} data...`;
  searchMessage.className = "mt-3 text-sm text-slate-300";

  try {
    await ensureMoviesForExport();
  } catch (error) {
    searchMessage.textContent = `Gagal menyiapkan export: ${error.message}`;
    searchMessage.className = "mt-3 text-sm text-rose-300";
    return;
  }

  if (!currentSearchMovies.length) {
    searchMessage.textContent = "Belum ada data untuk diexport.";
    searchMessage.className = "mt-3 text-sm text-amber-300";
    return;
  }

  const exportMovies = currentSearchMovies.slice(0, EXPORT_LIMIT);
  await ensureMovieDetailsForExport(exportMovies);
  const header = [
    "Title",
    "Year",
    "Type",
    "IMDb Rating",
    "Released",
    "Runtime",
    "Genre",
    "Director",
    "Actors",
    "Country",
    "Plot",
  ];
  const rows = exportMovies.map((movie) => [
    movie.__detail?.Title || movie.Title || "N/A",
    movie.__detail?.Year || movie.Year || "N/A",
    movie.__detail?.Type || movie.Type || "N/A",
    movie.__detail?.imdbRating || "N/A",
    movie.__detail?.Released || "N/A",
    movie.__detail?.Runtime || "N/A",
    movie.__detail?.Genre || "N/A",
    movie.__detail?.Director || "N/A",
    movie.__detail?.Actors || "N/A",
    movie.__detail?.Country || "N/A",
    movie.__detail?.Plot || "N/A",
  ]);

  const csvContent = [header, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `omdb-movies-${exportMovies.length}-rows-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  if (exportMovies.length < EXPORT_LIMIT) {
    searchMessage.textContent = `Export selesai ${exportMovies.length} data (kurang dari target 500 karena data API terbatas).`;
    searchMessage.className = "mt-3 text-sm text-amber-300";
  } else {
    searchMessage.textContent = "Export CSV berhasil: 500 data.";
    searchMessage.className = "mt-3 text-sm text-emerald-300";
  }
}

// Loader utama: mode keyword atau mode random (jika input kosong).
async function loadMovies() {
  currentSearchMovies = [];
  currentSearchNextPage = 1;
  currentSearchTotalResults = 0;

  const keyword = currentSearchKeyword.trim();
  isRandomMode = !keyword;

  searchMessage.textContent = isRandomMode
    ? "Mengambil 50 film random..."
    : `Mengambil maksimal 50 film untuk "${keyword}"...`;
  searchMessage.className = "mt-3 text-sm text-slate-300";

  try {
    if (isRandomMode) {
      currentSearchMovies = await fetchRandomMovies(DISPLAY_LIMIT, new Set());
    } else {
      const result = await fetchKeywordMovies(keyword, DISPLAY_LIMIT, 1, 0);
      currentSearchMovies = result.movies;
      currentSearchNextPage = result.nextPage;
      currentSearchTotalResults = result.totalResults;
    }

    renderMovies(currentSearchMovies);
    void hydrateRatingsForDisplayedMovies(currentSearchMovies);
    searchMessage.textContent = isRandomMode
      ? `Menampilkan ${Math.min(DISPLAY_LIMIT, currentSearchMovies.length)} film random (maksimal 50).`
      : `Menampilkan ${Math.min(DISPLAY_LIMIT, currentSearchMovies.length)} film untuk "${keyword}" (maksimal 50).`;
    searchMessage.className = "mt-3 text-sm text-emerald-300";
  } catch (error) {
    resultsContainer.innerHTML = "";
    searchMessage.textContent = error.message;
    searchMessage.className = "mt-3 text-sm text-rose-300";
  }
}

// Registrasi event listener.
searchBtn.addEventListener("click", () => {
  currentSearchKeyword = searchInput.value;
  loadMovies();
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    currentSearchKeyword = searchInput.value;
    loadMovies();
  }
});

closeModalBtn.addEventListener("click", closeModal);
closeExportModalBtn.addEventListener("click", closeExportModal);
confirmExportBtn.addEventListener("click", async () => {
  await exportCurrentMoviesToCsv();
  closeExportModal();
});
cancelExportBtn.addEventListener("click", closeExportModal);

movieModal.addEventListener("click", (event) => {
  if (event.target === movieModal) {
    closeModal();
  }
});

exportModal.addEventListener("click", (event) => {
  if (event.target === exportModal) {
    closeExportModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!movieModal.classList.contains("hidden")) {
      closeModal();
    }
    if (!exportModal.classList.contains("hidden")) {
      closeExportModal();
    }
  }
});

exportCsvBtn.addEventListener("click", openExportModal);

// Muat data awal saat halaman pertama kali dibuka.
searchInput.value = currentSearchKeyword;
loadMovies();
