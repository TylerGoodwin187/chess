// Puzzle database loader.
//
// Puzzles now live in per-rating-range SQLite databases under ./data/, instead
// of one big puzzles.json. Each database is downloaded from the network at
// most once and then cached permanently in IndexedDB, exactly like the Maia
// model is cached in maia-worker.js (MaiaModels / models store). That means:
//   - "Clear Saved Data" (which only clears localStorage/sessionStorage/Cache
//     Storage) never touches these — they survive it, same as the Maia model.
//   - Only a browser/site-data wipe removes them.
//   - Once a database is cached, the app works fully offline for that rating
//     range without hitting the network again.
//
// Only ONE sql.js database connection is kept open at a time. Puzzles are
// fetched with SQL queries (ORDER BY RANDOM() LIMIT 1) — we never load an
// entire table into JavaScript.

const PUZZLE_DB_RANGES = [
  { min: 100, max: 800, file: "puzzles_0100_0800.db" },
  { min: 801, max: 1000, file: "puzzles_0801_1000.db" },
  { min: 1001, max: 1200, file: "puzzles_1001_1200.db" },
  { min: 1201, max: 1400, file: "puzzles_1201_1400.db" },
  { min: 1401, max: 1600, file: "puzzles_1401_1600.db" },
  { min: 1601, max: 1800, file: "puzzles_1601_1800.db" },
  { min: 1801, max: 2000, file: "puzzles_1801_2000.db" },
  { min: 2001, max: 2200, file: "puzzles_2001_2200.db" },
  { min: 2201, max: 2400, file: "puzzles_2201_2400.db" },
  { min: 2401, max: Infinity, file: "puzzles_2401_+.db" },
];

function dbFileForRating(rating) {
  for (const range of PUZZLE_DB_RANGES) {
    if (rating >= range.min && rating <= range.max) return range.file;
  }
  // Ratings below 100 or above the top of the table both fall back sensibly.
  return rating < PUZZLE_DB_RANGES[0].min
    ? PUZZLE_DB_RANGES[0].file
    : PUZZLE_DB_RANGES[PUZZLE_DB_RANGES.length - 1].file;
}

// ---------- IndexedDB storage (same shape/pattern as MaiaModels) ----------

const PUZZLE_IDB_NAME = "PuzzleDatabases";
const PUZZLE_STORE_NAME = "databases";

function openPuzzleIdb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUZZLE_IDB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(PUZZLE_STORE_NAME)) {
        db.createObjectStore(PUZZLE_STORE_NAME, { keyPath: "filename" });
      }
    };
  });
}

