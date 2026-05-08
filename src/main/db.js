const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let cache = null;

function dbPath() {
  return path.join(app.getPath('userData'), 'db.json');
}

function load() {
  if (cache) return cache;
  const p = dbPath();
  if (fs.existsSync(p)) {
    cache = JSON.parse(fs.readFileSync(p, 'utf8'));
  } else {
    cache = { copies: [] };
  }
  return cache;
}

function save() {
  fs.writeFileSync(dbPath(), JSON.stringify(cache, null, 2));
}

function addCopy(record) {
  load();
  cache.copies.push(record);
  save();
}

function findById(id) {
  load();
  return cache.copies.find((c) => c.id === id);
}

function findAllById(id) {
  load();
  return cache.copies.filter((c) => c.id === id);
}

function listAll() {
  load();
  return [...cache.copies].sort((a, b) => b.createdAt - a.createdAt);
}

function count() {
  load();
  return cache.copies.length;
}

module.exports = { dbPath, addCopy, findById, findAllById, listAll, count };
