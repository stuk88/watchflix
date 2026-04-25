import Database from 'better-sqlite3';

export function openDatabase(dbPath) {
  return new Database(dbPath);
}