async function getCachedPuzzleDbBuffer(filename) {
  const db = await openPuzzleIdb();
  const tx = db.transaction([PUZZLE_STORE_NAME], "readonly");
  const store = tx.objectStore(PUZZLE_STORE_NAME);
  const record = await new Promise((resolve, reject) => {
    const req = store.get(filename);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  if (!record) return null;
  return await record.data.arrayBuffer();
}

async function storePuzzleDbBuffer(filename, buffer) {
  const db = await openPuzzleIdb();
  const tx = db.transaction([PUZZLE_STORE_NAME], "readwrite");
  const store = tx.objectStore(PUZZLE_STORE_NAME);
  await new Promise((resolve, reject) => {
    const req = store.put({
      filename,
      data: new Blob([buffer]),
      timestamp: Date.now(),
      size: buffer.byteLength,
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function isPuzzleDbCached(filename) {
  const db = await openPuzzleIdb();
  const tx = db.transaction([PUZZLE_STORE_NAME], "readonly");
  const store = tx.objectStore(PUZZLE_STORE_NAME);
  const key = await new Promise((resolve, reject) => {
    const req = store.getKey(filename);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return key !== undefined && key !== null;
}

async function fetchPuzzleDbFromNetwork(filename) {
  const response = await fetch(`./data/${filename}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${filename}: HTTP ${response.status}`);
  }
  return await response.arrayBuffer();
}

// ---------- sql.js engine (loaded once, reused for every database) ----------

let sqlJsPromise = null;
function getSQL() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: (file) => "./sql/" + file });
  }
  return sqlJsPromise;
}

// ---------- Active database management — exactly one open connection ----------

let activeDb = null;
let activeDbFilename = null;
let loadingFilename = null;
let loadingPromise = null;
let firstLoadDone = false;

async function ensureDbLoaded(filename) {
  if (activeDbFilename === filename && activeDb) return activeDb;

  // Coalesce concurrent requests for the same file into one load.
  if (loadingFilename === filename && loadingPromise) return loadingPromise;

  loadingFilename = filename;
  loadingPromise = (async () => {
    const SQL = await getSQL();

    let buffer = await getCachedPuzzleDbBuffer(filename);
    if (!buffer) {
      buffer = await fetchPuzzleDbFromNetwork(filename);
      await storePuzzleDbBuffer(filename, buffer);
    }

    // Close the previous connection before opening the new one — never keep
    // more than one puzzle database open at a time.
    if (activeDb && activeDbFilename !== filename) {
      activeDb.close();
      activeDb = null;
      activeDbFilename = null;
    }

    activeDb = new SQL.Database(new Uint8Array(buffer));
    activeDbFilename = filename;

    if (!firstLoadDone) {
      firstLoadDone = true;
      // Puzzle Mode is now usable — quietly grab the remaining databases in
      // the background, one at a time, without blocking anything.
      setTimeout(() => {
        startBackgroundDownloads().catch((err) =>
          console.warn("Background puzzle database download stopped:", err)
        );
      }, 1500);
    }

    return activeDb;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingFilename = null;
    loadingPromise = null;
  }
}

function queryRandomRow(db) {
  // Get the highest rowid
  let stmt = db.prepare("SELECT MAX(rowid) AS maxRow FROM puzzles");

  let maxRow = 0;
  try {
    if (stmt.step()) {
      maxRow = stmt.getAsObject().maxRow;
    }
  } finally {
    stmt.free();
  }

  if (!maxRow) return null;

  // Pick a random rowid
  const randomRow = Math.floor(Math.random() * maxRow) + 1;

  // Jump directly to that row
  stmt = db.prepare(`
    SELECT fen, moves, rating
    FROM puzzles
    WHERE rowid >= ?
    LIMIT 1
  `);

  let row = null;

  try {
    if (stmt.step([randomRow])) {
      row = stmt.getAsObject();
    }
  } finally {
    stmt.free();
  }

  // If we picked beyond the last existing row, wrap around
  if (!row) {
    stmt = db.prepare(`
      SELECT fen, moves, rating
      FROM puzzles
      LIMIT 1
    `);

    try {
      if (stmt.step()) {
        row = stmt.getAsObject();
      }
    } finally {
      stmt.free();
    }
  }

  return row;
}
async function getRandomPuzzle(rating, excludeFen) {
  const filename = dbFileForRating(rating);
  const db = await ensureDbLoaded(filename);

  let row = queryRandomRow(db);

  for (let i = 0; row && excludeFen && row.fen === excludeFen && i < 10; i++) {
    const retry = queryRandomRow(db);
    if (!retry) break;
    row = retry;
  }

  if (!row) throw new Error("No puzzles found in " + filename);

  return {
    fen: row.fen,
    solution: String(row.moves).trim().split(/\s+/).filter(Boolean),
    rating: row.rating,
  };
}

// ---------- Background downloading of the remaining databases ----------

let backgroundDownloadStarted = false;

async function startBackgroundDownloads() {
  if (backgroundDownloadStarted) return;
  backgroundDownloadStarted = true;

  for (const range of PUZZLE_DB_RANGES) {
    const filename = range.file;
    try {
      const cached = await isPuzzleDbCached(filename);
      if (cached) continue; // never redownload what's already stored
      const buffer = await fetchPuzzleDbFromNetwork(filename);
      await storePuzzleDbBuffer(filename, buffer);
    } catch (err) {
      console.warn("Failed to background-download puzzle database", filename, err);
    }
    // Small pause between files so this never competes with a foreground
    // puzzle request or hammers the network.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

window.PuzzleDB = {
  getRandomPuzzle,
  dbFileForRating,
  startBackgroundDownloads,
};
