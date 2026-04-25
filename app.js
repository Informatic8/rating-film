const TVMAZE_BASE_URL = "https://api.tvmaze.com";

// Batas aplikasi agar pemakaian data tetap terkontrol.
const INITIAL_DISPLAY_COUNT = 45;
const LOAD_MORE_STEP = 45;
const EXPORT_LIMIT = 500;
const PAGE_SIZE = 10;

// Simpan referensi elemen DOM sekali saja.
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const loadMoreBtn = document.getElementById("loadMoreBtn");
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

// State runtime yang dipakai bersama untuk alur search, render, dan export.
let currentSearchKeyword = "";
let currentSearchMovies = [];
let currentSearchNextPage = 1;
let currentSearchTotalResults = 0;
let isRandomMode = false;
let currentVisibleCount = INITIAL_DISPLAY_COUNT;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wrapper request ke TVMaze dengan retry sederhana untuk mengurangi gagal fetch sesaat.
async function fetchFromTvMaze(path, params = {}, options = {}) {
  const { retries = 2, retryDelayMs = 350 } = options;
  const query = new URLSearchParams(params).toString();
  const url = `${TVMAZE_BASE_URL}${path}${query ? `?${query}` : ""}`;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Request gagal (${response.status}) ke TVMaze.`);
      }

      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(retryDelayMs);
      }
    }
  }

  if (String(lastError?.message || "").toLowerCase().includes("failed to fetch")) {
    throw new Error("Koneksi ke TVMaze gagal. Coba lagi beberapa detik lagi.");
  }

  throw lastError || new Error("Gagal mengambil data dari TVMaze.");
}

function posterOrFallback(posterUrl) {
  if (!posterUrl || posterUrl === "N/A") {
    return "https://via.placeholder.com/300x450?text=No+Poster";
  }
  return posterUrl;
}

function stripHtml(text = "") {
  return text.replace(/<[^>]*>/g, "").trim();
}

function extractYear(dateText) {
  if (!dateText) return "N/A";
  return String(dateText).slice(0, 4) || "N/A";
}

// Validasi bahwa rating benar-benar angka (bukan null, string kosong, atau teks lain).
function hasNumericRatingValue(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function hasSourceRating(show) {
  return hasNumericRatingValue(show?.rating?.average);
}

// Ubah bentuk data mentah TVMaze agar konsisten dengan format yang dipakai UI/export.
function mapShowDetailToFlat(show) {
  const cast = (show?._embedded?.cast || [])
    .map((item) => item?.person?.name)
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");

  return {
    Title: show?.name || "N/A",
    Year: extractYear(show?.premiered),
    Type: show?.type || "N/A",
    imdbRating:
      show?.rating?.average !== null && show?.rating?.average !== undefined
        ? String(show.rating.average)
        : "N/A",
    Released: show?.premiered || "N/A",
    Runtime: show?.runtime ? `${show.runtime} min` : "N/A",
    Genre: show?.genres?.length ? show.genres.join(", ") : "N/A",
    Director: "N/A",
    Actors: cast || "N/A",
    Country:
      show?.network?.country?.name || show?.webChannel?.country?.name || "N/A",
    Plot: stripHtml(show?.summary || "") || "N/A",
    Poster: show?.image?.original || show?.image?.medium || "N/A",
  };
}

function mapShowToMovie(show) {
  return {
    imdbID: String(show.id),
    Title: show.name || "N/A",
    Year: extractYear(show.premiered),
    Type: show.type || "show",
    Poster: show.image?.original || show.image?.medium || "N/A",
    __hasRating: hasSourceRating(show),
    __detail: mapShowDetailToFlat(show),
  };
}

function pickRandomTerm() {
  return randomTerms[Math.floor(Math.random() * randomTerms.length)];
}

function pickRandomPage() {
  return Math.floor(Math.random() * 200);
}

// Mengambil data random dari endpoint /shows lalu dipilih unik dan wajib punya rating.
async function fetchRandomMovies(count, existingIds = new Set()) {
  const uniqueMovies = [];
  let attempts = 0;
  const maxAttempts = 40;
  let lastError = null;

  while (uniqueMovies.length < count && attempts < maxAttempts) {
    attempts += 1;
    try {
      const shows = await fetchFromTvMaze("/shows", { page: String(pickRandomPage()) });
      if (!Array.isArray(shows) || !shows.length) {
        continue;
      }

      const shuffled = [...shows].sort(() => Math.random() - 0.5);
      for (const show of shuffled) {
        if (uniqueMovies.length >= count) break;
        const movie = mapShowToMovie(show);
        if (!movie.__hasRating) continue;
        if (existingIds.has(movie.imdbID)) continue;
        if (uniqueMovies.some((item) => item.imdbID === movie.imdbID)) continue;
        uniqueMovies.push(movie);
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (!uniqueMovies.length) {
    if (lastError) throw lastError;

    // Fallback jika endpoint random page kebetulan gagal memberi data.
    const fallback = await fetchKeywordMovies(pickRandomTerm(), count, 1, 0);
    return fallback.movies;
  }

  return uniqueMovies;
}

// Search TV show berdasarkan keyword, lalu dipotong sesuai paginasi lokal.
async function fetchKeywordMovies(keyword, count, startPage = 1) {
  const data = await fetchFromTvMaze("/search/shows", { q: keyword });
  const allMovies = (Array.isArray(data) ? data : [])
    .map((item) => mapShowToMovie(item?.show))
    .filter(
      (movie) => movie.imdbID && movie.Title !== "N/A" && movie.__hasRating
    );

  const total = allMovies.length;
  const startIndex = Math.max(0, (startPage - 1) * PAGE_SIZE);
  const movies = allMovies.slice(startIndex, startIndex + count);
  const nextPage = Math.floor((startIndex + movies.length) / PAGE_SIZE) + 1;

  return {
    movies,
    nextPage,
    totalResults: total,
  };
}

// Hanya data yang punya rating numerik yang layak ditampilkan di grid.
function getDisplayableMovies(movies) {
  return movies.filter((movie) => hasNumericRatingValue(movie.__detail?.imdbRating));
}

// Tampilkan/sembunyikan tombol "Muat Lainnya" berdasarkan stok data saat ini.
function syncLoadMoreButton() {
  const displayableCount = getDisplayableMovies(currentSearchMovies).length;
  const hasRenderedOverflow = displayableCount > currentVisibleCount;
  const canFetchMore = isRandomMode
    ? displayableCount > 0
    : currentSearchMovies.length < currentSearchTotalResults;
  const shouldShow = hasRenderedOverflow || canFetchMore;

  if (!loadMoreBtn) return;

  if (!shouldShow) {
    loadMoreBtn.classList.add("hidden");
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = "Muat Lainnya";
    return;
  }

  loadMoreBtn.classList.remove("hidden");
}

// Render kartu film ke grid.
function renderMovies(movies) {
  const shown = getDisplayableMovies(movies).slice(0, currentVisibleCount);
  resultsContainer.innerHTML = shown
    .map(
      (movie) => `
      <article class="group overflow-hidden rounded-3xl border border-white/10 bg-white/10 shadow-xl backdrop-blur transition hover:-translate-y-1 hover:bg-white/15">
        <img src="${posterOrFallback(movie.Poster)}" alt="${movie.Title}" class="h-80 w-full object-cover" />
        <div class="p-4">
          <h3 class="line-clamp-1 text-lg font-semibold text-white">${movie.Title}</h3>
          <p class="mt-1 text-sm text-slate-300">${movie.Year} | ${movie.Type}</p>
          <p class="mt-1 text-sm font-semibold text-cyan-300 rating-text" data-rating-id="${movie.imdbID}">
            Rating: ${movie.__detail?.imdbRating && movie.__detail.imdbRating !== "N/A" ? `${movie.__detail.imdbRating}/10` : "N/A"}
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
      const showId = event.currentTarget.getAttribute("data-id");
      await openMovieDetailModal(showId);
    });
  });

  syncLoadMoreButton();
}

