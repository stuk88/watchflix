import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { rewriteParams, rewriteBindings } from './param-rewriter.js';

class StatementWrapper {
  constructor(db, sql, wrapper) {
    this._db = db;
    this._sql = sql;
    this._wrapper = wrapper;
  }

  get(...args) {
    const params = this._resolveParams(args);
    const stmt = this._db.prepare(this._sql);
    try {
      if (params && Object.keys(params).length) stmt.bind(params);
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all(...args) {
    const params = this._resolveParams(args);
    const results = [];
    const stmt = this._db.prepare(this._sql);
    try {
      if (params && Object.keys(params).length) stmt.bind(params);
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  run(...args) {
    const params = this._resolveParams(args);
    const stmt = this._db.prepare(this._sql);
    try {
      if (params && Object.keys(params).length) stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }

    const changes = this._db.getRowsModified();
    const idStmt = this._db.prepare('SELECT last_insert_rowid() as id');
    let lastInsertRowid;
    try {
      idStmt.step();
      lastInsertRowid = idStmt.getAsObject().id;
    } finally {
      idStmt.free();
    }

    this._wrapper._dirty = true;
    this._wrapper._schedulePersist();

    return { changes, lastInsertRowid };
  }

  _resolveParams(args) {
    if (args.length === 0) return {};
    if (args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      return rewriteBindings(args[0]);
    }
    return args;
  }
}

class SqlJsWrapper {
  constructor(db, dbPath) {
    this._db = db;
    this._dbPath = dbPath;
    this._dirty = false;
    this._persistTimer = null;
  }

  prepare(sql) {
    return new StatementWrapper(this._db, rewriteParams(sql), this);
  }

  exec(sql) {
    this._db.run(sql);
    this._dirty = true;
    this._schedulePersist();
  }

  pragma(pragmaStr) {
    if (pragmaStr.toLowerCase().includes('journal_mode')) return;
    try {
      this._db.run(`PRAGMA ${pragmaStr}`);
    } catch {}
  }

  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      if (this._dirty) this._persist();
    }, 200);
  }

  _persist() {
    const data = this._db.export();
    writeFileSync(this._dbPath, Buffer.from(data));
    this._dirty = false;
  }
}

export async function openDatabase(dbPath) {
  const SQL = await initSqlJs();

  let db;
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new SQL.Database();
  }

  return new SqlJsWrapper(db, dbPath);
}
