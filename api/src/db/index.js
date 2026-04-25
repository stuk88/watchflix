export async function openDatabase(dbPath) {
  if (process.versions?.electron || !process.env.CAPACITOR_NODEJS) {
    try {
      const { openDatabase: openNative } = await import('./better-sqlite3.js');
      return openNative(dbPath);
    } catch (e) {
      console.log('[db] better-sqlite3 not available, falling back to sql.js:', e.message);
    }
  }

  const { openDatabase: openSqlJs } = await import('./sql-js.js');
  return openSqlJs(dbPath);
}