// Update rating pada satu kartu setelah fetch detail async.
function updateCardRating(showId, ratingText) {
  const el = document.querySelector(`.rating-text[data-rating-id="${showId}"]`);
  if (!el) return;
  el.textContent = `Rating: ${ratingText}`;
}

// Ambil detail show beserta cast untuk modal dan export.
async function fetchShowDetail(showId) {
  const show = await fetchFromTvMaze(
    `/shows/${showId}`,
    { embed: "cast" },
    { retries: 3, retryDelayMs: 450 }
  );
  return mapShowDetailToFlat(show);
}

// Isi rating di kartu secara bertahap dengan concurrency terbatas.
async function hydrateRatingsForDisplayedMovies(movies) {
  const targets = getDisplayableMovies(movies).slice(0, currentVisibleCount).filter((movie) => {
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
        const detail = await fetchShowDetail(movie.imdbID);
        if (!hasNumericRatingValue(detail.imdbRating)) {
          currentSearchMovies = currentSearchMovies.filter(
            (item) => item.imdbID !== movie.imdbID
          );
          renderMovies(currentSearchMovies);
          continue;
        }
        movie.__detail = detail;
        const ratingText =
          detail.imdbRating && detail.imdbRating !== "N/A"
            ? `${detail.imdbRating}/10`
            : "N/A";
        updateCardRating(movie.imdbID, ratingText);
      } catch (error) {
        currentSearchMovies = currentSearchMovies.filter(
          (item) => item.imdbID !== movie.imdbID
        );
        renderMovies(currentSearchMovies);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

// Menambah jumlah kartu yang tampil; jika stok habis, ambil batch data baru dari API.
async function loadMoreMovies() {
  if (!loadMoreBtn) return;

  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = "Memuat...";

  try {
    const displayable = getDisplayableMovies(currentSearchMovies);
    if (currentVisibleCount < displayable.length) {
      currentVisibleCount += LOAD_MORE_STEP;
      renderMovies(currentSearchMovies);
      return;
    }

    let nextMovies = [];
    if (isRandomMode) {
      const existingIds = new Set(currentSearchMovies.map((movie) => movie.imdbID));
      nextMovies = await fetchRandomMovies(LOAD_MORE_STEP, existingIds);
    } else {
      if (currentSearchMovies.length >= currentSearchTotalResults) {
        syncLoadMoreButton();
        return;
      }

      const chunk = await fetchKeywordMovies(
        currentSearchKeyword,
        LOAD_MORE_STEP,
        currentSearchNextPage
      );
      nextMovies = chunk.movies;
      currentSearchNextPage = chunk.nextPage;
      currentSearchTotalResults = chunk.totalResults;
    }

    if (!nextMovies.length) {
      syncLoadMoreButton();
      return;
    }

    const seenIds = new Set(currentSearchMovies.map((movie) => movie.imdbID));
    const uniqueNewMovies = nextMovies.filter((movie) => !seenIds.has(movie.imdbID));
    currentSearchMovies = [...currentSearchMovies, ...uniqueNewMovies];
    currentVisibleCount += LOAD_MORE_STEP;
    renderMovies(currentSearchMovies);
    void hydrateRatingsForDisplayedMovies(currentSearchMovies);
  } catch (error) {
    searchMessage.textContent = `Gagal memuat data tambahan: ${error.message}`;
    searchMessage.className = "mt-3 text-sm text-rose-300";
  } finally {
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = "Muat Lainnya";
    syncLoadMoreButton();
  }
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

// Ambil dan tampilkan detail lengkap untuk satu show.
async function openMovieDetailModal(showId) {
  openModal();
  modalTitle.textContent = "Detail Film";
  modalContent.innerHTML =
    '<p class="text-sm text-slate-300">Mengambil detail film...</p>';
  const cachedMovie = currentSearchMovies.find(
    (movie) => movie.imdbID === String(showId)
  );

  try {
    const detail = await fetchShowDetail(showId);
    modalTitle.textContent = `${detail.Title} (${detail.Year})`;
    modalContent.innerHTML = `
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <img src="${posterOrFallback(detail.Poster)}" alt="${detail.Title}" class="w-full rounded-xl object-cover md:col-span-1" />
        <div class="md:col-span-2">
          <p class="text-sm text-slate-300">${detail.Genre} | ${detail.Runtime}</p>
          <p class="mt-1 text-sm text-slate-300">Sutradara: ${detail.Director}</p>
          <p class="mt-1 text-sm text-slate-300">Aktor: ${detail.Actors}</p>
          <p class="mt-1 text-sm font-semibold text-cyan-300">Rating: ${detail.imdbRating}/10</p>
          <p class="mt-3 leading-6 text-slate-200">${detail.Plot}</p>
        </div>
      </div>
    `;
  } catch (error) {
    if (cachedMovie?.__detail) {
      const detail = cachedMovie.__detail;
      modalTitle.textContent = `${detail.Title || cachedMovie.Title} (${detail.Year || cachedMovie.Year})`;
      modalContent.innerHTML = `
        <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <img src="${posterOrFallback(detail.Poster || cachedMovie.Poster)}" alt="${detail.Title || cachedMovie.Title}" class="w-full rounded-xl object-cover md:col-span-1" />
          <div class="md:col-span-2">
            <p class="text-xs text-amber-300">Detail lengkap sedang bermasalah, menampilkan data yang tersedia.</p>
            <p class="mt-2 text-sm text-slate-300">${detail.Genre || "N/A"} | ${detail.Runtime || "N/A"}</p>
            <p class="mt-1 text-sm text-slate-300">Sutradara: ${detail.Director || "N/A"}</p>
            <p class="mt-1 text-sm text-slate-300">Aktor: ${detail.Actors || "N/A"}</p>
            <p class="mt-1 text-sm font-semibold text-cyan-300">Rating: ${detail.imdbRating || "N/A"}/10</p>
            <p class="mt-3 leading-6 text-slate-200">${detail.Plot || "N/A"}</p>
          </div>
        </div>
      `;
      return;
    }

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
      nextMovies = await fetchRandomMovies(
        EXPORT_LIMIT - currentSearchMovies.length,
        existingIds
      );
    } else {
      if (currentSearchTotalResults && currentSearchMovies.length >= currentSearchTotalResults) {
        break;
      }
      const chunk = await fetchKeywordMovies(
        currentSearchKeyword,
        EXPORT_LIMIT - currentSearchMovies.length,
        currentSearchNextPage
      );
      nextMovies = chunk.movies;
      currentSearchNextPage = chunk.nextPage;
      currentSearchTotalResults = chunk.totalResults;
    }

    if (!nextMovies.length) break;
    currentSearchMovies = [...currentSearchMovies, ...nextMovies];
  }
}

// Ambil field detail tambahan untuk export.
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

    if (hasRichDetail) continue;

    try {
      const fetched = await fetchShowDetail(movie.imdbID);
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
    "Rating",
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
  link.download = `tvmaze-shows-${exportMovies.length}-rows-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
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
  currentVisibleCount = INITIAL_DISPLAY_COUNT;
  syncLoadMoreButton();

  const keyword = currentSearchKeyword.trim();
  isRandomMode = !keyword;

  searchMessage.textContent = isRandomMode
    ? `Mengambil ${INITIAL_DISPLAY_COUNT} data...`
    : `Mengambil ${INITIAL_DISPLAY_COUNT} data untuk "${keyword}"...`;
  searchMessage.className = "mt-3 text-sm text-slate-300";

  try {
    if (isRandomMode) {
      currentSearchMovies = await fetchRandomMovies(INITIAL_DISPLAY_COUNT, new Set());
    } else {
      const result = await fetchKeywordMovies(keyword, INITIAL_DISPLAY_COUNT, 1);
      currentSearchMovies = result.movies;
      currentSearchNextPage = result.nextPage;
      currentSearchTotalResults = result.totalResults;
    }

    renderMovies(currentSearchMovies);
    void hydrateRatingsForDisplayedMovies(currentSearchMovies);
    const shownCount = Math.min(
      currentVisibleCount,
      getDisplayableMovies(currentSearchMovies).length
    );
    searchMessage.textContent = isRandomMode
      ? `Menampilkan ${shownCount} data.`
      : `Menampilkan ${shownCount} data untuk "${keyword}".`;
    searchMessage.className = "mt-3 text-sm text-emerald-300";
  } catch (error) {
    resultsContainer.innerHTML = "";
    searchMessage.textContent = error.message;
    searchMessage.className = "mt-3 text-sm text-rose-300";
    syncLoadMoreButton();
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
if (loadMoreBtn) {
  loadMoreBtn.addEventListener("click", () => {
    void loadMoreMovies();
  });
}

// Muat data awal saat halaman pertama kali dibuka.
searchInput.value = currentSearchKeyword;
loadMovies();
